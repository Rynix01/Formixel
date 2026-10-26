import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFXL,
  exportBBModel,
  importBBModel,
  serialize,
  renderPNG,
} from '../packages/core/dist/index.js';

const fixture = () => {
  const model = parseFXL(
    'model material_sample pattern plate 2 2 "#323944ff" "#bf9955ff" group base { cube panel [-2,0,-1] [4,4,2] surface plate }',
  );
  return { model, native: exportBBModel(model) };
};
// Defaults observed in an actual Blockbench 5.2.1 save and its pinned Texture.properties.
const editorDefaults = {
  path: '',
  folder: '',
  namespace: '',
  group: '',
  scope: 0,
  particle: false,
  use_as_default: false,
  layers_enabled: false,
  sync_to_project: '',
  file_format: 'png',
  render_mode: 'default',
  render_sides: 'auto',
  wrap_mode: 'limited',
  pbr_channel: 'color',
  fps: 7,
  frame_time: 1,
  frame_order_type: 'loop',
  frame_order: '',
  frame_interpolate: false,
  visible: true,
  internal: true,
  saved: true,
};

test('native static color texture defaults remain compatible without changing pixels, UVs or rendered output', () => {
  const { model, native } = fixture();
  const expected = serialize(model),
    preview = renderPNG(model, { width: 64, height: 64 });
  Object.assign(native.textures[0], editorDefaults);
  const copy = JSON.stringify(native);
  assert.equal(serialize(importBBModel(native)), expected);
  assert.deepEqual(renderPNG(importBBModel(native), { width: 64, height: 64 }), preview);
  assert.equal(JSON.stringify(native), copy, 'import must not mutate the native project');
  native.textures[0].layers = [];
  assert.equal(serialize(importBBModel(native)), expected);
  // Native editor timing defaults are inert on a single static embedded image.
  native.textures[0].frame_time = 10;
  native.textures[0].fps = 24;
  assert.equal(serialize(importBBModel(native)), expected);
});

test('unsupported emissive/additive/layered, side, wrapping and PBR texture states fail instead of changing appearance', () => {
  const { native } = fixture();
  for (const [property, values] of Object.entries({
    render_mode: ['emissive', 'additive', 'layered', 'future-mode', null, false],
    render_sides: ['front', 'double', null, false],
    wrap_mode: ['repeat', 'clamp', null],
    pbr_channel: ['normal', 'height', 'mer', 'emissive', null],
    file_format: ['tga', 'jpeg', null],
    layers_enabled: [true, 1, null],
    visible: [false, 0, null],
    group: ['material-group', null],
    sync_to_project: ['other-project', null],
  }))
    for (const value of values) {
      const altered = structuredClone(native);
      altered.textures[0][property] = value;
      const before = JSON.stringify(altered);
      assert.throws(() => importBBModel(altered), new RegExp('Unsupported texture ' + property));
      assert.equal(JSON.stringify(altered), before);
    }
  for (const layers of [[{ type: 'pixel_layer', data_url: native.textures[0].source }], {}, null]) {
    const altered = structuredClone(native);
    altered.textures[0].layers = layers;
    assert.throws(() => importBBModel(altered), /texture layers/);
  }
});

test('unassigned PBR maps, material groups and external-only texture sources are never silently imported as color pixels', () => {
  const { native } = fixture();
  for (const channel of ['normal', 'height', 'mer']) {
    const altered = structuredClone(native);
    altered.textures.push({
      ...structuredClone(altered.textures[0]),
      uuid: 'unassigned-map',
      id: '1',
      formixel_id: 'unassigned_map',
      pbr_channel: channel,
    });
    assert.throws(() => importBBModel(altered), /pbr_channel/);
  }
  const grouped = structuredClone(native);
  grouped.texture_groups = [
    { uuid: 'material', is_material: true, material_config: { normal: 'map' } },
  ];
  assert.throws(() => importBBModel(grouped), /texture_groups/);
  for (const source of [
    'https://invalid.example/normal.png',
    'C:/untrusted/normal.png',
    undefined,
  ]) {
    const external = structuredClone(native);
    external.textures[0].source = source;
    assert.throws(() => importBBModel(external));
  }
});

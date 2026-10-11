import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  parseFXL,
  exportBBModel,
  importBBModel,
  sampleAnimation,
  renderPNG,
  serialize,
} from '../packages/core/dist/index.js';

test('Blockbench static texture timing defaults import while animated strips still fail', () => {
  const model = parseFXL(
    'model x pattern p 2 2 "#343640ff" "#962329ff" cube c [0,0,0] [2,2,2] surface p',
  );
  const native = exportBBModel(model);
  Object.assign(native.textures[0], {
    fps: 7,
    frame_time: 1,
    frame_order_type: 'loop',
    frame_order: '',
    frame_interpolate: false,
  });
  assert.equal(serialize(importBBModel(native)), serialize(model));
  const strip = structuredClone(native);
  strip.textures[0].uv_height /= 2;
  assert.throws(() => importBBModel(strip), /scaled texture UV/);
  for (const property of [
    { animated: true },
    { frame_interpolate: true },
    { frame_order: '0 1' },
  ]) {
    const unsupported = structuredClone(native);
    Object.assign(unsupported.textures[0], property);
    assert.throws(() => importBBModel(unsupported), /static embedded PNG/);
  }
});
test('editor-initialized empty bone animators preserve motion and reject unsupported rotation modes', () => {
  const model = parseFXL(
    'model x group g { cube c [0,0,0] [1,1,1] } group h { cube d [2,0,0] [3,1,1] } animation a 1 once { rotate "g" 0 [0,0,0] rotate "g" 1 [10,0,0] }',
  );
  const native = exportBBModel(model),
    bone = native.outliner.find((g) => g.formixel_id === 'h');
  native.animations[0].animators[bone.uuid] = {
    name: 'h',
    type: 'bone',
    rotation_global: false,
    quaternion_interpolation: false,
  };
  assert.equal(serialize(importBBModel(native)), serialize(model));
  for (const property of [
    { rotation_global: true },
    { quaternion_interpolation: true },
    { keyframes: null },
  ]) {
    const unsupported = structuredClone(native);
    Object.assign(unsupported.animations[0].animators[bone.uuid], property);
    assert.throws(() => importBBModel(unsupported), /Unsupported animator/);
  }
});

test('BBIR 2 JSON schema accepts assets and rejects malformed UV/unknown fields', () => {
  const validator = new Ajv({ strict: true }).compile(
    JSON.parse(readFileSync('schemas/bbir.v2.schema.json', 'utf8')),
  );
  const model = parseFXL(readFileSync('examples/forest_golem.fxl', 'utf8'));
  assert.equal(validator(model), true, JSON.stringify(validator.errors));
  const bad = structuredClone(model);
  bad.cubes[0].faces.north.uv = [0, 0, 0, 9000];
  assert.equal(validator(bad), false);
  model.unknown = true;
  assert.equal(validator(model), false);
});
test('MCP works with the official stdio client and reports validation failures', async () => {
  const client = new Client({ name: 'Formixel test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['packages/mcp/dist/index.js'],
  });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 3);
    const valid = await client.callTool({
      name: 'formixel_build',
      arguments: { source: 'model x cube a [0,0,0] [1,1,1]' },
    });
    assert.equal(valid.isError, false);
    assert.equal(JSON.parse(valid.content[0].text).elements.length, 1);
    const invalid = await client.callTool({
      name: 'formixel_validate',
      arguments: { source: 'process.exit()' },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});
test('step interpolation changes at the exact key and 4.10 migration matches native axes', () => {
  const m = parseFXL(
    'model x group g { cube a [0,0,0] [1,1,1] } animation a 2 once { rotate "g" 0 [1,2,3] step rotate "g" 1 [4,5,6] }',
  );
  assert.deepEqual(sampleAnimation(m, 'a', 0.9).get('g').rotation, [1, 2, 3]);
  assert.deepEqual(sampleAnimation(m, 'a', 1).get('g').rotation, [4, 5, 6]);
  const old = exportBBModel(m);
  old.meta.format_version = '4.10';
  const imported = importBBModel(old);
  assert.deepEqual(imported.animations[0].tracks[0].keyframes[0].value, [-1, -2, 3]);
  assert.ok(renderPNG(m, { width: 16, height: 16 }).length > 80);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import pngjs from 'pngjs';
import { serialize } from '../packages/core/dist/model.js';
import { particleModelDigest } from '../packages/core/dist/particles.js';
import { exportParticleAssets } from '../packages/core/dist/particle-export.js';

const options = { target: 'bedrock', namespace: 'formixel', entity: 'safe_id' };
const model = () => ({
  version: 2,
  name: 'export-fixture',
  format: 'free',
  resolution: [32, 32],
  cubes: [],
  groups: [
    { id: 'body', name: 'duplicate display name', origin: [0, 8, 0], rotation: [0, 15, 0] },
    {
      id: 'body/head:mouth',
      name: 'duplicate display name',
      parent: 'body',
      origin: [0, 20, -2],
      rotation: [0, 0, 0],
    },
    { id: 'unrelated', name: 'unrelated', origin: [0, 0, 0], rotation: [0, 0, 0] },
  ],
  animations: [
    {
      id: 'breath',
      name: 'breath',
      length: 2,
      loop: true,
      tracks: [
        {
          group: 'body',
          channel: 'position',
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: 'linear' },
            { time: 2, value: [0, 2, 0], interpolation: 'linear' },
          ],
        },
        {
          group: 'body/head:mouth',
          channel: 'rotation',
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: 'step' },
            { time: 1, value: [15, 0, 0], interpolation: 'linear' },
          ],
        },
      ],
    },
    { id: 'once', name: 'once', length: 3, loop: false, tracks: [] },
  ],
});
const recipe = (extra = {}) => ({
  id: 'embers',
  seed: 42,
  shape: 'cone',
  direction: [0, 0, -5],
  spread: 0,
  speed: [32, 32],
  lifetime: [0.75, 0.75],
  acceleration: [0, 0, 0],
  drag: 0,
  size: [
    [0, 4],
    [1, 4],
  ],
  color: [
    [0, '#ff800040'],
    [1, '#ff800040'],
  ],
  render: 'sprite',
  blend: 'additive',
  ...extra,
});
const event = (extra = {}) => ({
  id: 'mouth:burst',
  animation: 'breath',
  time: 0.25,
  recipe: 'embers',
  duration: 0,
  rate: 0,
  burst: 6,
  attachment: { group: 'body/head:mouth', point: [1, 21, -4] },
  space: 'world',
  ...extra,
});
const document = (rig, extra = {}) => ({
  version: 1,
  modelDigest: particleModelDigest(rig),
  recipes: [recipe()],
  events: [event()],
  ...extra,
});
const json = (bundle, path) => JSON.parse(new TextDecoder().decode(bundle.assets[path]));

test('Bedrock bundle links actual particle assets, timed events, client aliases and bone locators', () => {
  const rig = model(),
    sidecar = document(rig),
    modelBefore = serialize(rig),
    docBefore = JSON.stringify(sidecar);
  const bundle = exportParticleAssets(rig, sidecar, options),
    { manifest } = bundle;
  assert.equal(manifest.kind, 'integration-fragments');
  assert.equal(manifest.installablePack, false);
  assert.equal(manifest.runtimeVerified, false);
  assert.equal(manifest.entity, 'formixel:safe_id');
  assert.equal(manifest.modelDigest, sidecar.modelDigest);
  assert.equal(manifest.modelUnitsPerBlock, 16);
  assert.deepEqual(json(bundle, manifest.paths.limitations), manifest);
  assert.deepEqual(Object.keys(bundle.assets).sort(), manifest.files);
  assert.equal(bundle.assets['manifest.json'], undefined);
  const [binding] = manifest.effects,
    particle = json(bundle, binding.path);
  assert.equal(particle.format_version, '1.10.0');
  assert.equal(particle.particle_effect.description.identifier, binding.identifier);
  assert.equal(binding.sourceRecipe, 'embers');
  assert.equal(binding.sourceEvent, 'mouth:burst');
  const appearance = particle.particle_effect.description.basic_render_parameters;
  assert.equal(appearance.material, 'particles_add');
  assert.ok(bundle.assets[appearance.texture + '.png']);
  assert.equal(appearance.texture + '.png', manifest.paths.texture);
  const c = particle.particle_effect.components;
  assert.deepEqual(c['minecraft:emitter_local_space'], {
    position: false,
    rotation: false,
    velocity: false,
  });
  assert.deepEqual(c['minecraft:emitter_rate_instant'], { num_particles: 6 });
  assert.deepEqual(c['minecraft:emitter_shape_point'], {
    offset: [0, 0, 0],
    direction: [0, 0, -1],
  });
  assert.equal(c['minecraft:particle_initial_speed'], 2);
  assert.deepEqual(c['minecraft:particle_lifetime_expression'], { max_lifetime: 0.75 });
  assert.deepEqual(c['minecraft:emitter_lifetime_once'], { active_time: 0.75 });
  assert.deepEqual(c['minecraft:particle_motion_dynamic'], {
    linear_acceleration: [0, 0, 0],
    linear_drag_coefficient: 0,
  });
  assert.deepEqual(c['minecraft:particle_appearance_billboard'], {
    size: [0.25, 0.25],
    facing_camera_mode: 'lookat_xyz',
    uv: { texture_width: 1, texture_height: 1, uv: [0, 0], uv_size: [1, 1] },
  });
  assert.deepEqual(c['minecraft:particle_appearance_tinting'].color, [1, 128 / 255, 0, 64 / 255]);
  const client = json(bundle, manifest.paths.clientEntityFragment)['minecraft:client_entity']
    .description;
  assert.equal(client.identifier, manifest.entity);
  assert.equal(client.particle_effects[binding.alias], binding.identifier);
  const [animationBinding] = manifest.animations,
    animation = json(bundle, manifest.paths.animation).animations[animationBinding.identifier];
  assert.equal(client.animations[animationBinding.alias], animationBinding.identifier);
  assert.equal(animation.loop, true);
  assert.equal(animation.animation_length, 2);
  assert.equal(animation.bones, undefined);
  const [locator] = manifest.locators;
  assert.deepEqual(animation.particle_effects['0.25'], [
    { effect: binding.alias, locator: locator.name, bind_to_actor: false },
  ]);
  const geometry = json(bundle, manifest.paths.geometryFragment)['minecraft:geometry'][0];
  assert.equal(geometry.description.identifier, manifest.geometryIdentifier);
  const attachedBone = geometry.bones.find((bone) => bone.name === locator.bone);
  assert.deepEqual(attachedBone.locators[locator.name], {
    offset: [1, 21, -4],
    rotation: [0, 0, 0],
    ignore_inherited_scale: false,
  });
  assert.equal(
    manifest.bones.find((bone) => bone.sourceGroup === 'body/head:mouth').name,
    attachedBone.name,
  );
  assert.equal(
    attachedBone.parent,
    manifest.bones.find((bone) => bone.sourceGroup === 'body').name,
  );
  assert.equal(
    manifest.bones.some((bone) => bone.sourceGroup === 'unrelated'),
    false,
  );
  assert.ok(geometry.bones.every((bone) => bone.cubes === undefined));
  assert.ok(manifest.requiredIntegration.some((step) => /synchronized/.test(step)));
  assert.ok(
    manifest.limitations.some((limit) => /not been verified in a running game/.test(limit)),
  );
  assert.equal(serialize(rig), modelBefore);
  assert.equal(JSON.stringify(sidecar), docBefore);
});

test('sprite PNG independently decodes and ZIP entries remain safe root-relative paths', () => {
  const rig = model(),
    bundle = exportParticleAssets(rig, document(rig), options);
  const pixel = pngjs.PNG.sync.read(Buffer.from(bundle.assets[bundle.manifest.paths.texture]));
  assert.equal(pixel.width, 1);
  assert.equal(pixel.height, 1);
  assert.deepEqual([...pixel.data], [255, 255, 255, 255]);
  for (const [path, bytes] of Object.entries(bundle.assets)) {
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(/^(?:particles|textures\/particle|animations|integration)\//.test(path));
    assert.equal(posix.isAbsolute(path), false);
    assert.equal(path.includes('\\') || path.includes(':'), false);
    assert.equal(
      path.split('/').some((part) => !part || part === '.' || part === '..'),
      false,
    );
    assert.ok(bytes.length < 2_000_000);
  }
  const unpacked = unzipSync(zipSync(bundle.assets));
  assert.deepEqual(Object.keys(unpacked).sort(), bundle.manifest.files);
  for (const path of Object.keys(unpacked)) assert.deepEqual(unpacked[path], bundle.assets[path]);
});

test('same-time events retain unique effect and locator references across multiple clips', () => {
  const rig = model(),
    value = document(rig, {
      recipes: [
        recipe(),
        recipe({
          id: 'alpha',
          blend: 'alpha',
          size: [
            [0, 1],
            [0.5, 1],
            [1, 1],
          ],
        }),
      ],
      events: [
        event(),
        event({ id: 'second', recipe: 'alpha', burst: 3 }),
        event({ id: 'once-event', animation: 'once', time: 1 }),
      ],
    });
  const bundle = exportParticleAssets(rig, value, options),
    animationJSON = json(bundle, bundle.manifest.paths.animation).animations;
  assert.equal(bundle.manifest.effects.length, 3);
  assert.equal(new Set(bundle.manifest.effects.map((effect) => effect.identifier)).size, 3);
  assert.equal(new Set(bundle.manifest.locators.map((locator) => locator.name)).size, 3);
  assert.equal(bundle.manifest.animations.length, 2);
  for (const binding of bundle.manifest.animations) {
    const animation = animationJSON[binding.identifier],
      clip = rig.animations.find((clip) => clip.id === binding.sourceAnimation);
    assert.equal(animation.loop, clip.loop);
    assert.equal(animation.animation_length, clip.length);
  }
  const breath = bundle.manifest.animations.find((binding) => binding.sourceAnimation === 'breath');
  assert.equal(animationJSON[breath.identifier].particle_effects['0.25'].length, 2);
  const alpha = bundle.manifest.effects.find((effect) => effect.sourceRecipe === 'alpha');
  assert.equal(
    json(bundle, alpha.path).particle_effect.description.basic_render_parameters.material,
    'particles_blend',
  );
  for (const animation of Object.values(animationJSON))
    for (const events of Object.values(animation.particle_effects))
      for (const event of events) {
        assert.ok(bundle.manifest.effects.some((effect) => effect.alias === event.effect));
        assert.ok(bundle.manifest.locators.some((locator) => locator.name === event.locator));
      }
});

test('export is byte-deterministic and safe source IDs never become paths or executable scripts', () => {
  const rig = model(),
    value = document(rig),
    before = exportParticleAssets(rig, value, options);
  value.events[0].id = '../../unsafe:source';
  value.recipes[0].id = '__proto__';
  value.events[0].recipe = '__proto__';
  const hostileNames = exportParticleAssets(rig, value, options);
  assert.deepEqual(Object.keys(hostileNames.assets), Object.keys(before.assets));
  for (const path of Object.keys(hostileNames.assets)) assert.equal(path.includes('unsafe'), false);
  const a = exportParticleAssets(rig, value, options),
    b = exportParticleAssets(rig, JSON.stringify(value), options);
  assert.deepEqual(a.manifest, b.manifest);
  for (const path of a.manifest.files) assert.deepEqual(a.assets[path], b.assets[path]);
  for (const binding of a.manifest.effects) {
    const strings = [],
      collect = (value) => {
        if (typeof value === 'string') strings.push(value);
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
      };
    collect(json(a, binding.path));
    assert.equal(
      strings.some((s) => /math\.|variable\.|query\.|return|;|pre_effect_script/i.test(s)),
      false,
    );
  }
});

test('unsupported simulation semantics reject before returning partial assets', () => {
  const rig = model();
  const cases = [
    [
      (d) => {
        d.recipes[0].render = 'voxel';
      },
      /voxel rendering/,
    ],
    [
      (d) => {
        d.recipes[0].spread = 1;
      },
      /cone spread/,
    ],
    [
      (d) => {
        d.recipes[0].speed = [1, 2];
      },
      /randomized speed or lifetime/,
    ],
    [
      (d) => {
        d.recipes[0].lifetime = [0.5, 1];
      },
      /randomized speed or lifetime/,
    ],
    [
      (d) => {
        d.recipes[0].drag = 1;
      },
      /drag and acceleration/,
    ],
    [
      (d) => {
        d.recipes[0].acceleration = [0, 1, 0];
      },
      /drag and acceleration/,
    ],
    [
      (d) => {
        d.recipes[0].size[1][1] = 0;
      },
      /changing size or color/,
    ],
    [
      (d) => {
        d.recipes[0].color[1][1] = '#ff800000';
      },
      /changing size or color/,
    ],
    [
      (d) => {
        d.events[0].space = 'local';
      },
      /local-space/,
    ],
    [
      (d) => {
        d.events[0].rate = 1;
      },
      /instantaneous positive bursts/,
    ],
    [
      (d) => {
        d.events[0].duration = 1;
      },
      /instantaneous positive bursts/,
    ],
    [
      (d) => {
        d.events[0].burst = 0;
        d.events[0].rate = 1;
        d.events[0].duration = 1;
      },
      /instantaneous positive bursts/,
    ],
    [
      (d) => {
        d.events[0].animation = 'once';
        d.events[0].time = 3;
      },
      /exactly at clip end/,
    ],
    [
      (d) => {
        d.recipes[0].speed = [Number.MIN_VALUE, Number.MIN_VALUE];
      },
      /conversion underflows/,
    ],
    [
      (d) => {
        d.recipes[0].size = [
          [0, Number.MIN_VALUE],
          [1, Number.MIN_VALUE],
        ];
      },
      /conversion underflows/,
    ],
    [
      (d) => {
        d.recipes.push(recipe({ id: 'unused', drag: 1 }));
      },
      /drag and acceleration/,
    ],
    [
      (d) => {
        d.events = [];
      },
      /At least one particle event/,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const value = document(rig);
    mutate(value);
    assert.throws(() => exportParticleAssets(rig, value, options), expected);
  }
});

test('scale checks follow the exact attachment ancestors and source clip', () => {
  const rig = model(),
    scale = {
      group: 'body',
      channel: 'scale',
      keyframes: [{ time: 0, value: [1, 2, 1], interpolation: 'linear' }],
    };
  rig.animations[0].tracks.push(scale);
  assert.throws(
    () => exportParticleAssets(rig, document(rig), options),
    /nonidentity inherited animated scale/,
  );
  scale.keyframes[0].value = [1, 1, 1];
  assert.doesNotThrow(() => exportParticleAssets(rig, document(rig), options));
  scale.group = 'unrelated';
  scale.keyframes[0].value = [3, 3, 3];
  assert.doesNotThrow(() => exportParticleAssets(rig, document(rig), options));
  scale.group = 'body';
  assert.doesNotThrow(() =>
    exportParticleAssets(rig, document(rig, { events: [event({ animation: 'once' })] }), options),
  );
});

test('options reject paths, reserved names, implicit targets and unknown fields', () => {
  const rig = model(),
    value = document(rig);
  for (const invalid of [
    null,
    {},
    { ...options, target: 'geckolib' },
    { ...options, namespace: 'minecraft' },
    { ...options, entity: '../escape' },
    { ...options, entity: 'C:\\temp' },
    { ...options, entity: 'UpperCase' },
    { ...options, namespace: 'https://bad' },
    { ...options, entity: 'con' },
    { ...options, namespace: 'nul' },
    { ...options, entity: 'a'.repeat(33) },
    { ...options, directory: '/arbitrary' },
    Object.create(options),
  ])
    assert.throws(() => exportParticleAssets(rig, value, invalid), /Bedrock particle export/);
  const changed = structuredClone(rig);
  changed.groups[0].origin[0] = 1;
  assert.throws(() => exportParticleAssets(changed, value, options), /digest does not match/);
});

test('small timeline values stay decimal and are not rounded to zero', () => {
  const rig = model(),
    value = document(rig, { events: [event({ time: 1e-7 })] });
  const bundle = exportParticleAssets(rig, value, options),
    animation = json(bundle, bundle.manifest.paths.animation).animations[
      bundle.manifest.animations[0].identifier
    ];
  assert.deepEqual(Object.keys(animation.particle_effects), ['0.0000001']);
});

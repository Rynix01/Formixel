import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parseFXL,
  serialize,
  importBBModel,
  exportBBModel,
  reviewModel,
} from '../packages/core/dist/index.js';
import {
  createModelContext,
  validateModelContext,
  exportBBModelWithContext,
  rebindModelContext,
} from '../packages/core/dist/context.js';

const fixture = () => {
  const model = parseFXL(
    'model plate material silver "#aabbcc" group body { cube shell [-1,0,-1] [2,3,2] material silver } animation idle 1 loop { move "body" 0 [0,0,0] move "body" 1 [0,0,1] }',
  );
  // The public Model API also accepts unbaked material assignments, unlike parseFXL output.
  delete model.cubes[0].faces;
  model.textures = [];
  return model;
};
const policy = () => ({
  brief: { anatomy: 'prop', floor: 0, forward: [0, 0, -1], airborneAnimations: [] },
  roles: { body: 'body' },
  constraints: [{ id: 'floor', type: 'ground', cubes: ['body/shell'], floor: 0, tolerance: 0 }],
});

test('native context preserves exact roles and constraints across repeated material-baked roundtrips', () => {
  const model = fixture(),
    original = createModelContext(model, policy());
  assert.equal(original.modelDigest, createHash('sha256').update(serialize(model)).digest('hex'));
  const native = exportBBModelWithContext(model, original),
    imported = importBBModel(native);
  assert.ok(imported.textures.length, 'native export bakes declared materials into real pixels');
  assert.notEqual(
    serialize(imported),
    serialize(model),
    'context must bind to native representation',
  );
  const first = validateModelContext(imported, native.formixel_context);
  assert.deepEqual(first.roles, original.roles);
  assert.deepEqual(first.constraints, original.constraints);
  assert.deepEqual(first.brief, original.brief);
  assert.equal(imported.groups[0].id, 'body');
  assert.equal(imported.cubes[0].id, 'body/shell');
  assert.throws(() => validateModelContext(imported, original), /digest/);
  const second = exportBBModelWithContext(imported, first);
  assert.deepEqual(validateModelContext(importBBModel(second), second.formixel_context), first);
  assert.deepEqual(exportBBModelWithContext(model), exportBBModel(model));
  // The same data is independently usable when an editor removes custom root properties.
  const sidecar = JSON.parse(JSON.stringify(first));
  delete native.formixel_context;
  assert.deepEqual(validateModelContext(importBBModel(native), sidecar), first);
});

test('geometry, decoded texture pixels and animation changes reject stale context', () => {
  const native = exportBBModelWithContext(fixture(), createModelContext(fixture(), policy()));
  const base = importBBModel(native),
    context = native.formixel_context;
  for (const mutate of [
    (model) => {
      model.cubes[0].to[0] += 1;
    },
    (model) => {
      model.textures[0].pixels[0] ^= 1;
    },
    (model) => {
      model.animations[0].tracks[0].keyframes[1].value[2] += 1;
    },
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.throws(() => validateModelContext(changed, context), /Stale model context/);
    assert.throws(() => exportBBModelWithContext(changed, context), /Stale model context/);
  }
});

test('context rejects unknown fields, malformed hashes and invalid policy references without evaluation', () => {
  const model = fixture(),
    context = createModelContext(model, policy());
  for (const invalid of [
    null,
    [],
    { ...context, version: 2 },
    { ...context, modelDigest: '0'.repeat(64) },
    { ...context, modelDigest: 'not-a-digest' },
    { ...context, path: '/tmp/secret' },
    { ...context, prompt: 'arbitrary source' },
    { ...context, brief: { ...context.brief, tolerance: 1000000 } },
    { ...context, roles: { body: 'missing' } },
    { ...context, roles: { ...context.roles, execute: 'globalThis.contextEvaluated = true' } },
    { ...context, constraints: [{ ...context.constraints[0], cubes: ['missing'] }] },
    {
      ...context,
      constraints: [{ ...context.constraints[0], eval: 'globalThis.contextEvaluated = true' }],
    },
    { ...context, constraints: 'globalThis.contextEvaluated = true' },
  ])
    assert.throws(() => validateModelContext(model, invalid));
  assert.equal(globalThis.contextEvaluated, undefined);
});

test('context accepts physically failing repair input and returns detached policy data', () => {
  const model = fixture(),
    source = policy();
  source.constraints[0].floor = 10;
  assert.equal(reviewModel(model, source.constraints).passed, false);
  const context = createModelContext(model, source);
  const copy = validateModelContext(model, context);
  assert.deepEqual(copy, context);
  source.roles.body = 'other';
  source.constraints[0].cubes[0] = 'other';
  source.brief.forward[2] = 1;
  assert.equal(copy.roles.body, 'body');
  assert.equal(copy.constraints[0].cubes[0], 'body/shell');
  assert.deepEqual(copy.brief.forward, [0, 0, -1]);
  copy.roles.body = 'other';
  assert.equal(context.roles.body, 'body');
});

const editorFixture = () => {
  const model = fixture();
  for (const [id, parent] of [
    ['head', 'body'],
    ['upper', 'body'],
    ['lower', 'upper'],
    ['end', 'lower'],
    ['hand', 'body'],
    ['shaft', 'hand'],
  ])
    model.groups.push({ id, name: id, parent, origin: [0, 0, 0], rotation: [0, 0, 0] });
  for (const [id, parent] of [
    ['end/sole', 'end'],
    ['shaft/weapon', 'shaft'],
  ])
    model.cubes.push({ ...structuredClone(model.cubes[0]), id, name: id, parent });
  model.cubes[0].from[0] = -1.123456;
  model.groups[0].rotation[1] = 0.123456;
  model.animations[0].tracks[0].keyframes[1].value[2] = 0.654321;
  const marker = (group) => ({ group, point: [0, 0.123456, 0] });
  const options = {
    ...policy(),
    brief: { anatomy: 'prop', airborneAnimations: ['idle'] },
    roles: {
      body: 'body',
      head: 'head',
      limbs: [
        {
          id: 'front',
          kind: 'leg',
          upper: 'upper',
          lower: 'lower',
          end: 'end',
          sole: { cube: 'end/sole', face: 'down' },
          bendPole: [0, 0, -1],
        },
      ],
      weapon: {
        hand: { ...marker('hand'), axis: [0, 1, 0] },
        shaft: { ...marker('shaft'), axis: [0, 1, 0] },
        cubes: ['shaft/weapon'],
        secondary: {
          hand: { ...marker('hand'), axis: [0, 1, 0] },
          shaft: { ...marker('shaft'), axis: [0, 1, 0] },
        },
      },
    },
    constraints: [
      {
        id: 'body',
        type: 'ground',
        cubes: ['body/shell'],
        floor: 0,
        tolerance: 0,
        animations: ['idle'],
      },
      { id: 'contact', type: 'contact', marker: marker('end'), floor: 0, tolerance: 1 },
      {
        id: 'attachment',
        type: 'attachment',
        a: marker('hand'),
        b: marker('shaft'),
        maxDistance: 1,
      },
      {
        id: 'level',
        type: 'level',
        a: marker('body'),
        b: { group: 'head', point: [0, 1, 0] },
        axis: [0, 1, 0],
        maxDegrees: 1,
      },
      {
        id: 'bend',
        type: 'bend',
        root: marker('upper'),
        joint: marker('lower'),
        end: marker('end'),
        pole: [0, 0, -1],
        minDot: -1,
      },
    ],
  };
  const native = exportBBModelWithContext(model, createModelContext(model, options));
  const source = importBBModel(native),
    context = native.formixel_context;
  const idMap = {};
  const editorCopy = (value) => {
    if (typeof value === 'number') return Math.round(value * 10000) / 10000;
    if (Array.isArray(value)) return value.map(editorCopy);
    if (!value || typeof value !== 'object') return value;
    if (value.formixel_id && value.uuid) idMap[value.formixel_id] = value.uuid;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('formixel_'))
        .map(([key, child]) => [key, editorCopy(child)]),
    );
  };
  const destination = importBBModel(editorCopy(native));
  return { source, destination, context, idMap };
};

test('editor context rebind proves rounded native equivalence and remaps semantic references only', () => {
  const { source, destination, context, idMap } = editorFixture();
  const rebound = rebindModelContext(context, source, destination, idMap);
  assert.deepEqual(validateModelContext(destination, rebound), rebound);
  assert.equal(rebound.roles.body, idMap.body);
  assert.equal(rebound.roles.head, idMap.head);
  const limb = rebound.roles.limbs[0];
  for (const key of ['upper', 'lower', 'end']) assert.equal(limb[key], idMap[key]);
  assert.equal(limb.id, 'front');
  assert.equal(limb.sole.cube, idMap['end/sole']);
  assert.deepEqual(rebound.roles.weapon.cubes, [idMap['shaft/weapon']]);
  for (const grip of [rebound.roles.weapon, rebound.roles.weapon.secondary]) {
    assert.equal(grip.hand.group, idMap.hand);
    assert.equal(grip.shaft.group, idMap.shaft);
  }
  assert.deepEqual(rebound.brief.airborneAnimations, [idMap.idle]);
  assert.equal(rebound.constraints[0].id, 'body', 'constraint labels are never remapped');
  assert.deepEqual(rebound.constraints[0].cubes, [idMap['body/shell']]);
  assert.deepEqual(rebound.constraints[0].animations, [idMap.idle]);
  assert.equal(rebound.constraints[1].marker.group, idMap.end);
  assert.deepEqual(rebound.constraints[1].marker.point, context.constraints[1].marker.point);
  assert.equal(rebound.constraints[2].a.group, idMap.hand);
  assert.equal(rebound.constraints[2].b.group, idMap.shaft);
  assert.equal(rebound.constraints[3].a.group, idMap.body);
  assert.equal(rebound.constraints[3].b.group, idMap.head);
  assert.equal(rebound.constraints[4].root.group, idMap.upper);
  assert.equal(rebound.constraints[4].joint.group, idMap.lower);
  assert.equal(rebound.constraints[4].end.group, idMap.end);
  assert.equal(context.roles.body, 'body', 'source context remains detached');
  // Root hosts may omit texture UUID mapping; exact unique decoded pixels still prove identity.
  const withoutTexture = { ...idMap };
  for (const texture of source.textures) delete withoutTexture[texture.id];
  assert.deepEqual(rebindModelContext(context, source, destination, withoutTexture), rebound);
});

test('editor rebind rejects changed topology, geometry, UVs, pixels, and clip keys', () => {
  const { source, destination, context, idMap } = editorFixture();
  for (const mutate of [
    (model) => {
      model.cubes[0].to[0] += 0.01;
    },
    (model) => {
      model.cubes[0].parent = idMap.head;
    },
    (model) => {
      model.cubes[0].faces.north.uv[0] += 0.01;
    },
    (model) => {
      model.textures[0].pixels[0] ^= 1;
    },
    (model) => {
      model.animations[0].tracks[0].keyframes[1].value[2] += 0.01;
    },
  ]) {
    const changed = structuredClone(destination);
    mutate(changed);
    assert.throws(() => rebindModelContext(context, source, changed, idMap), /Stale model context/);
  }
  assert.throws(() => rebindModelContext(context, source, destination, {}), /Stale model context/);
  const changedSource = structuredClone(source);
  changedSource.cubes[0].from[0] -= 1;
  assert.throws(
    () => rebindModelContext(context, changedSource, destination, idMap),
    /Stale model context/,
  );
});

test('editor rounding cannot amplify to a world geometry change beyond one thousandth', () => {
  const source = importBBModel(exportBBModel(fixture()));
  source.cubes[0].from[0] = 100000;
  source.cubes[0].to[0] = 100001;
  const context = createModelContext(source, policy()),
    destination = structuredClone(source);
  destination.groups[0].rotation[1] += 0.0001;
  assert.throws(() => rebindModelContext(context, source, destination, {}), /Stale model context/);
});

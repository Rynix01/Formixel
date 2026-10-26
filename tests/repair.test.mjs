import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, serialize, validate } from '../packages/core/dist/model.js';
import { applyPatch, patchJSON } from '../packages/core/dist/patch.js';
import { prepareRepair, applyRepair, REPAIR_LIMITS } from '../packages/core/dist/repair.js';
import { geometry, bonePoint } from '../packages/core/dist/geometry.js';
import { sampleAnimation } from '../packages/core/dist/animation.js';

const fixture = () =>
  canonical({
    version: 2,
    name: 'RepairFixture',
    format: 'free',
    resolution: [256, 256],
    groups: [
      { id: 'root', name: 'Root', origin: [0, 0, 0], rotation: [0, 0, 0] },
      { id: 'left', name: 'Left', parent: 'root', origin: [0, 0, 0], rotation: [0, 0, 0] },
      { id: 'right', name: 'Right', parent: 'root', origin: [2, 0, 0], rotation: [0, 0, 0] },
    ],
    cubes: [
      {
        id: 'leftCube',
        name: 'Left',
        parent: 'left',
        from: [0, 0, 0],
        to: [1, 1, 1],
        origin: [0, 0, 0],
        rotation: [0, 0, 0],
        color: 0,
        material: 'gold',
        faces: { north: { texture: 'atlas', uv: [0, 0, 2, 2] } },
      },
      {
        id: 'rightCube',
        name: 'Right',
        parent: 'right',
        from: [2, 0, 0],
        to: [3, 1, 1],
        origin: [2, 0, 0],
        rotation: [0, 0, 0],
        color: 0,
        material: 'gold',
        faces: { north: { texture: 'atlas', uv: [2, 0, 4, 2] } },
      },
    ],
    materials: [{ id: 'gold', color: '#ddab52' }],
    textures: [
      {
        id: 'atlas',
        name: 'Atlas',
        width: 256,
        height: 256,
        pixels: Array(256 * 256 * 4).fill(255),
      },
    ],
    animations: [
      {
        id: 'walk',
        name: 'Walk',
        length: 1,
        loop: true,
        tracks: ['left', 'right'].map((group) => ({
          group,
          channel: 'rotation',
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: 'linear' },
            { time: 1, value: [0, 0, 0], interpolation: 'linear' },
          ],
        })),
      },
    ],
  });
const track = (group, amount = 10) => ({
  group,
  channel: 'rotation',
  keyframes: [
    { time: 0, value: [0, 0, 0], interpolation: 'linear' },
    { time: 1, value: [amount, 0, 0], interpolation: 'linear' },
  ],
});

test('extended patch commits resources, texture paint and animation tracks as one validated transaction', () => {
  const m = fixture(),
    before = serialize(m),
    cube = structuredClone(m.cubes.find((c) => c.id === 'leftCube'));
  cube.material = 'ivory';
  cube.faces.north.texture = 'newAtlas';
  const result = applyPatch(m, [
    { op: 'replace', id: 'leftCube', node: cube }, // References may be declared later in the same transaction.
    { op: 'add', kind: 'material', id: 'ivory', node: { id: 'ivory', color: '#eecc99' } },
    {
      op: 'add',
      kind: 'texture',
      id: 'newAtlas',
      node: { id: 'newAtlas', name: 'New', width: 2, height: 2, pixels: Array(16).fill(255) },
    },
    { op: 'paint', id: 'newAtlas', rect: [0, 0, 2, 1], pixels: [200, 0, 0, 255, 0, 200, 0, 255] },
    { op: 'set-track', id: 'walk', track: track('left', 25) },
    { op: 'remove-track', id: 'walk', group: 'right', channel: 'rotation' },
    {
      op: 'add',
      kind: 'animation',
      id: 'attack',
      node: { id: 'attack', name: 'Attack', length: 1, loop: false, tracks: [track('right', 35)] },
    },
  ]);
  assert.deepEqual(validate(result), []);
  assert.deepEqual(
    result.textures.find((t) => t.id === 'newAtlas').pixels.slice(0, 8),
    [200, 0, 0, 255, 0, 200, 0, 255],
  );
  assert.equal(result.animations.find((a) => a.id === 'walk').tracks.length, 1);
  assert.equal(result.animations.find((a) => a.id === 'walk').tracks[0].keyframes[1].value[0], 25);
  assert.equal(serialize(m), before);
  const removed = applyPatch(result, [{ op: 'remove', kind: 'animation', id: 'attack' }]);
  assert.equal(removed.animations.length, 1);
  const replacement = applyPatch(m, [
    { op: 'replace', kind: 'material', id: 'gold', node: { id: 'gold', color: '#aabbcc' } },
  ]);
  assert.equal(replacement.materials[0].color, '#aabbcc');
});

test('patch rejects executable, unknown, oversized and invalid final data without partial changes', () => {
  const m = fixture(),
    before = serialize(m);
  for (const ops of [
    [{ op: 'eval', id: 'leftCube', code: 'process.exit()' }],
    [{ op: 'translate', id: 'leftCube', offset: [1, 0, 0], unexpected: true }],
    [
      {
        op: 'replace',
        kind: 'material',
        id: 'gold',
        node: { id: 'gold', color: '#aabbcc', shader: 'custom()' },
      },
    ],
    [{ op: 'remove', kind: 'texture', id: 'atlas' }],
    [{ op: 'set-track', id: 'walk', track: track('absent') }],
    [
      {
        op: 'set-track',
        id: 'walk',
        track: {
          ...track('left'),
          keyframes: [{ time: 1, value: [1, 0, 0], interpolation: 'javascript' }],
        },
      },
    ],
    [{ op: 'paint', id: 'atlas', rect: [0, 0, 65, 65], color: [0, 0, 0, 255] }],
    [
      {
        op: 'paint',
        id: 'atlas',
        rect: [0, 0, 1, 1],
        color: [0, 0, 0, 255],
        pixels: [0, 0, 0, 255],
      },
    ],
    [{ op: 'paint', id: 'atlas', rect: [255, 255, 2, 1], color: [0, 0, 0, 255] }],
    [{ op: 'paint', id: 'atlas', rect: [0, 0, 1, 1], pixels: [0, 0, 0, 999] }],
    [
      { op: 'rename', id: 'leftCube', name: 'Changed' },
      { op: 'remove', kind: 'texture', id: 'atlas' },
    ],
    JSON.parse('[{"op":"rename","id":"leftCube","name":"X","__proto__":{"polluted":true}}]'),
  ]) {
    assert.throws(() => applyPatch(m, ops));
    assert.equal(serialize(m), before);
  }
  assert.throws(
    () =>
      patchJSON([
        {
          toJSON() {
            throw new Error('should not execute');
          },
        },
      ]),
    /plain JSON/,
  );
  const accessor = {};
  Object.defineProperty(accessor, 'id', {
    enumerable: true,
    get() {
      throw new Error('should not execute');
    },
  });
  assert.throws(() => patchJSON(accessor), /accessors/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => patchJSON(cycle), /cycles/);
  assert.throws(() => patchJSON(new Array(3)), /dense JSON/);
  const symbolic = { id: 'leftCube' };
  symbolic[Symbol('hidden')] = 'ignored';
  assert.throws(() => patchJSON(symbolic), /symbol properties/);
  assert.throws(() => patchJSON({ text: 'x'.repeat(100) }, 10), /byte budget/);
});

test('repair context includes exact selected geometry and dependencies with compact texture summaries', () => {
  const m = fixture(),
    a = prepareRepair(m, ['left'], 'Give the left forearm a red accent and lower its swing.');
  const context = JSON.parse(a.prompt.split('Reference JSON:\n')[1]);
  assert.deepEqual(
    context.nodes,
    m.groups.concat(m.cubes).filter((n) => ['left', 'leftCube'].includes(n.id)),
  );
  assert.deepEqual(
    context.readOnlyAncestors,
    m.groups.filter((g) => g.id === 'root'),
  );
  assert.equal(context.textures[0].pixels, undefined);
  assert.equal(context.textures[0].rgbaSamples.length, 16);
  assert.deepEqual(context.textures[0].regions[0].uv, [0, 0, 2, 2]);
  assert.equal(context.textures[0].regions[0].writable, true);
  assert.equal(context.materials[0].editable, false);
  assert.equal(
    context.animations[0].tracks.find((t) => t.group === 'right'),
    undefined,
  );
  assert.equal(context.animations[0].readOnlyTrackCount, 1);
  assert.ok(a.contextBytes < a.sourceBytes / 20, `${a.contextBytes} / ${a.sourceBytes}`);
  assert.equal(a.contextBytes, new TextEncoder().encode(a.prompt).length);
  assert.throws(() => prepareRepair(m, [], 'repair'), /selection/);
  assert.throws(() => prepareRepair(m, ['absent'], 'repair'), /Unknown/);
  assert.throws(() => prepareRepair(m, ['left'], 'a'.repeat(8193)), /8192/);
  m.animations[0].tracks[0].keyframes = Array.from({ length: 100 }, (_, i) => ({
    time: i / 99,
    value: [i, 0, 0],
    interpolation: 'linear',
  }));
  const sampled = JSON.parse(
    prepareRepair(m, ['left'], 'repair').prompt.split('Reference JSON:\n')[1],
  );
  const selectedTrack = sampled.animations[0].tracks.find((t) => t.group === 'left');
  assert.equal(selectedTrack.keyframes.length, REPAIR_LIMITS.keysPerTrack);
  assert.equal(selectedTrack.keyCount, 100);
  assert.equal(selectedTrack.keyframes.at(-1).time, 1);
});

test('scoped repairs change selected UV texels and selected tracks while preserving unselected content', () => {
  const m = fixture();
  const operations = [
    { op: 'translate', id: 'leftCube', offset: [0, 0.5, 0] },
    { op: 'paint', id: 'atlas', rect: [0, 0, 2, 2], color: [180, 0, 0, 255] },
    { op: 'set-track', id: 'walk', track: track('left', 30) },
  ];
  const result = applyRepair(m, operations, ['left']);
  assert.equal(result.cubes.find((c) => c.id === 'leftCube').from[1], 0.5);
  assert.deepEqual(
    result.cubes.find((c) => c.id === 'rightCube'),
    m.cubes.find((c) => c.id === 'rightCube'),
  );
  assert.deepEqual(
    result.animations[0].tracks.find((t) => t.group === 'right'),
    m.animations[0].tracks.find((t) => t.group === 'right'),
  );
  assert.deepEqual(
    result.textures[0].pixels.slice(0, 12),
    [180, 0, 0, 255, 180, 0, 0, 255, 255, 255, 255, 255],
  );
  assert.equal(
    serialize(result),
    serialize(applyPatch(m, operations)),
    'compact repair executes the exact same validated patch semantics',
  );
  for (const op of [
    { op: 'translate', id: 'rightCube', offset: [0, 1, 0] },
    { op: 'rename', id: 'root', name: 'Changed' },
    { op: 'paint', id: 'atlas', rect: [1, 0, 2, 1], color: [0, 0, 0, 255] },
    { op: 'replace', kind: 'material', id: 'gold', node: { id: 'gold', color: '#ffffff' } },
    { op: 'set-track', id: 'walk', track: track('right', 50) },
    { op: 'remove', kind: 'animation', id: 'walk' },
  ])
    assert.throws(() => applyRepair(m, [op], ['left']), /scope/);
});

test('explicit resource selection permits intentional shared edits; reused atlas regions stay protected otherwise', () => {
  const m = fixture();
  m.cubes.find((c) => c.id === 'rightCube').faces.north.uv = [0, 0, 2, 2];
  const paint = { op: 'paint', id: 'atlas', rect: [0, 0, 1, 1], color: [1, 2, 3, 255] };
  assert.throws(() => applyRepair(m, [paint], ['left']), /UV scope/);
  const ctx = JSON.parse(prepareRepair(m, ['left'], 'paint').prompt.split('Reference JSON:\n')[1]);
  assert.equal(ctx.textures[0].regions[0].writable, false);
  assert.deepEqual(
    applyRepair(m, [paint], ['texture:atlas']).textures[0].pixels.slice(0, 4),
    [1, 2, 3, 255],
  );
  const a = applyRepair(
    m,
    [{ op: 'set-track', id: 'walk', track: track('right', 44) }],
    ['animation:walk'],
  );
  assert.equal(
    a.animations[0].tracks.find((t) => t.group === 'right').keyframes.at(-1).value[0],
    44,
  );
  const material = applyRepair(
    m,
    [{ op: 'replace', kind: 'material', id: 'gold', node: { id: 'gold', color: '#000000' } }],
    ['material:gold'],
  );
  assert.equal(material.materials[0].color, '#000000');
  assert.throws(
    () =>
      applyRepair(m, [{ op: 'translate', id: 'leftCube', offset: [1, 0, 0] }], ['texture:atlas']),
    /scope/,
  );
});

test('scoped resource creation must be attached to selected content and cannot introduce invalid UVs', () => {
  const m = fixture(),
    cube = structuredClone(m.cubes.find((c) => c.id === 'leftCube'));
  cube.material = 'ivory';
  cube.faces.north.texture = 'newAtlas';
  const operations = [
    { op: 'add', kind: 'material', id: 'ivory', node: { id: 'ivory', color: '#eecc99' } },
    {
      op: 'add',
      kind: 'texture',
      id: 'newAtlas',
      node: { id: 'newAtlas', name: 'New', width: 2, height: 2, pixels: Array(16).fill(255) },
    },
    { op: 'replace', id: 'leftCube', node: cube },
    {
      op: 'add',
      kind: 'animation',
      id: 'bow',
      node: { id: 'bow', name: 'Bow', length: 1, loop: false, tracks: [track('left', 20)] },
    },
  ];
  assert.deepEqual(validate(applyRepair(m, operations, ['left'])), []);
  assert.throws(() => applyRepair(m, [operations[0]], ['left']), /must be used/);
  assert.throws(
    () =>
      applyRepair(
        m,
        [
          {
            op: 'add',
            kind: 'animation',
            id: 'bad',
            node: { id: 'bad', name: 'Bad', length: 1, loop: false, tracks: [track('right')] },
          },
        ],
        ['left'],
      ),
    /outside repair scope/,
  );
  cube.faces.north.uv = [0, 0, 300, 300];
  assert.throws(
    () =>
      applyRepair(
        m,
        [{ op: 'replace', id: 'leftCube', node: cube }, operations[0], operations[1]],
        ['left'],
      ),
    /technical UV/,
  );
  const before = serialize(m);
  assert.throws(() =>
    applyRepair(
      m,
      [
        { op: 'rename', id: 'leftCube', name: 'Changed' },
        { op: 'translate', id: 'rightCube', offset: [1, 0, 0] },
      ],
      ['left'],
    ),
  );
  assert.equal(serialize(m), before);
  assert.throws(
    () =>
      applyRepair(
        m,
        Array.from({ length: 257 }, () => ({ op: 'rename', id: 'leftCube', name: 'L' })),
        ['left'],
      ),
    /operation budget/,
  );
});

test('larger selection context uses a lossless compact geometry table and executes identical patches', () => {
  const m = fixture(),
    prototype = m.cubes.find((c) => c.id === 'leftCube');
  for (let i = 0; i < 115; i++)
    m.cubes.push({
      ...structuredClone(prototype),
      id: 'selected_' + i,
      name: 'Selected detail ' + i,
      from: [0, i + 2, 0],
      to: [1, i + 3, 1],
      origin: [0, i + 2, 0],
    });
  const request = prepareRepair(m, ['node:left'], 'Rename only the first selected detail.');
  const context = JSON.parse(request.prompt.split('Reference JSON:\n')[1]);
  assert.ok(
    context.nodeEncoding,
    'large repeated geometry should use a compact table rather than fail',
  );
  const decoded = context.nodes.map((tuple) => {
    const fields = context.nodeEncoding[tuple[0]],
      node = {};
    fields.slice(1).forEach((field, i) => {
      const value = tuple[i + 1];
      if (value === null) return;
      node[field] =
        field === 'faces'
          ? Object.fromEntries(
              value.map(([name, index]) => [name, context.nodeEncoding.faceRecords[index]]),
            )
          : value;
    });
    return node;
  });
  assert.deepEqual(
    decoded,
    m.groups.concat(m.cubes).filter((n) => request.editable.nodes.includes(n.id)),
  );
  assert.ok(request.contextBytes <= REPAIR_LIMITS.contextBytes);
  const operations = [{ op: 'rename', id: 'selected_0', name: 'Refined detail' }];
  assert.equal(
    serialize(applyRepair(m, operations, ['node:left'])),
    serialize(applyPatch(m, operations)),
  );
});

test('uniform subtree scale matches an independent world-space transform through rotated animated parents', () => {
  const m = fixture(),
    root = m.groups.find((g) => g.id === 'root'),
    left = m.groups.find((g) => g.id === 'left');
  root.origin = [2, -1, 1];
  root.rotation = [21, -17, 33];
  left.origin = [1, 2, 3];
  left.rotation = [15, 25, -10];
  m.groups.push({
    id: 'wrist',
    name: 'Wrist',
    parent: 'left',
    origin: [0.2, -1, 2],
    rotation: [-14, 11, 27],
  });
  m.cubes.push({
    id: 'finger',
    name: 'Finger',
    parent: 'wrist',
    from: [0, -2, 1],
    to: [0.5, -1, 2],
    origin: [0.2, -1, 2],
    rotation: [11, 17, -19],
    color: 0,
  });
  const position = (group, start, end) => ({
    group,
    channel: 'position',
    keyframes: [
      { time: 0, value: start, interpolation: 'linear' },
      { time: 1, value: end, interpolation: 'linear' },
    ],
  });
  m.animations[0].tracks.push(
    position('root', [0, 0, 0], [2, -1, 3]),
    position('left', [0.2, 0.3, 0], [1, 2, -1]),
    position('wrist', [0, 0, 0], [0.5, 0.2, -0.1]),
    track('wrist', -35),
    {
      group: 'left',
      channel: 'scale',
      keyframes: [
        { time: 0, value: [1, 1, 1], interpolation: 'linear' },
        { time: 1, value: [1.1, 1.1, 1.1], interpolation: 'linear' },
      ],
    },
  );
  const before = serialize(m),
    factor = 1.75;
  for (const explicitPivot of [undefined, [0, 1, 3]]) {
    const operation = {
      op: 'scale-subtree',
      id: 'left',
      factor,
      ...(explicitPivot ? { pivot: explicitPivot } : {}),
    };
    const result = applyRepair(m, [operation], ['node:left']);
    const pivot = explicitPivot ?? left.origin;
    for (const time of [0, 0.25, 0.5, 1]) {
      const pose = sampleAnimation(m, 'walk', time),
        scaledPose = sampleAnimation(result, 'walk', time);
      const a = geometry(m, pose),
        b = geometry(result, scaledPose),
        worldPivot = bonePoint(m, 'root', pivot, pose);
      for (const cube of a) {
        const after = b.find((c) => c.id === cube.id);
        for (let i = 0; i < 8; i++) {
          const expected = ['leftCube', 'finger'].includes(cube.id)
            ? cube.vertices[i].map((n, k) => worldPivot[k] + (n - worldPivot[k]) * factor)
            : cube.vertices[i];
          assert.ok(
            Math.hypot(...after.vertices[i].map((n, k) => n - expected[k])) < 1e-7,
            JSON.stringify({ id: cube.id, time, expected, actual: after.vertices[i] }),
          );
        }
      }
    }
    assert.deepEqual(result.textures, m.textures);
    assert.deepEqual(result.materials, m.materials);
    assert.deepEqual(
      result.cubes.find((c) => c.id === 'leftCube').faces,
      m.cubes.find((c) => c.id === 'leftCube').faces,
    );
    for (const t of m.animations[0].tracks) {
      const actual = result.animations[0].tracks.find(
        (v) => v.group === t.group && v.channel === t.channel,
      );
      if (t.channel !== 'position' || !['left', 'wrist'].includes(t.group))
        assert.deepEqual(actual, t);
      else
        assert.deepEqual(
          actual.keyframes.map((k) => k.value),
          t.keyframes.map((k) => k.value.map((n) => n * factor)),
        );
    }
    assert.deepEqual(
      result.groups.find((g) => g.id === 'wrist').origin,
      m.groups
        .find((g) => g.id === 'wrist')
        .origin.map((n, i) => pivot[i] + (n - pivot[i]) * factor),
      'nested origins scale once',
    );
  }
  assert.equal(serialize(m), before);
});

test('transform-only selection keeps a large subtree compact and authorizes only the explicit group transform', () => {
  const m = fixture(),
    prototype = m.cubes.find((c) => c.id === 'leftCube');
  for (let i = 0; i < 600; i++)
    m.cubes.push({
      ...structuredClone(prototype),
      id: 'part_' + i,
      name: 'Part ' + i,
      from: [0, i + 2, 0],
      to: [1, i + 3, 1],
      origin: [0, i + 2, 0],
    });
  assert.throws(() => prepareRepair(m, ['node:left'], 'Enlarge this subtree'), /node budget/);
  const request = prepareRepair(m, ['transform:left'], 'Enlarge this subtree uniformly by 1.5');
  const context = JSON.parse(request.prompt.split('Reference JSON:\n')[1]);
  assert.deepEqual(request.editable.nodes, []);
  assert.deepEqual(request.editable.transforms, ['left']);
  assert.equal(context.nodes.length, 0);
  assert.equal(context.transformSubtrees[0].cubeCount, 601);
  assert.deepEqual(context.transformSubtrees[0].restWorldBounds, {
    min: [0, 0, 0],
    max: [1, 602, 1],
  });
  assert.ok(request.contextBytes < 6000, request.contextBytes);
  const operation = { op: 'scale-subtree', id: 'left', factor: 1.5 };
  assert.equal(
    serialize(applyRepair(m, [operation], ['transform:left'])),
    serialize(applyPatch(m, [operation])),
  );
  for (const op of [
    { op: 'translate', id: 'leftCube', offset: [1, 0, 0] },
    { op: 'rename', id: 'left', name: 'Changed' },
    { op: 'paint', id: 'atlas', rect: [0, 0, 1, 1], color: [0, 0, 0, 255] },
    { op: 'set-track', id: 'walk', track: track('left') },
    { op: 'scale-subtree', id: 'right', factor: 2 },
  ])
    assert.throws(() => applyRepair(m, [op], ['transform:left']), /scope/);
  assert.throws(() => applyRepair(fixture(), [operation], ['node:leftCube']), /scope/);
});

test('subtree scaling rejects malformed factors, pivots, non-groups and coordinate overflow atomically', () => {
  const m = fixture(),
    before = serialize(m);
  for (const operation of [
    ...[0, -1, 0.01, 11, Infinity, NaN, '2'].map((factor) => ({
      op: 'scale-subtree',
      id: 'left',
      factor,
    })),
    { op: 'scale-subtree', id: 'leftCube', factor: 2 },
    { op: 'scale-subtree', id: 'left', factor: 2, pivot: [0, 0] },
    { op: 'scale-subtree', id: 'left', factor: 2, pivot: [0, 0, Infinity] },
    { op: 'scale-subtree', id: 'left', factor: 2, pivot: [0, 0, 1000001] },
    { op: 'scale-subtree', id: 'left', factor: 2, script: 'scaleEverything()' },
  ]) {
    assert.throws(() => applyPatch(m, [operation]));
    assert.equal(serialize(m), before);
  }
  const far = fixture();
  far.cubes.find((c) => c.id === 'leftCube').from = [999998, 0, 0];
  far.cubes.find((c) => c.id === 'leftCube').to = [999999, 1, 1];
  const farBefore = serialize(far);
  assert.throws(
    () => applyPatch(far, [{ op: 'scale-subtree', id: 'left', factor: 10 }]),
    /bounded/,
  );
  assert.equal(serialize(far), farBefore);
});

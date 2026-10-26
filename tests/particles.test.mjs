import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { serialize } from '../packages/core/dist/model.js';
import { bonePoint } from '../packages/core/dist/geometry.js';
import { sampleAnimation } from '../packages/core/dist/animation.js';
import {
  PARTICLE_LIMITS,
  particleModelDigest,
  parseParticleDocument,
  validateParticleDocument,
  sampleParticles,
} from '../packages/core/dist/particles.js';

const group = (id, extra = {}) => ({
  id,
  name: id,
  origin: [0, 0, 0],
  rotation: [0, 0, 0],
  ...extra,
});
const track = (group, channel, values, length = 2, interpolation = 'linear') => ({
  group,
  channel,
  keyframes: values.map((value, i) => ({
    time: (i * length) / Math.max(1, values.length - 1),
    value,
    interpolation,
  })),
});
const model = (extra = {}) => ({
  version: 2,
  name: 'particle-rig',
  format: 'free',
  resolution: [16, 16],
  cubes: [],
  groups: [group('root')],
  animations: [{ id: 'move', name: 'move', length: 2, loop: false, tracks: [] }],
  ...extra,
});
const recipe = (extra = {}) => ({
  id: 'sparks',
  seed: 123456789,
  shape: 'cone',
  direction: [1, 0, 0],
  spread: 0,
  speed: [2, 2],
  lifetime: [1, 1],
  acceleration: [0, 0, 0],
  drag: 0,
  size: [
    [0, 2],
    [1, 0],
  ],
  color: [
    [0, '#ff0000ff'],
    [1, '#0000ff00'],
  ],
  render: 'sprite',
  blend: 'additive',
  ...extra,
});
const event = (extra = {}) => ({
  id: 'impact',
  animation: 'move',
  time: 0.25,
  recipe: 'sparks',
  duration: 0,
  rate: 0,
  burst: 1,
  attachment: { group: 'root', point: [0, 0, 0] },
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
const near = (actual, expected, epsilon = 1e-9) => {
  if (Array.isArray(expected)) expected.forEach((value, i) => near(actual[i], value, epsilon));
  else assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test('particle documents are strict detached sidecars bound to canonical model bytes', () => {
  const rig = model(),
    value = document(rig),
    before = serialize(rig);
  assert.equal(value.modelDigest, createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(validateParticleDocument(rig, value), []);
  const parsed = parseParticleDocument(rig, JSON.stringify(value));
  assert.deepEqual(parsed, value);
  parsed.recipes[0].direction[0] = 0;
  assert.equal(value.recipes[0].direction[0], 1);
  assert.equal(serialize(rig), before);
  assert.equal(rig.cubes.length, 0, 'Particle parsing never creates proxy geometry');
  const changed = structuredClone(rig);
  changed.animations[0].loop = true;
  assert.throws(() => parseParticleDocument(changed, value), /digest does not match/);
  assert.throws(() => parseParticleDocument(rig, '{invalid'), /Invalid particle JSON/);
  assert.throws(
    () => parseParticleDocument(rig, ' '.repeat(PARTICLE_LIMITS.bytes + 1)),
    /exceeds 2 MB/,
  );
});

test('burst particles have analytic positions, normalized-age curves, and exact lifetime boundaries', () => {
  const rig = model(),
    value = document(rig);
  assert.deepEqual(sampleParticles(rig, value, 'move', 0.25 - Number.EPSILON), []);
  const born = sampleParticles(rig, value, 'move', 0.25);
  assert.equal(born.length, 1);
  assert.equal(born[0].age, 0);
  const [half] = sampleParticles(rig, value, 'move', 0.75);
  near(half.position, [1, 0, 0]);
  near(half.size, 1);
  assert.equal(half.color, '#80008080');
  assert.equal(half.blend, 'additive');
  assert.equal(half.render, 'sprite');
  assert.equal(half.id, born[0].id);
  assert.equal(half.age, 0.5);
  assert.equal(half.lifetime, 1);
  assert.deepEqual(sampleParticles(rig, value, 'move', 1.25), []);
  assert.deepEqual(sampleParticles(rig, value, 'move', 1000), []);
});

test('constant acceleration and linear drag use a stable closed-form ballistic limit', () => {
  const rig = model();
  const value = document(rig, {
    recipes: [recipe({ lifetime: [2, 2], acceleration: [0, -4, 0], drag: 2 })],
    events: [event({ time: 0 })],
  });
  const age = 0.75,
    a = (1 - Math.exp(-2 * age)) / 2,
    b = (age - a) / 2;
  near(sampleParticles(rig, value, 'move', age)[0].position, [2 * a, -4 * b, 0]);
  for (const drag of [0, 1e-12]) {
    value.recipes[0].drag = drag;
    near(sampleParticles(rig, value, 'move', age)[0].position, [2 * age, -2 * age ** 2, 0], 1e-10);
  }
});

test('seeded cones stay inside their angle/speed ranges and support reproducible seeking', () => {
  const rig = model();
  const value = document(rig, {
    recipes: [recipe({ direction: [0, 5, 0], spread: 30, speed: [2, 4], lifetime: [0.5, 1.5] })],
    events: [event({ time: 0, burst: 32 })],
  });
  const before = JSON.stringify(value),
    originalRandom = Math.random;
  let first;
  try {
    Math.random = () => {
      throw new Error('Particle evaluation must not use global randomness');
    };
    first = sampleParticles(rig, value, 'move', 0.1);
    sampleParticles(rig, value, 'move', 1.4);
    sampleParticles(rig, value, 'move', 0.01);
    assert.deepEqual(sampleParticles(rig, value, 'move', 0.1), first);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(first.length, 32);
  for (const p of first) {
    const distance = Math.hypot(...p.position);
    assert.ok(distance / p.age >= 2 - 1e-12 && distance / p.age <= 4 + 1e-12);
    assert.ok(p.position[1] / distance >= Math.cos(Math.PI / 6) - 1e-12);
    assert.ok(p.lifetime >= 0.5 && p.lifetime <= 1.5);
  }
  assert.ok(new Set(first.map((p) => p.lifetime)).size > 20);
  assert.ok(new Set(first.map((p) => p.position.join(','))).size > 20);
  assert.equal(JSON.stringify(value), before);
  value.recipes[0].seed++;
  const reseeded = sampleParticles(rig, value, 'move', 0.1);
  assert.notDeepEqual(
    reseeded.map((p) => p.position),
    first.map((p) => p.position),
  );
  assert.deepEqual(
    reseeded.map((p) => p.id),
    first.map((p) => p.id),
  );
});

test('subnormal nonzero cone directions normalize without changing launch speed', () => {
  const rig = model(),
    value = document(rig, {
      recipes: [recipe({ direction: [Number.MIN_VALUE, Number.MIN_VALUE, 0], speed: [1, 1] })],
      events: [event({ time: 0 })],
    });
  const [particle] = sampleParticles(rig, value, 'move', 0.5);
  near(particle.position, [Math.SQRT1_2 / 2, Math.SQRT1_2 / 2, 0]);
  near(Math.hypot(...particle.position), 0.5);
});

test('burst and rate births are independent and duration excludes its right endpoint', () => {
  const rig = model(),
    value = document(rig, {
      recipes: [recipe({ speed: [0, 0], lifetime: [2, 2] })],
      events: [event({ time: 0, burst: 2, rate: 4, duration: 0.5 })],
    });
  const particles = sampleParticles(rig, value, 'move', 0.5);
  assert.equal(particles.length, 4);
  assert.deepEqual(
    particles.map((p) => p.id),
    ['impact/0/burst/0', 'impact/0/burst/1', 'impact/0/rate/0', 'impact/0/rate/1'],
  );
  near(
    particles.map((p) => p.age),
    [0.5, 0.5, 0.5, 0.25],
  );
  value.events = [event({ time: 0, burst: 0, rate: Number.MIN_VALUE, duration: Number.MIN_VALUE })];
  assert.equal(
    sampleParticles(rig, value, 'move', 0).length,
    1,
    'Every positive rate/duration includes the n=0 birth',
  );
});

test('nested parent rotations, pivots, translations and animated scale match the geometry transform', () => {
  const groups = [
    group('parent', { origin: [1, 2, 3], rotation: [0, 0, 90] }),
    group('child', { parent: 'parent', origin: [3, 2, 3], rotation: [90, 0, 90] }),
  ];
  const tracks = [
    track('parent', 'scale', [[2, 3, 4]]),
    track('parent', 'position', [[5, -2, 1]]),
    track('child', 'scale', [[1, 2, 3]]),
    track('child', 'position', [[1, 2, -1]]),
  ];
  const rig = model({
    groups,
    animations: [{ id: 'move', name: 'move', length: 2, loop: false, tracks }],
  });
  const value = document(rig, {
    recipes: [
      recipe({
        lifetime: [2, 2],
        speed: [0, 0],
        size: [
          [0, 1],
          [1, 1],
        ],
      }),
    ],
    events: [event({ time: 0, attachment: { group: 'child', point: [4, 3, 5] } })],
  });
  near(bonePoint(rig, 'child', [4, 3, 5], sampleAnimation(rig, 'move', 0)), [-3, 18, 8]);
  const [stationary] = sampleParticles(rig, value, 'move', 1);
  near(stationary.position, [-3, 18, 8]);
  near(stationary.size, Math.cbrt(144));
  value.recipes[0].direction = [1, 2, 3];
  value.recipes[0].speed = [Math.sqrt(14), Math.sqrt(14)];
  near(sampleParticles(rig, value, 'move', 1)[0].position, [-6, 36, 24]);
});

test('world particles freeze the birth frame while local particles inherit the observation frame', () => {
  const rig = model({
    animations: [
      {
        id: 'move',
        name: 'move',
        length: 2,
        loop: false,
        tracks: [
          track('root', 'position', [
            [0, 0, 0],
            [10, 0, 0],
          ]),
          track('root', 'rotation', [
            [0, 0, 0],
            [0, 0, 90],
          ]),
          track('root', 'scale', [
            [1, 1, 1],
            [3, 1, 1],
          ]),
        ],
      },
    ],
  });
  const value = document(rig, {
    recipes: [
      recipe({
        speed: [1, 1],
        lifetime: [2, 2],
        size: [
          [0, 1],
          [1, 1],
        ],
      }),
    ],
    events: [
      event({
        id: 'a-world',
        time: 0,
        attachment: { group: 'root', point: [1, 0, 0] },
        space: 'world',
      }),
      event({
        id: 'b-local',
        time: 0,
        attachment: { group: 'root', point: [1, 0, 0] },
        space: 'local',
      }),
    ],
  });
  const [world, local] = sampleParticles(rig, value, 'move', 1);
  near(world.position, [2, 0, 0]);
  near(local.position, [5 + 2 * Math.SQRT2, 2 * Math.SQRT2, 0]);
  near(world.size, 1);
  near(local.size, Math.cbrt(2));
  const born = sampleParticles(rig, value, 'move', 0);
  near(born[0].position, born[1].position);
});

test('looping history retains older live births and absolute seeks reproduce per-loop identities', () => {
  const rig = model({
    animations: [
      {
        id: 'move',
        name: 'move',
        length: 1,
        loop: true,
        tracks: [
          track(
            'root',
            'position',
            [
              [0, 0, 0],
              [10, 0, 0],
            ],
            1,
          ),
        ],
      },
    ],
  });
  const value = document(rig, {
    recipes: [recipe({ speed: [0, 0], lifetime: [2.5, 2.5] })],
    events: [event({ time: 0.125 })],
  });
  const first = sampleParticles(rig, value, 'move', 0.25),
    later = sampleParticles(rig, value, 'move', 2.25);
  assert.equal(first.length, 1);
  assert.equal(later.length, 3);
  assert.deepEqual(
    later.map((p) => p.id),
    ['impact/0/burst/0', 'impact/1/burst/0', 'impact/2/burst/0'],
  );
  near(
    later.map((p) => p.age),
    [2.125, 1.125, 0.125],
  );
  later.forEach((p) => near(p.position, [1.25, 0, 0]));
  assert.equal(sampleParticles(rig, value, 'move', 0.25)[0].id, first[0].id);
  assert.deepEqual(sampleParticles(rig, value, 'move', 2.25), later);
  assert.equal(
    sampleParticles(rig, value, 'move', 2.625).length,
    2,
    'Oldest birth expires exactly at its lifetime',
  );
});

test('loop random streams are distinct and distant seeks only reconstruct the bounded live history', () => {
  const rig = model({
    animations: [{ id: 'move', name: 'move', length: 1, loop: true, tracks: [] }],
  });
  const value = document(rig, {
    recipes: [recipe({ speed: [1, 3], spread: 30, lifetime: [2.5, 2.5] })],
    events: [event({ time: 0.125 })],
  });
  const nearby = sampleParticles(rig, value, 'move', 2.25);
  assert.equal(nearby.length, 3);
  assert.equal(new Set(nearby.map((p) => p.position.map((n) => n / p.age).join(','))).size, 3);
  const distant = sampleParticles(rig, value, 'move', 1_000_000_000.25);
  assert.deepEqual(
    distant.map((p) => p.id),
    ['impact/999999998/burst/0', 'impact/999999999/burst/0', 'impact/1000000000/burst/0'],
  );
  near(
    distant.map((p) => p.age),
    [2.125, 1.125, 0.125],
  );
  assert.deepEqual(sampleParticles(rig, value, 'move', 2.25), nearby);
  assert.deepEqual(sampleParticles(rig, value, 'move', 1_000_000_000.25), distant);
});

test('rate emitter occurrences may overlap loop boundaries without merging particle identities', () => {
  const rig = model({
    animations: [{ id: 'move', name: 'move', length: 1, loop: true, tracks: [] }],
  });
  const value = document(rig, {
    recipes: [recipe({ lifetime: [2, 2] })],
    events: [event({ time: 0, burst: 0, rate: 2, duration: 1.5 })],
  });
  const particles = sampleParticles(rig, value, 'move', 1.25);
  assert.deepEqual(
    particles.map((p) => p.id),
    ['impact/0/rate/0', 'impact/0/rate/1', 'impact/0/rate/2', 'impact/1/rate/0'],
  );
  near(
    particles.map((p) => p.age),
    [1.25, 0.75, 0.25, 0.25],
  );
});

test('loop wrapping preserves late-frame poses and never emits a future loop or event early', () => {
  const rig = model({
    animations: [
      {
        id: 'move',
        name: 'move',
        length: 1,
        loop: true,
        tracks: [
          track(
            'root',
            'position',
            [
              [0, 0, 0],
              [1_000_000, 0, 0],
            ],
            1,
          ),
        ],
      },
    ],
  });
  const value = document(rig, {
    recipes: [recipe({ speed: [0, 0], lifetime: [2, 2] })],
    events: [event({ time: 0, space: 'local' })],
  });
  const beforeWrap = sampleParticles(rig, value, 'move', 1 - Number.EPSILON);
  assert.equal(beforeWrap.length, 1);
  near(
    beforeWrap[0].position,
    bonePoint(rig, 'root', [0, 0, 0], sampleAnimation(rig, 'move', 1 - Number.EPSILON)),
    1e-7,
  );
  const wrapped = sampleParticles(rig, value, 'move', 1);
  assert.equal(wrapped.length, 2);
  wrapped.forEach((p) => near(p.position, [0, 0, 0]));
  const once = model(),
    future = document(once, { events: [event({ time: Number.EPSILON })] });
  assert.deepEqual(sampleParticles(once, future, 'move', 0), []);
});

test('step keys jump at the exact key and nonloop emission overrun uses the clamped final pose', () => {
  const rig = model({
    animations: [
      {
        id: 'move',
        name: 'move',
        length: 1,
        loop: false,
        tracks: [
          track(
            'root',
            'position',
            [
              [0, 0, 0],
              [10, 0, 0],
            ],
            1,
            'step',
          ),
        ],
      },
    ],
  });
  const value = document(rig, {
    recipes: [recipe({ speed: [0, 0], lifetime: [2, 2] })],
    events: [event({ time: 0.75, rate: 4, burst: 0, duration: 0.75 })],
  });
  const particles = sampleParticles(rig, value, 'move', 1.5);
  assert.equal(particles.length, 3);
  near(
    particles.map((p) => p.position[0]),
    [0, 10, 10],
  );
  value.events[0].space = 'local';
  sampleParticles(rig, value, 'move', 1.5).forEach((p) => near(p.position, [10, 0, 0]));
});

test('schema rejects unknown fields, bad references, sparse data, malformed curves and unsupported behavior', () => {
  const rig = model();
  const mutations = [
    (d) => {
      d.extra = true;
    },
    (d) => {
      d.version = 2;
    },
    (d) => {
      d.recipes[0].expression = 'Math.random()';
    },
    (d) => {
      d.events[0].attachment.path = '/secret';
    },
    (d) => {
      d.events[0].extra = true;
    },
    (d) => {
      d.events[0].animation = 'missing';
    },
    (d) => {
      d.events[0].recipe = 'missing';
    },
    (d) => {
      d.events[0].attachment.group = 'missing';
    },
    (d) => {
      d.recipes.push(structuredClone(d.recipes[0]));
    },
    (d) => {
      d.events.push(structuredClone(d.events[0]));
    },
    (d) => {
      d.recipes[0].direction = [0, 0, 0];
    },
    (d) => {
      d.recipes[0].direction = [, , 1];
    },
    (d) => {
      d.events = Array(1);
    },
    (d) => {
      d.recipes = Array(1);
    },
    (d) => {
      d.recipes[0].seed = -1;
    },
    (d) => {
      d.recipes[0].seed = 2 ** 32;
    },
    (d) => {
      d.recipes[0].speed = [2, 1];
    },
    (d) => {
      d.recipes[0].lifetime = [0, 1];
    },
    (d) => {
      d.recipes[0].lifetime = [1, 5.01];
    },
    (d) => {
      d.recipes[0].spread = 181;
    },
    (d) => {
      d.recipes[0].drag = -1;
    },
    (d) => {
      d.recipes[0].acceleration[0] = Infinity;
    },
    (d) => {
      d.recipes[0].size = [
        [0, 1],
        [0, 2],
        [1, 0],
      ];
    },
    (d) => {
      d.recipes[0].color[0][1] = '#ff0000';
    },
    (d) => {
      d.recipes[0].size[0][0] = 0.1;
    },
    (d) => {
      d.recipes[0].size[1][0] = 0.9;
    },
    (d) => {
      d.recipes[0].render = 'mesh';
    },
    (d) => {
      d.recipes[0].blend = 'multiply';
    },
    (d) => {
      d.recipes[0].shape = 'molang';
    },
    (d) => {
      d.events[0].space = 'screen';
    },
    (d) => {
      d.events[0].rate = 257;
    },
    (d) => {
      d.events[0].burst = 513;
    },
    (d) => {
      d.events[0].burst = 1.5;
    },
    (d) => {
      d.events[0].duration = 11;
    },
    (d) => {
      d.events[0].time = 3;
    },
    (d) => {
      d.events[0].burst = 0;
    },
    (d) => {
      d.recipes = Array.from({ length: 65 }, (_, i) => recipe({ id: `r${i}` }));
    },
    (d) => {
      d.events = Array.from({ length: 257 }, (_, i) => event({ id: `e${i}` }));
    },
    (d) => {
      d.recipes[0].size = Array.from({ length: 33 }, (_, i) => [i / 32, 1]);
    },
  ];
  for (const mutate of mutations) {
    const value = document(rig);
    mutate(value);
    assert.ok(validateParticleDocument(rig, value).length, mutate.toString());
    assert.throws(() => parseParticleDocument(rig, value), undefined, mutate.toString());
  }
  const loop = model({
    animations: [{ id: 'move', name: 'move', length: 1, loop: true, tracks: [] }],
  });
  assert.throws(
    () => parseParticleDocument(loop, document(loop, { events: [event({ time: 1 })] })),
    /before clip end/,
  );
  for (const time of [-1, NaN, Infinity])
    assert.throws(() => sampleParticles(rig, document(rig), 'move', time), /sample time/);
  assert.throws(() => sampleParticles(rig, document(rig), 'missing', 0), /Unknown animation/);
});

test('inclusive declaration limits and empty sidecars are supported without dropping particles', () => {
  const rig = model();
  const value = document(rig, {
    recipes: Array.from({ length: 64 }, (_, i) =>
      recipe({ id: `r${i}`, seed: 0xffffffff, lifetime: [5, 5] }),
    ),
    events: Array.from({ length: 256 }, (_, i) => event({ id: `e${i}`, recipe: 'r0', time: 0 })),
  });
  assert.equal(parseParticleDocument(rig, value).recipes.length, 64);
  assert.equal(sampleParticles(rig, value, 'move', 0).length, 256);
  value.events = [event({ time: 0, recipe: 'r0', rate: 256, burst: 512, duration: 10 })];
  assert.equal(sampleParticles(rig, value, 'move', 0).length, 513);
  assert.deepEqual(sampleParticles(rig, document(rig, { recipes: [], events: [] }), 'move', 0), []);
});

test('live, evaluated-birth and schedule budgets fail explicitly instead of truncating', () => {
  const rig = model();
  const withBursts = (count, burst, lifetime) =>
    document(rig, {
      recipes: [recipe({ lifetime: [lifetime, lifetime] })],
      events: Array.from({ length: count }, (_, i) => event({ id: `e${i}`, time: 0, burst })),
    });
  assert.equal(sampleParticles(rig, withBursts(4, 256, 2), 'move', 0).length, 1024);
  assert.throws(() => sampleParticles(rig, withBursts(5, 256, 2), 'move', 0), /live count budget/);
  assert.deepEqual(sampleParticles(rig, withBursts(8, 512, 1), 'move', 1), []);
  assert.throws(
    () => sampleParticles(rig, withBursts(9, 512, 1), 'move', 1),
    /evaluated birth budget/,
  );
  const loop = model({
    animations: [{ id: 'move', name: 'move', length: 0.0001, loop: true, tracks: [] }],
  });
  const value = document(loop, {
    recipes: [recipe({ lifetime: [5, 5] })],
    events: [event({ time: 0 })],
  });
  assert.throws(() => sampleParticles(loop, value, 'move', 1), /schedule iteration budget/);
  assert.throws(
    () => sampleParticles(loop, value, 'move', Number.MAX_SAFE_INTEGER),
    /timeline precision budget/,
  );
});

test('transform work and unrepresentable inherited scales are rejected within a valid model', () => {
  const groups = Array.from({ length: 32 }, (_, i) =>
    group(`g${i}`, i ? { parent: `g${i - 1}` } : {}),
  );
  const tracks = groups.flatMap((g) =>
    ['position', 'rotation', 'scale'].map((channel) =>
      track(
        g.id,
        channel,
        Array.from({ length: 32 }, () => (channel === 'scale' ? [1, 1, 1] : [0, 0, 0])),
        4,
      ),
    ),
  );
  const rig = model({
    groups,
    animations: [{ id: 'move', name: 'move', length: 4, loop: false, tracks }],
  });
  const value = document(rig, {
    recipes: [recipe({ lifetime: [5, 5] })],
    events: [
      event({
        time: 0,
        burst: 0,
        duration: 4,
        rate: 256,
        attachment: { group: 'g31', point: [0, 0, 0] },
      }),
    ],
  });
  assert.throws(() => sampleParticles(rig, value, 'move', 3.99), /transform work budget/);
  const tiny = model({
    groups: groups.slice(0, 2),
    animations: [
      {
        id: 'move',
        name: 'move',
        length: 2,
        loop: false,
        tracks: groups.slice(0, 2).map((g) => track(g.id, 'scale', [[1e-300, 1e-300, 1e-300]])),
      },
    ],
  });
  const small = document(tiny, {
    recipes: [recipe({ speed: [0, 0] })],
    events: [event({ attachment: { group: 'g1', point: [0, 0, 0] } })],
  });
  assert.throws(() => sampleParticles(tiny, small, 'move', 0.5), /Unrepresentable particle size/);
});

test('particle object and indexed array accessors reject without running or returning unchecked data', () => {
  const rig = model();
  const locations = [
    (d) => [d, 'modelDigest'],
    (d) => [d, 'recipes'],
    (d) => [d.recipes[0], 'render'],
    (d) => [d.events[0], 'space'],
    (d) => [d.events[0].attachment, 'point'],
    (d) => [d.recipes, '0'],
    (d) => [d.events, '0'],
    (d) => [d.recipes[0].direction, '0'],
    (d) => [d.recipes[0].acceleration, '0'],
    (d) => [d.recipes[0].speed, '0'],
    (d) => [d.recipes[0].lifetime, '0'],
    (d) => [d.recipes[0].size, '0'],
    (d) => [d.recipes[0].size[0], '1'],
    (d) => [d.recipes[0].color[0], '1'],
    (d) => [d.events[0].attachment.point, '0'],
  ];
  for (const location of locations) {
    const value = document(rig),
      [container, key] = location(value),
      original = container[key];
    let reads = 0;
    Object.defineProperty(container, key, {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        return reads === 1 ? original : 'unchecked';
      },
    });
    assert.throws(() => parseParticleDocument(rig, value), /Accessors are not particle data/);
    assert.ok(validateParticleDocument(rig, value).length);
    assert.equal(reads, 0, location.toString());
  }
  const setterOnly = document(rig);
  Object.defineProperty(setterOnly.recipes[0].direction, '0', {
    set() {
      assert.fail('Setter invoked');
    },
  });
  assert.throws(() => parseParticleDocument(rig, setterOnly), /Accessors are not particle data/);
});

test('particle boundaries reject custom prototypes and array behavior but retain ordinary detached data', () => {
  const rig = model();
  for (const select of [(d) => d, (d) => d.recipes[0], (d) => d.events[0].attachment]) {
    const value = document(rig);
    Object.setPrototypeOf(select(value), { inherited: true });
    assert.throws(() => parseParticleDocument(rig, value), /plain data object/);
  }
  for (const select of [
    (d) => d.recipes,
    (d) => d.recipes[0].direction,
    (d) => d.recipes[0].speed,
    (d) => d.recipes[0].size[0],
    (d) => d.events[0].attachment.point,
  ]) {
    const value = document(rig);
    Object.setPrototypeOf(select(value), Object.create(Array.prototype));
    assert.throws(() => parseParticleDocument(rig, value), /Expected an array/);
  }
  const inherited = document(rig),
    prototype = Object.create(Array.prototype);
  prototype[0] = inherited.recipes[0];
  inherited.recipes = Object.setPrototypeOf(Array(1), prototype);
  assert.throws(() => parseParticleDocument(rig, inherited), /Expected an array/);
  const iterator = document(rig);
  let iteratorCalls = 0;
  iterator.recipes[0].direction[Symbol.iterator] = function* () {
    iteratorCalls++;
    yield 1;
    yield 0;
    yield 0;
  };
  assert.throws(() => parseParticleDocument(rig, iterator), /Unknown particle array property/);
  assert.equal(iteratorCalls, 0);
  const plain = document(rig),
    expected = structuredClone(plain);
  Object.setPrototypeOf(plain, null);
  Object.setPrototypeOf(plain.recipes[0], null);
  const parsed = parseParticleDocument(rig, plain);
  assert.deepEqual(parsed, expected);
  parsed.recipes[0].size[0][1] = 999;
  assert.equal(plain.recipes[0].size[0][1], 2);
});

test('particle identities sort by code units independently of locale collation', () => {
  const rig = model(),
    value = document(rig, { events: ['i', 'J', 'I', 'j'].map((id) => event({ id, time: 0 })) });
  const original = String.prototype.localeCompare;
  try {
    String.prototype.localeCompare = () => {
      throw new Error('Locale collation must not order particle IDs');
    };
    assert.deepEqual(
      sampleParticles(rig, value, 'move', 0).map((p) => p.id),
      ['I/0/burst/0', 'J/0/burst/0', 'i/0/burst/0', 'j/0/burst/0'],
    );
  } finally {
    String.prototype.localeCompare = original;
  }
});

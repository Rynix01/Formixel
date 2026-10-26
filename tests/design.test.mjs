import test from 'node:test';
import assert from 'node:assert/strict';
import { authorDesign, parseDesignDocument, reviewModel } from '../packages/core/dist/design.js';
import {
  parseFXL,
  geometry,
  bonePoint,
  sampleAnimation,
  serialize,
  validate,
} from '../packages/core/dist/index.js';

const source = `model "surface_fixture"
group body origin [0,2,0] {
  cube plate [-2,0,-1] [4,4,2]
  cube cap [-2,4,-1] [4,1,2]
}
animation idle 1 loop { rotate body 0 [0,0,0] rotate body 1 [0,0,0] }
`;
const marker = (group, point) => ({ group, point });
const recipe = (id, kind, base, accent, detail = 1) => ({
  id,
  kind,
  base,
  accent,
  detail,
  seed: 1234,
});
const make = () => ({
  version: 1,
  source,
  authoring: {
    atlas: {
      size: [64, 64],
      texelsPerUnit: 2,
      recipes: [
        recipe('stone', 'scales', '#24242b', '#5c5c68'),
        recipe('gold', 'metal', '#bd8237', '#ffe298'),
      ],
      parts: [
        { cubes: ['body/plate'], recipe: 'stone', faces: { up: 'gold' } },
        { cubes: ['body/cap'], recipe: 'gold' },
      ],
    },
    constraints: [
      { id: 'floor', type: 'ground', cubes: ['body/plate', 'body/cap'], floor: 0, tolerance: 0 },
      {
        id: 'sole',
        type: 'contact',
        marker: marker('body', [0, 0, 0]),
        floor: 0,
        tolerance: 0.001,
        lockXZ: [0, 0],
      },
      {
        id: 'upright',
        type: 'level',
        a: marker('body', [0, 0, 0]),
        b: marker('body', [0, 2, 0]),
        axis: [0, 1, 0],
        maxDegrees: 0,
      },
    ],
  },
});

test('design paints physical face dimensions with explicit part and face recipes deterministically', () => {
  const spec = make(),
    before = JSON.stringify(spec),
    a = authorDesign(parseDesignDocument(spec)),
    b = authorDesign(spec);
  assert.equal(JSON.stringify(spec), before, 'authoring must not mutate the input');
  assert.equal(serialize(a.model), serialize(b.model));
  assert.deepEqual(validate(a.model), []);
  assert.equal(a.report.passed, true);
  assert.equal(a.report.atlas.faces, 12);
  assert.equal(a.report.atlas.coveredCubes, 2);
  const texture = a.model.textures.find((t) => t.id === 'formixel_design_atlas');
  const plate = a.model.cubes.find((c) => c.id === 'body/plate');
  assert.deepEqual(
    plate.faces.north.uv.slice(2).map((n, i) => n - plate.faces.north.uv[i]),
    [8, 8],
  );
  assert.deepEqual(
    plate.faces.east.uv.slice(2).map((n, i) => n - plate.faces.east.uv[i]),
    [4, 8],
  );
  const pixel = (face, x, y) => {
    const uv = plate.faces[face].uv,
      offset = ((uv[1] + y) * texture.width + uv[0] + x) * 4;
    return texture.pixels.slice(offset, offset + 4);
  };
  const up = pixel('up', 0, 0),
    north = pixel('north', 2, 2);
  assert.ok(
    up[0] > north[0] * 2 && up[1] > north[1] * 2,
    'gold override must change actual atlas pixels',
  );
  const shades = new Set();
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) shades.add(pixel('north', x, y).join(','));
  assert.ok(shades.size > 8, 'scales must contain detailed, deterministic texels');
  assert.deepEqual(
    pixel('north', -1, 3),
    pixel('north', 0, 3),
    'allocated edges must be extruded into padding',
  );
  assert.ok(a.report.checks.every((c) => c.samples > 25));
});

test('design rejects unknown fields, unknown unused targets, missing coverage and exhausted budgets', () => {
  for (const mutate of [
    (d) => (d.authoring.atlas.recipes[0].program = 'process.exit()'),
    (d) => (d.authoring.atlas.parts[0].faces.typo = 'stone'),
    (d) => (d.authoring.atlas.parts[1].cubes = ['body/missing']),
    (d) => (d.authoring.atlas.parts[1].cubes = ['body/plate']),
    (d) => d.authoring.atlas.parts.pop(),
    (d) => (d.authoring.atlas.parts[0].faces.down = 'missing_recipe'),
    (d) => d.authoring.atlas.recipes.push(recipe('unused', 'solid', '#ffffff', '#ffffff')),
    (d) =>
      d.authoring.constraints.push({
        id: 'unused',
        type: 'contact',
        animations: [],
        marker: marker('missing', [0, 0, 0]),
        floor: 0,
        tolerance: 0,
      }),
    (d) => (d.authoring.constraints[0].animations = ['absent']),
    (d) => (d.authoring.constraints[0].range = [0, 1]),
    (d) => (d.authoring.atlas.size = [1024, 1024]),
    (d) => (d.authoring.atlas.texelsPerUnit = 16),
    (d) =>
      (d.authoring.motions = [
        {
          animation: 'idle',
          fps: 24,
          limbs: [
            {
              upper: 'body',
              lower: 'absent',
              end: [0, -4, 0],
              targets: [
                { time: 0, position: [0, -4, 0], pole: [0, 0, 1] },
                { time: 1, position: [0, -4, 0], pole: [0, 0, 1] },
              ],
            },
          ],
        },
      ]),
    (d) => (d.authoring.roles = { body: 'missing_role' }),
    (d) => (d.authoring.roles = { body: 'body', tolerance: 999 }),
  ]) {
    const d = make();
    mutate(d);
    assert.throws(() => authorDesign(d));
  }
  const d = make();
  d.authoring.atlas.parts[0].texelsPerUnit = 0.5;
  assert.equal(authorDesign(d).report.passed, true, 'a legal local density override is supported');
});

test('ground, sole and attachment checks use animated rotated parent chains and actual cube corners', () => {
  const m = parseFXL(`model "faults"
  group world origin [0,0,0] rotate [0,0,90] {
    group foot origin [0,0,0] { cube sole [0,0,0] [2,1,1] }
  }
  group hand origin [0,0,0] { cube glove [0,0,0] [1,1,1] }
  animation turn 1 once { rotate world 0 [0,0,0] rotate world 1 [0,0,180] }
  `);
  const constraints = [
    { id: 'floor', type: 'ground', cubes: ['world/foot/sole'], floor: 0, tolerance: 0.01 },
    {
      id: 'sole',
      type: 'contact',
      marker: marker('world/foot', [0, 0, 0]),
      floor: 0,
      tolerance: 0.01,
    },
    {
      id: 'grip',
      type: 'attachment',
      a: marker('world/foot', [2, 0, 0]),
      b: marker('hand', [0, 2, 0]),
      maxDistance: 0.01,
    },
  ];
  const report = reviewModel(m, constraints);
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((c) => c.constraint === 'sole').passed, true);
  assert.equal(report.checks.find((c) => c.constraint === 'grip').passed, false);
  assert.ok(
    report.issues.some((i) => i.constraint === 'floor' && i.time === 1),
    'actual unwrapped animation endpoint must be checked',
  );
  const half = report.issues.find((i) => i.constraint === 'floor' && i.time === 0.5);
  const min = Math.min(
    ...geometry(m, sampleAnimation(m, 'turn', 0.5))
      .find((c) => c.id === 'world/foot/sole')
      .vertices.map((p) => p[1]),
  );
  assert.ok(Math.abs(half.value + min) < 1e-8, 'review must match rendered geometry');
});

test('rig review detects interval faults hidden by matching animation endpoints', () => {
  const m = parseFXL(`model "midpoint"
  group root origin [0,0,0] { group tip origin [0,0,0] { cube sole [0,0,0] [1,1,1] } }
  animation spin 1 loop { rotate root 0 [0,0,0] rotate root 1 [0,0,360] }
  `);
  const c = {
    id: 'plant',
    type: 'contact',
    marker: marker('root/tip', [1, 0, 0]),
    floor: 0,
    lockXZ: [1, 0],
    tolerance: 0.01,
  };
  const review = reviewModel(m, [c]);
  assert.equal(review.passed, false);
  assert.ok(review.issues.some((i) => i.time === 0.5 && i.value > 1.9));
  assert.ok(!review.issues.some((i) => i.time === 0 || i.time === 1));
  assert.throws(() => reviewModel(m, [{ ...c, animations: ['spin'], range: [0, 1.1] }]), /exceeds/);
});

test('level and bend constraints detect reversed joints and tilted soles in a rotated hierarchy', () => {
  const m = parseFXL(`model "bend"
  group root origin [0,4,0] rotate [0,90,0] {
    group joint origin [0,2,1] { group end origin [0,0,0] { cube marker [0,0,0] [1,1,1] } }
  }`);
  const c = {
    id: 'knee',
    type: 'bend',
    root: marker('root', [0, 4, 0]),
    joint: marker('root/joint', [0, 2, 1]),
    end: marker('root/joint/end', [0, 0, 0]),
    pole: [5, 2, 0],
    minDot: 0.9,
    animations: [],
  };
  assert.equal(reviewModel(m, [c]).passed, true);
  assert.equal(reviewModel(m, [{ ...c, pole: [-5, 2, 0] }]).passed, false);
  const level = {
    id: 'sole',
    type: 'level',
    a: marker('root', [0, 0, 0]),
    b: marker('root', [1, 0, 0]),
    axis: [0, 1, 0],
    maxDegrees: 5,
    animations: [],
  };
  assert.equal(reviewModel(m, [level]).checks[0].worst, 90);
});

test('bounded declarative IK bakes world targets through animated ancestors and checks interpolation error', () => {
  const spec = {
    version: 1,
    source: `model "IK"
  group parent origin [0,4,0] rotate [0,35,0] {
    group upper origin [0,4,0] { cube thigh [-.3,2,-.3] [.6,2,.6]
      group lower origin [0,2,0] { cube calf [-.25,0,-.25] [.5,2,.5] }
    }
  }
  animation walk 1 once { move parent 0 [0,0,0] move parent 1 [1,0,0] rotate parent 0 [0,0,0] rotate parent 1 [0,25,0] scale parent 0 [1,1,1] scale parent 1 [1.2,.9,1.3] }
  `,
    authoring: {
      motions: [
        {
          animation: 'walk',
          fps: 30,
          tolerance: 0.03,
          limbs: [
            {
              upper: 'parent/upper',
              lower: 'parent/upper/lower',
              end: [0, 0, 0],
              targets: [
                { time: 0, position: [0, 1, 1], pole: [0, 3, 4] },
                { time: 1, position: [1, 1, -1], pole: [2, 3, 4] },
              ],
            },
          ],
        },
      ],
    },
  };
  const { model, report } = authorDesign(spec);
  assert.equal(report.passed, true);
  assert.equal(report.motions[0].keys, 62);
  assert.ok(report.motions[0].maximumTargetError < 0.03);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const p = bonePoint(model, 'parent/upper/lower', [0, 0, 0], sampleAnimation(model, 'walk', t));
    assert.ok(Math.hypot(p[0] - t, p[1] - 1, p[2] - (1 - 2 * t)) < 0.03);
  }
  const bad = structuredClone(spec);
  bad.authoring.motions[0].limbs[0].targets[1].position = [50, 1, 0];
  assert.throws(() => authorDesign(bad), /unreachable/);
  const short = structuredClone(spec);
  short.authoring.motions[0].limbs[0].targets[1].time = 0.5;
  assert.throws(() => authorDesign(short), /complete animation/);
  const conflict = structuredClone(spec);
  conflict.source += 'animation empty 1 once {}';
  conflict.authoring.motions[0].animation = 'empty';
  conflict.authoring.motions.push(structuredClone(conflict.authoring.motions[0]));
  assert.throws(() => authorDesign(conflict), /Duplicate IK motion/);
});

test('rig review handles exact step changes, undefined directions and explicit review bounds', () => {
  const model = parseFXL(`model "steps"
    group bone { cube foot [0,0,0] [1,1,1] }
    animation step 1 loop { move bone 0 [0,0,0] step move bone .5 [0,-2,0] step move bone 1 [0,0,0] }
  `);
  const ground = {
    id: 'floor',
    type: 'ground',
    cubes: ['bone/foot'],
    floor: 0,
    tolerance: 0,
    animations: ['step'],
  };
  const review = reviewModel(model, [ground]);
  assert.ok(review.issues.some((i) => i.time === 0.5 && i.value === 2));
  assert.ok(
    !review.issues.some((i) => i.time === 0.5 - 1e-6),
    'step must retain the old pose immediately before the key',
  );
  assert.ok(
    !review.issues.some((i) => i.time === 1),
    'loop endpoint must sample the final reset key',
  );
  assert.equal(
    reviewModel(model, [
      {
        id: 'undefined',
        type: 'level',
        a: marker('bone', [0, 0, 0]),
        b: marker('bone', [0, 0, 0]),
        axis: [0, 1, 0],
        maxDegrees: 180,
        animations: [],
      },
    ]).passed,
    false,
  );
  assert.throws(
    () =>
      reviewModel(model, [
        {
          id: 'zero',
          type: 'level',
          a: marker('bone', [0, 0, 0]),
          b: marker('bone', [0, 1, 0]),
          axis: [0, 0, 0],
          maxDegrees: 0,
        },
      ]),
    /zero direction/,
  );
  const long = structuredClone(model);
  long.animations[0].length = 3600;
  assert.throws(() => reviewModel(long, [ground]), /sampling budget/);
  assert.throws(
    () => authorDesign({ version: 1, source: 'model "missing"', authoring: {} }),
    /actual requested/,
  );
});

test('review rejects deep-hierarchy work before corner sampling and IK never accepts nonfinite inverse transforms', () => {
  const groups = Array.from({ length: 32 }, (_, i) => ({
    id: `g${i}`,
    name: `g${i}`,
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    ...(i ? { parent: `g${i - 1}` } : {}),
  }));
  const cubes = Array.from({ length: 1000 }, (_, i) => ({
    id: `c${i}`,
    name: `c${i}`,
    from: [i, 0, 0],
    to: [i + 1, 1, 1],
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    color: 0,
    parent: 'g31',
  }));
  const model = {
    version: 2,
    name: 'deep',
    format: 'free',
    resolution: [16, 16],
    groups,
    cubes,
    animations: [{ id: 'long', name: 'long', length: 40, loop: false, tracks: [] }],
  };
  assert.throws(
    () =>
      reviewModel(model, [
        {
          id: 'floor',
          type: 'ground',
          cubes: cubes.map((c) => c.id),
          floor: 0,
          tolerance: 0,
          animations: ['long'],
        },
      ]),
    /transform work budget/,
  );
  const source = `model "tiny"
    group a { group b { group upper origin [0,4,0] {
      group lower origin [0,2,0] { cube limb [-.5,0,-.5] [1,4,1] }
    } } }
    animation tiny 1 once {
      scale a 0 [1e-300,1e-300,1e-300] scale a 1 [1e-300,1e-300,1e-300]
      scale a/b 0 [1e-300,1e-300,1e-300] scale a/b 1 [1e-300,1e-300,1e-300]
    }`;
  const doc = {
    version: 1,
    source: source.replaceAll('scale a/b', 'scale "a/b"'),
    authoring: {
      motions: [
        {
          animation: 'tiny',
          fps: 1,
          limbs: [
            {
              upper: 'a/b/upper',
              lower: 'a/b/upper/lower',
              end: [0, 0, 0],
              targets: [
                { time: 0, position: [0, 1, 1], pole: [0, 3, 5] },
                { time: 1, position: [0, 1, 1], pole: [0, 3, 5] },
              ],
            },
          ],
        },
      ],
    },
  };
  assert.throws(() => authorDesign(doc), /Nonfinite or unstable/);
  const tiny = parseFXL(doc.source);
  const collapsed = reviewModel(tiny, [
    {
      id: 'direction',
      type: 'level',
      a: marker('a/b', [0, 0, 0]),
      b: marker('a/b', [0, 1, 0]),
      axis: [0, 1, 0],
      maxDegrees: 180,
      animations: ['tiny'],
    },
  ]);
  assert.equal(collapsed.passed, false, 'underflowed zero direction must not accidentally pass');
  assert.ok(collapsed.checks.every((c) => Number.isFinite(c.worst)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProductionPolicy,
  parseAnatomyRoles,
  parseProductionBrief,
} from '../packages/core/dist/policy.js';
import { reviewModel } from '../packages/core/dist/design.js';
import { canonical, geometry, sampleAnimation } from '../packages/core/dist/index.js';

function fixture(anatomy = 'quadruped') {
  const model = {
    version: 2,
    name: 'anatomy',
    format: 'free',
    resolution: [32, 32],
    cubes: [],
    groups: [],
    animations: [{ id: 'idle', name: 'idle', length: 1, loop: false, tracks: [] }],
  };
  const group = (id, origin, parent) =>
    model.groups.push({ id, name: id, origin, rotation: [0, 0, 0], ...(parent ? { parent } : {}) });
  const cube = (id, from, to, parent) =>
    model.cubes.push({
      id,
      name: id,
      from,
      to,
      origin: [0, 0, 0],
      rotation: [0, 0, 0],
      color: 0,
      parent,
    });
  const beam = (id, a, b, parent) =>
    cube(
      id,
      [0, 1, 2].map((i) => Math.min(a[i], b[i]) - 0.25),
      [0, 1, 2].map((i) => Math.max(a[i], b[i]) + 0.25),
      parent,
    );
  group('body', [0, 5, 0]);
  cube('body_mesh', [-2, 4, -3], [2, 7, 3], 'body');
  group('head', [0, 7, -3], 'body');
  cube('head_mesh', [-1, 6, -5], [1, 8, -3], 'head');
  const roles = { body: 'body', head: 'head', limbs: [] };
  const limb = (id, kind, root, joint, end) => {
    const upper = id + '_upper',
      lower = id + '_lower',
      foot = id + '_end';
    group(upper, root, 'body');
    group(lower, joint, upper);
    group(foot, end, lower);
    beam(id + '_upper_mesh', root, joint, upper);
    beam(id + '_lower_mesh', joint, end, lower);
    const [x, y, z] = end;
    cube(
      id + '_end_mesh',
      [x - 0.65, kind === 'leg' ? 0 : y - 0.4, z - 0.7],
      [x + 0.65, kind === 'leg' ? 0.5 : y + 0.4, z + 0.7],
      foot,
    );
    roles.limbs.push({
      id,
      kind,
      upper,
      lower,
      end: foot,
      ...(kind === 'leg' ? { sole: { cube: id + '_end_mesh', face: 'down' } } : {}),
      bendPole: [x, 3, z],
    });
  };
  if (anatomy === 'quadruped')
    for (const x of [-2.5, 2.5])
      for (const z of [-2, 2])
        limb(
          `${x < 0 ? 'l' : 'r'}${z < 0 ? 'f' : 'h'}`,
          'leg',
          [x, 5, z],
          [x, 2.5, z < 0 ? -1 : 1],
          [x, 0.5, z < 0 ? -3 : 3],
        );
  else {
    for (const x of [-0.9, 0.9])
      limb(x < 0 ? 'leftleg' : 'rightleg', 'leg', [x, 5, 0], [x, 2.5, -1], [x, 0.5, 0]);
    for (const x of [-2.5, 2.5])
      limb(
        x < 0 ? 'leftarm' : 'rightarm',
        'arm',
        [x, 6.8, 0],
        [Math.sign(x) * 3, 4.5, 0],
        [Math.sign(x) * 3, 2, 0],
      );
    group('shaft', [0, 2, 0], 'body');
    cube('handle', [-3.5, 1.9, -0.1], [3.5, 2.1, 0.1], 'shaft');
    const grip = (x) => ({
      hand: { group: x < 0 ? 'leftarm_end' : 'rightarm_end', point: [x, 2, 0], axis: [1, 0, 0] },
      shaft: { group: 'shaft', point: [x, 2, 0], axis: [1, 0, 0] },
    });
    roles.weapon = { ...grip(-3), secondary: grip(3), cubes: ['handle'] };
  }
  return { model: canonical(model), roles };
}

test('trusted quadruped policy derives real support and limb checks independently of loose provider constraints', () => {
  const { model, roles } = fixture();
  const good = validateProductionPolicy(model, roles, { anatomy: 'quadruped' });
  assert.equal(good.passed, true, JSON.stringify(good.issues));
  assert.ok(good.samples >= 25);
  assert.ok(good.tolerances.floor < 0.1);
  const c = model.cubes.find((c) => c.id === 'lf_end_mesh');
  c.from[1] = -0.4;
  assert.equal(
    reviewModel(model, [{ id: 'fake', type: 'ground', cubes: [c.id], floor: 0, tolerance: 999 }])
      .passed,
    true,
    'self-authored loose check would pass',
  );
  const bad = validateProductionPolicy(model, roles, { anatomy: 'quadruped' });
  assert.equal(bad.passed, false);
  assert.ok(bad.issues.some((i) => i.code === 'floor-penetration'));
  assert.ok(bad.issues.some((i) => i.code === 'rest-sole-contact'));
});

test('missing, reused, empty or false semantic anatomy roles cannot certify articulated output', () => {
  const { model, roles } = fixture();
  assert.equal(validateProductionPolicy(model, {}, { anatomy: 'quadruped' }).passed, false);
  assert.equal(validateProductionPolicy(model, {}, { anatomy: 'biped' }).passed, false);
  const duplicate = structuredClone(roles);
  duplicate.limbs[1] = { ...duplicate.limbs[0], id: 'duplicate' };
  assert.ok(
    validateProductionPolicy(model, duplicate, { anatomy: 'quadruped' }).issues.some(
      (i) => i.code === 'shared-role-bone',
    ),
  );
  const wrong = structuredClone(roles);
  wrong.limbs[0].sole.cube = 'body_mesh';
  assert.ok(
    validateProductionPolicy(model, wrong, { anatomy: 'quadruped' }).issues.some(
      (i) => i.code === 'sole-hierarchy',
    ),
  );
  const empty = structuredClone(model);
  empty.cubes = empty.cubes.filter((c) => c.parent !== 'lf_lower');
  assert.ok(
    validateProductionPolicy(empty, roles, { anatomy: 'quadruped' }).issues.some(
      (i) => i.code === 'empty-limb-bone',
    ),
  );
  const detached = structuredClone(model),
    upper = detached.cubes.find((c) => c.parent === 'lf_upper');
  upper.from = [30, 30, 30];
  upper.to = [31, 31, 31];
  assert.ok(
    validateProductionPolicy(detached, roles, { anatomy: 'quadruped' }).issues.some(
      (i) => i.code === 'detached-limb-geometry',
    ),
  );
  assert.throws(() => parseAnatomyRoles({ ...roles, tolerance: 1000 }), /unknown/);
  assert.throws(
    () => parseProductionBrief({ anatomy: 'quadruped', airborneAnimations: ['idle', 'idle'] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateProductionPolicy(model, roles, {
        anatomy: 'quadruped',
        airborneAnimations: ['unknown'],
      }),
    /Unknown trusted/,
  );
});

test('trusted expected joint direction cannot be overridden by provider-selected bend poles', () => {
  const { model, roles } = fixture();
  const lower = model.groups.find((g) => g.id === 'lf_lower');
  lower.origin[2] = -4;
  const upper = model.cubes.find((c) => c.id === 'lf_upper_mesh');
  upper.from[2] = -4.25;
  upper.to[2] = -1.75;
  const calf = model.cubes.find((c) => c.id === 'lf_lower_mesh');
  calf.from[2] = -4.25;
  calf.to[2] = -2.75;
  roles.limbs.find((l) => l.id === 'lf').bendPole = [-2.5, 3, -20];
  const report = validateProductionPolicy(model, roles, { anatomy: 'quadruped' });
  assert.equal(report.passed, false);
  assert.ok(
    report.issues.some((i) => i.code === 'joint-direction'),
    JSON.stringify(report.issues),
  );
});

test('airborne exemptions come only from trusted brief and never excuse geometry below the floor', () => {
  const { model, roles } = fixture();
  model.animations = [
    {
      id: 'jump',
      name: 'jump',
      length: 1,
      loop: false,
      tracks: [
        {
          group: 'body',
          channel: 'position',
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: 'linear' },
            { time: 0.5, value: [0, 2, 0], interpolation: 'linear' },
            { time: 1, value: [0, 0, 0], interpolation: 'linear' },
          ],
        },
      ],
    },
  ];
  const grounded = validateProductionPolicy(model, roles, { anatomy: 'quadruped' });
  assert.ok(grounded.issues.some((i) => i.code === 'missing-support'));
  assert.equal(
    validateProductionPolicy(model, roles, { anatomy: 'quadruped', airborneAnimations: ['jump'] })
      .passed,
    true,
  );
  model.animations[0].tracks[0].keyframes[1].value[1] = -2;
  assert.ok(
    validateProductionPolicy(model, roles, {
      anatomy: 'quadruped',
      airborneAnimations: ['jump'],
    }).issues.some((i) => i.code === 'floor-penetration'),
  );
});

test('two-handed biped grips require actual hand/shaft geometry and keep axes attached during motion', () => {
  const { model, roles } = fixture('biped');
  const good = validateProductionPolicy(model, roles, { anatomy: 'biped', weaponHands: 2 });
  assert.equal(good.passed, true, JSON.stringify(good.issues));
  const fake = structuredClone(roles);
  fake.weapon.hand.point = [50, 50, 50];
  fake.weapon.shaft.point = [50, 50, 50];
  assert.ok(
    validateProductionPolicy(model, fake, { anatomy: 'biped', weaponHands: 2 }).issues.some(
      (i) => i.code === 'grip-marker-outside',
    ),
  );
  const fakeAxis = structuredClone(roles);
  fakeAxis.weapon.hand.axis = [0, 1, 0];
  fakeAxis.weapon.shaft.axis = [0, 1, 0];
  assert.ok(
    validateProductionPolicy(model, fakeAxis, { anatomy: 'biped', weaponHands: 2 }).issues.some(
      (i) => i.code === 'shaft-axis-geometry',
    ),
  );
  model.animations[0].tracks = [
    {
      group: 'shaft',
      channel: 'rotation',
      keyframes: [
        { time: 0, value: [0, 0, 0], interpolation: 'linear' },
        { time: 1, value: [0, 90, 0], interpolation: 'linear' },
      ],
    },
  ];
  const bad = validateProductionPolicy(model, roles, { anatomy: 'biped', weaponHands: 2 });
  assert.ok(bad.issues.some((i) => i.code === 'weapon-axis'));
  assert.ok(bad.issues.some((i) => i.code === 'weapon-attachment'));
});

test('policy applies rotated hierarchy geometry and checks motion endpoints, degeneration and work bounds', () => {
  const { model, roles } = fixture();
  model.groups.find((g) => g.id === 'body').rotation[1] = 73;
  assert.equal(validateProductionPolicy(model, roles, { anatomy: 'quadruped' }).passed, true);
  model.animations[0].tracks = [
    {
      group: 'body',
      channel: 'scale',
      keyframes: [
        { time: 0, value: [1, 1, 1], interpolation: 'linear' },
        { time: 1, value: [1e-300, 1e-300, 1e-300], interpolation: 'linear' },
      ],
    },
  ];
  const report = validateProductionPolicy(model, roles, { anatomy: 'quadruped' });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.time === 1 && i.code === 'joint-angle'));
  assert.ok(report.issues.some((i) => i.code === 'limb-stretch'));
  const long = structuredClone(model);
  long.animations[0].length = 3600;
  assert.throws(
    () => validateProductionPolicy(long, roles, { anatomy: 'quadruped' }),
    /sampling budget/,
  );
  const mesh = geometry(model, sampleAnimation(model, 'idle', 1));
  assert.ok(mesh.flatMap((m) => m.vertices).every((p) => p.every(Number.isFinite)));
});

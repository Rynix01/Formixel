import {
  assertModel,
  FACE_NAMES,
  type Model,
  type Vec3,
  type FaceName,
  type Cube,
  type Group,
} from './model.js';
import { rotate } from './geometry.js';
import { inverseRotateVector } from './rig.js';
import type { BonePose } from './animation.js';

export interface ProductionMarker {
  group: string;
  point: Vec3;
  axis: Vec3;
}
export interface AnatomyLimb {
  id: string;
  kind: 'leg' | 'arm';
  upper: string;
  lower: string;
  end: string;
  sole?: { cube: string; face: FaceName };
  /** Author intent retained for review; trusted production bend directions derive from the brief. */
  bendPole: Vec3;
}
export interface AnatomyRoles {
  body?: string;
  head?: string;
  limbs?: AnatomyLimb[];
  weapon?: {
    hand: ProductionMarker;
    shaft: ProductionMarker;
    cubes: string[];
    secondary?: { hand: ProductionMarker; shaft: ProductionMarker };
  };
}
export interface ProductionBrief {
  anatomy: 'quadruped' | 'biped' | 'prop';
  floor?: number;
  /** Trusted horizontal forward direction. BBIR convention defaults to negative Z. */
  forward?: Vec3;
  airborneAnimations?: string[];
  weaponHands?: 1 | 2;
}
export interface ProductionPolicyIssue {
  code: string;
  message: string;
  node?: string;
  animation?: string;
  time?: number;
}
export interface ProductionPolicyReport {
  passed: boolean;
  anatomy: ProductionBrief['anatomy'];
  issueCount: number;
  issues: ProductionPolicyIssue[];
  samples: number;
  tolerances: {
    floor: number;
    contact: number;
    soleDegrees: number;
    grip?: number;
    gripDegrees: number;
  };
  scope: string;
}

const object = (
  v: unknown,
  fields: string[],
  required: string[],
  path: string,
): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path}: expected object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!fields.includes(k)) throw new Error(`${path}.${k}: unknown field`);
  for (const k of required) if (o[k] === undefined) throw new Error(`${path}.${k}: required`);
  return o;
};
const identifier = (v: unknown, path: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(v))
    throw new Error(`${path}: invalid identifier`);
  return v;
};
const vector = (v: unknown, path: string): Vec3 => {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    !v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000)
  )
    throw new Error(`${path}: invalid vector`);
  return v as Vec3;
};
const array = (v: unknown, min: number, max: number, path: string): unknown[] => {
  if (!Array.isArray(v) || v.length < min || v.length > max)
    throw new Error(`${path}: expected ${min}..${max} entries`);
  return v;
};
const marker = (value: unknown, path: string) => {
  const m = object(value, ['group', 'point', 'axis'], ['group', 'point', 'axis'], path);
  identifier(m.group, `${path}.group`);
  vector(m.point, `${path}.point`);
  if (Math.hypot(...vector(m.axis, `${path}.axis`)) < 1e-8)
    throw new Error(`${path}.axis: zero direction`);
};
/** Exact semantic data only. No anatomy is inferred from names and no tolerances are accepted here. */
export function parseAnatomyRoles(value: unknown): AnatomyRoles {
  const roles = object(value, ['body', 'head', 'limbs', 'weapon'], [], 'roles');
  for (const k of ['body', 'head']) if (roles[k] !== undefined) identifier(roles[k], `roles.${k}`);
  const ids = new Set<string>();
  if (roles.limbs !== undefined)
    for (const value of array(roles.limbs, 0, 8, 'roles.limbs')) {
      const l = object(
        value,
        ['id', 'kind', 'upper', 'lower', 'end', 'sole', 'bendPole'],
        ['id', 'kind', 'upper', 'lower', 'end', 'bendPole'],
        'limb role',
      );
      const key = identifier(l.id, 'limb.id');
      if (ids.has(key)) throw new Error('Duplicate anatomy limb id');
      ids.add(key);
      if (!['leg', 'arm'].includes(String(l.kind))) throw new Error('Invalid limb kind');
      for (const k of ['upper', 'lower', 'end']) identifier(l[k], `limb.${k}`);
      vector(l.bendPole, 'limb.bendPole');
      if (l.sole !== undefined) {
        const s = object(l.sole, ['cube', 'face'], ['cube', 'face'], 'sole');
        identifier(s.cube, 'sole.cube');
        if (!FACE_NAMES.includes(s.face as FaceName)) throw new Error('Invalid sole cube face');
      }
    }
  if (roles.weapon !== undefined) {
    const w = object(
      roles.weapon,
      ['hand', 'shaft', 'cubes', 'secondary'],
      ['hand', 'shaft', 'cubes'],
      'weapon',
    );
    marker(w.hand, 'weapon.hand');
    marker(w.shaft, 'weapon.shaft');
    const cubes = array(w.cubes, 1, 1000, 'weapon.cubes').map((v) => identifier(v, 'weapon cube'));
    if (new Set(cubes).size !== cubes.length) throw new Error('Duplicate weapon cube');
    if (w.secondary !== undefined) {
      const s = object(w.secondary, ['hand', 'shaft'], ['hand', 'shaft'], 'weapon.secondary');
      marker(s.hand, 'secondary.hand');
      marker(s.shaft, 'secondary.shaft');
    }
  }
  return structuredClone(value) as AnatomyRoles;
}

export function assertAnatomyReferences(model: Model, input: unknown): void {
  const roles = parseAnatomyRoles(input),
    groups = new Set(model.groups.map((g) => g.id)),
    cubes = new Set(model.cubes.map((c) => c.id));
  const all = [
    roles.body,
    roles.head,
    ...(roles.limbs ?? []).flatMap((l) => [l.upper, l.lower, l.end]),
    ...(roles.weapon
      ? [
          roles.weapon.hand.group,
          roles.weapon.shaft.group,
          ...(roles.weapon.secondary
            ? [roles.weapon.secondary.hand.group, roles.weapon.secondary.shaft.group]
            : []),
        ]
      : []),
  ];
  for (const id of all)
    if (id && !groups.has(id)) throw new Error(`Unknown anatomy role group ${id}`);
  for (const l of roles.limbs ?? [])
    if (l.sole && !cubes.has(l.sole.cube)) throw new Error(`Unknown sole cube ${l.sole.cube}`);
  for (const id of roles.weapon?.cubes ?? [])
    if (!cubes.has(id)) throw new Error(`Unknown weapon cube ${id}`);
}

export function parseProductionBrief(value: unknown): ProductionBrief {
  const b = object(
    value,
    ['anatomy', 'floor', 'forward', 'airborneAnimations', 'weaponHands'],
    ['anatomy'],
    'production brief',
  );
  if (!['quadruped', 'biped', 'prop'].includes(String(b.anatomy)))
    throw new Error('Production anatomy must be quadruped, biped or prop');
  if (
    b.floor !== undefined &&
    (typeof b.floor !== 'number' || !Number.isFinite(b.floor) || Math.abs(b.floor) > 1_000_000)
  )
    throw new Error('Invalid production floor');
  if (b.forward !== undefined) {
    const f = vector(b.forward, 'brief.forward');
    if (Math.hypot(...f) < 1e-8 || Math.abs(f[1]) > 1e-8)
      throw new Error('Trusted forward must be a horizontal nonzero vector');
  }
  if (b.airborneAnimations !== undefined) {
    const clips = array(b.airborneAnimations, 0, 128, 'brief.airborneAnimations').map((v) =>
      identifier(v, 'airborne animation'),
    );
    if (new Set(clips).size !== clips.length) throw new Error('Duplicate airborne animation');
  }
  if (b.weaponHands !== undefined && b.weaponHands !== 1 && b.weaponHands !== 2)
    throw new Error('weaponHands must be 1 or 2');
  return structuredClone(value) as ProductionBrief;
}

const sub = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n - b[i]!) as Vec3;
const add = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n + b[i]!) as Vec3;
const mul = (v: Vec3, s: number): Vec3 => v.map((n) => n * s) as Vec3;
const norm = (v: Vec3) => Math.hypot(...v);
const dot = (a: Vec3, b: Vec3) => a.reduce((s, n, i) => s + n * b[i]!, 0);
const unit = (v: Vec3): Vec3 => mul(v, 1 / norm(v));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const finite = (v: Vec3): Vec3 => {
  if (!v.every(Number.isFinite)) throw new Error('Nonfinite production transform');
  return v;
};
const faceVertices: Record<FaceName, number[]> = {
  west: [0, 4, 6, 2],
  east: [1, 3, 7, 5],
  down: [0, 1, 5, 4],
  up: [2, 6, 7, 3],
  north: [0, 2, 3, 1],
  south: [4, 5, 7, 6],
};

interface Affine {
  axes: [Vec3, Vec3, Vec3];
  offset: Vec3;
}
const linear = (m: Affine, p: Vec3): Vec3 =>
  [0, 1, 2].map((i) => m.axes[0][i]! * p[0] + m.axes[1][i]! * p[1] + m.axes[2][i]! * p[2]) as Vec3;
const apply = (m: Affine, p: Vec3) => finite(add(linear(m, p), m.offset));
function frame(
  model: Model,
  groups: Map<string, Group>,
  clip: NonNullable<Model['animations']>[number] | undefined,
  time: number,
) {
  const poses = new Map<string, BonePose>();
  for (const track of clip?.tracks ?? []) {
    const keys = track.keyframes;
    let l = 0,
      r = keys.length - 1;
    while (l < r) {
      const mid = Math.floor((l + r) / 2);
      if (keys[mid]!.time < time) l = mid + 1;
      else r = mid;
    }
    const b = keys[l]!,
      a = keys[Math.max(0, l - 1)]!;
    const f =
      time <= a.time || a.interpolation === 'step'
        ? 0
        : time >= b.time
          ? 1
          : (time - a.time) / (b.time - a.time);
    const value =
      time >= b.time
        ? ([...b.value] as Vec3)
        : (a.value.map((n, i) => n + (b.value[i]! - n) * f) as Vec3);
    let p = poses.get(track.group);
    if (!p) {
      p = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
      poses.set(track.group, p);
    }
    p[track.channel] = value;
  }
  const matrices = new Map<string, Affine>();
  const matrix = (id: string): Affine => {
    const cached = matrices.get(id);
    if (cached) return cached;
    const g = groups.get(id)!,
      p = poses.get(id),
      rotation = add(g.rotation, p?.rotation ?? [0, 0, 0]);
    const axes = (
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as Vec3[]
    ).map((v, i) => rotate(mul(v, p?.scale[i] ?? 1), [0, 0, 0], rotation)) as [Vec3, Vec3, Vec3];
    let m: Affine = {
      axes,
      offset: sub(
        add(g.origin, p?.position ?? [0, 0, 0]),
        linear({ axes, offset: [0, 0, 0] }, g.origin),
      ),
    };
    if (g.parent) {
      const parent = matrix(g.parent);
      m = {
        axes: m.axes.map((a) => finite(linear(parent, a))) as [Vec3, Vec3, Vec3],
        offset: apply(parent, m.offset),
      };
    }
    finite(m.offset);
    for (const axis of m.axes) finite(axis);
    matrices.set(id, m);
    return m;
  };
  const point = (id: string, p: Vec3) => apply(matrix(id), p);
  const vertices = (cube: Cube) =>
    Array.from({ length: 8 }, (_, i) => {
      const p = rotate(
        [
          i & 1 ? cube.to[0] : cube.from[0],
          i & 2 ? cube.to[1] : cube.from[1],
          i & 4 ? cube.to[2] : cube.from[2],
        ],
        cube.origin,
        cube.rotation,
      );
      return cube.parent ? point(cube.parent, p) : p;
    });
  const direction = (id: string, v: Vec3) => finite(linear(matrix(id), v));
  // Only used on the unanimated rest frame, whose hierarchy contains pure rotations.
  const restLocalDirection = (id: string, v: Vec3): Vec3 =>
    matrix(id).axes.map((a) => dot(a, v)) as Vec3;
  return { point, vertices, direction, restLocalDirection };
}

function bounds(vertices: Vec3[]) {
  const min = [0, 1, 2].map((i) => Math.min(...vertices.map((v) => v[i]!))) as Vec3,
    max = [0, 1, 2].map((i) => Math.max(...vertices.map((v) => v[i]!))) as Vec3;
  return { min, max, center: mul(add(min, max), 0.5), size: sub(max, min) };
}
const hull = (points: Vec3[]) => {
  const p = points
    .map((v) => [v[0], v[2]] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower: [number, number][] = [],
    upper: [number, number][] = [];
  for (const v of p) {
    while (lower.length > 1 && turn(lower.at(-2)!, lower.at(-1)!, v) <= 0) lower.pop();
    lower.push(v);
  }
  for (const v of [...p].reverse()) {
    while (upper.length > 1 && turn(upper.at(-2)!, upper.at(-1)!, v) <= 0) upper.pop();
    upper.push(v);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};
function insideSupport(center: Vec3, points: Vec3[], tolerance: number) {
  const polygon = hull(points);
  if (polygon.length < 3) return false;
  return polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return (
      (b[0] - a[0]) * (center[2] - a[1]) - (b[1] - a[1]) * (center[0] - a[0]) >=
      -tolerance * Math.hypot(b[0] - a[0], b[1] - a[1])
    );
  });
}

/** Trusted anatomy policy. The brief is selected by the caller, never copied from a provider document. */
export function validateProductionPolicy(
  model: Model,
  inputRoles: unknown,
  inputBrief: unknown,
): ProductionPolicyReport {
  assertModel(model);
  const roles = parseAnatomyRoles(inputRoles ?? {}),
    brief = parseProductionBrief(inputBrief),
    groups = new Map(model.groups.map((g) => [g.id, g])),
    cubes = new Map(model.cubes.map((c) => [c.id, c]));
  const issues: ProductionPolicyIssue[] = [];
  let issueCount = 0,
    samples = 0,
    work = 0;
  const addIssue = (
    code: string,
    message: string,
    node?: string,
    animation?: string,
    time?: number,
  ) => {
    issueCount++;
    if (issues.length < 1000)
      issues.push({
        code,
        message,
        ...(node ? { node } : {}),
        ...(animation ? { animation } : {}),
        ...(time !== undefined ? { time } : {}),
      });
  };
  const clipIds = new Set((model.animations ?? []).map((a) => a.id));
  for (const id of brief.airborneAnimations ?? [])
    if (!clipIds.has(id)) throw new Error(`Unknown trusted airborne animation ${id}`);
  const descendant = (child: string, parent: string): boolean => {
    let id: string | undefined = child;
    while (id) {
      if (id === parent) return true;
      id = groups.get(id)?.parent;
    }
    return false;
  };
  const own = (id: string) =>
    model.cubes.filter(
      (c) => c.parent === id && FACE_NAMES.some((f) => c.faces?.[f]?.enabled !== false),
    );
  const referencedGroups = [
    roles.body,
    roles.head,
    ...(roles.limbs ?? []).flatMap((l) => [l.upper, l.lower, l.end]),
    ...(roles.weapon
      ? [
          roles.weapon.hand.group,
          roles.weapon.shaft.group,
          ...(roles.weapon.secondary
            ? [roles.weapon.secondary.hand.group, roles.weapon.secondary.shaft.group]
            : []),
        ]
      : []),
  ].filter((v): v is string => !!v);
  for (const id of referencedGroups)
    if (!groups.has(id)) throw new Error(`Unknown anatomy role group ${id}`);
  for (const limb of roles.limbs ?? [])
    if (limb.sole && !cubes.has(limb.sole.cube))
      throw new Error(`Unknown sole cube ${limb.sole.cube}`);
  for (const id of roles.weapon?.cubes ?? [])
    if (!cubes.has(id)) throw new Error(`Unknown weapon cube ${id}`);
  const rest = frame(model, groups, undefined, 0),
    bodyCubes = roles.body ? own(roles.body) : [];
  const bodyBounds = bodyCubes.length
    ? bounds(bodyCubes.flatMap((c) => rest.vertices(c)))
    : undefined;
  const unitScale = bodyBounds ? Math.max(...bodyBounds.size) : 1;
  const tolerances: ProductionPolicyReport['tolerances'] = {
    floor: clamp(unitScale * 0.003, 0.002, 0.12),
    contact: clamp(unitScale * 0.006, 0.004, 0.2),
    soleDegrees: 12,
    gripDegrees: 20,
  };
  const result = (): ProductionPolicyReport => ({
    passed: issueCount === 0,
    anatomy: brief.anatomy,
    issueCount,
    issues,
    samples,
    tolerances,
    scope:
      'Trusted finite anatomy/rig policy: actual cube corners, source bone hierarchy, fixed dimension-derived tolerances and caller-selected flight exceptions. Not an aesthetic score, anatomy recognition or continuous collision proof.',
  });
  if (!model.cubes.length) addIssue('missing-geometry', 'Production output needs actual geometry');
  const limbs = roles.limbs ?? [],
    legs = limbs.filter((l) => l.kind === 'leg'),
    arms = limbs.filter((l) => l.kind === 'arm');
  if (brief.anatomy !== 'prop') {
    if (!roles.body || !bodyCubes.length)
      addIssue('missing-body', 'Articulated anatomy needs a body group with its own cuboids');
    if (!roles.head || !own(roles.head).length)
      addIssue('missing-head', 'Articulated anatomy needs a head group with its own cuboids');
    if (
      roles.head &&
      roles.body &&
      (roles.head === roles.body || !descendant(roles.head, roles.body))
    )
      addIssue('head-hierarchy', 'Head must be a distinct descendant of body', roles.head);
    if (bodyBounds && (unitScale < 0.1 || unitScale > 1000))
      addIssue('anatomy-scale', 'Body size must be .1..1000 model units');
    const expected = brief.anatomy === 'quadruped' ? 4 : 2;
    if (legs.length !== expected)
      addIssue('leg-count', `${brief.anatomy} requires exactly ${expected} distinct leg chains`);
    if (brief.anatomy === 'quadruped' && arms.length)
      addIssue(
        'unexpected-arms',
        'Quadruped production roles must contain four legs and no extra arms',
      );
    if (brief.anatomy === 'biped' && arms.length !== 0 && arms.length !== 2)
      addIssue('arm-count', 'A biped must declare either zero or two arms');
  }
  const occupied = new Set<string>([roles.body, roles.head].filter((v): v is string => !!v));
  for (const limb of limbs) {
    for (const id of [limb.upper, limb.lower, limb.end]) {
      if (occupied.has(id))
        addIssue(
          'shared-role-bone',
          'Limb bones must be distinct from other limbs, body and head',
          id,
        );
      occupied.add(id);
      if (!own(id).length)
        addIssue(
          'empty-limb-bone',
          'Every upper/lower/end role must have its own visible geometry',
          id,
        );
    }
    if (
      groups.get(limb.lower)!.parent !== limb.upper ||
      groups.get(limb.end)!.parent !== limb.lower
    )
      addIssue(
        'limb-hierarchy',
        'Limb must be an actual upper -> lower -> end direct chain',
        limb.id,
      );
    if (roles.body && !descendant(limb.upper, roles.body))
      addIssue('limb-body', 'Limb root must descend from body', limb.id);
    if (limb.kind === 'leg' && !limb.sole)
      addIssue('missing-sole', 'Each leg requires an actual sole cube face', limb.id);
    if (limb.sole && cubes.get(limb.sole.cube)!.parent !== limb.end)
      addIssue('sole-hierarchy', 'Sole cube must be directly owned by the limb end group', limb.id);
    if (limb.sole && cubes.get(limb.sole.cube)!.faces?.[limb.sole.face]?.enabled === false)
      addIssue('invisible-sole', 'The selected sole face must be enabled', limb.id);
  }
  const grips = roles.weapon
    ? [
        { hand: roles.weapon.hand, shaft: roles.weapon.shaft },
        ...(roles.weapon.secondary ? [roles.weapon.secondary] : []),
      ]
    : [];
  if (brief.weaponHands && !roles.weapon)
    addIssue('missing-weapon', 'Trusted brief requires weapon grip roles');
  if (roles.weapon) {
    if (brief.anatomy === 'biped' && arms.length !== 2)
      addIssue('weapon-arms', 'Weapon-bearing biped requires two actual arm chains');
    if (grips.length !== (brief.weaponHands ?? grips.length))
      addIssue('weapon-hands', 'Weapon grip count differs from the trusted brief');
    if (new Set(grips.map((g) => g.hand.group)).size !== grips.length)
      addIssue('duplicate-weapon-hand', 'Two-handed grip must use two distinct hands');
    for (const grip of grips) {
      if (grip.hand.group === grip.shaft.group)
        addIssue(
          'weapon-group',
          'Hand and weapon must have different group transforms',
          grip.hand.group,
        );
      if (!arms.some((a) => a.end === grip.hand.group))
        addIssue(
          'weapon-hand-role',
          'Weapon hand must be an actual annotated arm end',
          grip.hand.group,
        );
      if (!own(grip.shaft.group).length)
        addIssue('weapon-geometry', 'Weapon shaft group needs actual cuboids', grip.shaft.group);
      for (const id of roles.weapon.cubes)
        if (!cubes.get(id)!.parent || !descendant(cubes.get(id)!.parent!, grip.shaft.group))
          addIssue('weapon-cube-role', 'Weapon cubes must descend from its shaft group', id);
    }
    const handSizes = grips.flatMap((g) =>
      own(g.hand.group).map((c) => Math.min(...sub(c.to, c.from))),
    );
    tolerances.grip = clamp((handSizes.length ? Math.min(...handSizes) : 0.2) * 0.2, 0.01, 0.25);
    const inside = (m: ProductionMarker) =>
      own(m.group).some((c) => {
        const p = add(inverseRotateVector(sub(m.point, c.origin), c.rotation), c.origin);
        return p.every(
          (n, i) => n >= c.from[i]! - tolerances.grip! && n <= c.to[i]! + tolerances.grip!,
        );
      });
    for (const g of grips)
      if (!inside(g.hand) || !inside(g.shaft))
        addIssue(
          'grip-marker-outside',
          'Grip markers must lie inside actual hand and shaft cuboids, not arbitrary distant points',
        );
    for (const g of grips) {
      const matches = own(g.shaft.group).some((c) => {
        const local = add(inverseRotateVector(sub(g.shaft.point, c.origin), c.rotation), c.origin);
        if (
          !local.every(
            (n, i) => n >= c.from[i]! - tolerances.grip! && n <= c.to[i]! + tolerances.grip!,
          )
        )
          return false;
        const size = sub(c.to, c.from),
          axis = size.indexOf(Math.max(...size)),
          other = size.filter((_, i) => i !== axis);
        if (size[axis]! < Math.max(...other) * 1.5) return false;
        const v: Vec3 = [0, 0, 0];
        v[axis] = 1;
        return (
          (Math.acos(
            clamp(Math.abs(dot(unit(rotate(v, [0, 0, 0], c.rotation)), unit(g.shaft.axis))), 0, 1),
          ) *
            180) /
            Math.PI <=
          tolerances.gripDegrees
        );
      });
      if (!matches)
        addIssue(
          'shaft-axis-geometry',
          'Shaft axis must follow an actual elongated handle cuboid containing the grip',
          g.shaft.group,
        );
    }
  }
  // Invalid structural annotations must not enter the geometric sampler.
  if (issueCount) return result();
  const floor = brief.floor ?? 0,
    forward = unit(brief.forward ?? [0, 0, -1]),
    restForward = roles.body ? unit(rest.direction(roles.body, forward)) : forward;
  const limbData = limbs.map((l) => {
    const root = rest.point(l.upper, groups.get(l.upper)!.origin),
      joint = rest.point(l.lower, groups.get(l.lower)!.origin),
      end = rest.point(l.end, groups.get(l.end)!.origin);
    const upperLength = norm(sub(joint, root)),
      lowerLength = norm(sub(end, joint));
    if (
      upperLength < 0.01 ||
      lowerLength < 0.01 ||
      upperLength > unitScale * 3 ||
      lowerLength > unitScale * 3
    )
      addIssue(
        'limb-length',
        'Bone pivots need finite nondegenerate lengths proportionate to body',
        l.id,
      );
    if (l.kind === 'leg' && root[1] <= end[1] + tolerances.contact)
      addIssue('leg-direction', 'Rest leg root must be above its foot', l.id);
    const margin = clamp((upperLength + lowerLength) * 0.03, 0.01, 0.3);
    const inside = (group: string, p: Vec3) =>
      own(group).some((c) => {
        const v = add(inverseRotateVector(sub(p, c.origin), c.rotation), c.origin);
        return v.every((n, i) => n >= c.from[i]! - margin && n <= c.to[i]! + margin);
      });
    if (
      !inside(l.upper, groups.get(l.upper)!.origin) ||
      !inside(l.upper, groups.get(l.lower)!.origin) ||
      !inside(l.lower, groups.get(l.lower)!.origin) ||
      !inside(l.lower, groups.get(l.end)!.origin) ||
      !inside(l.end, groups.get(l.end)!.origin)
    )
      addIssue(
        'detached-limb-geometry',
        'Actual limb cuboids must connect their annotated bone pivots',
        l.id,
      );
    const direction = l.kind === 'arm' ? sub(root, bodyBounds?.center ?? [0, 0, 0]) : forward;
    const armWorld = [direction[0], 0, direction[2]] as Vec3;
    return {
      role: l,
      root,
      joint,
      end,
      upperLength,
      lowerLength,
      projection: dot(root, restForward),
      armOut: roles.body ? rest.restLocalDirection(roles.body, armWorld) : armWorld,
    };
  });
  if (issueCount) return result();
  const legData = limbData
    .filter((l) => l.role.kind === 'leg')
    .sort((a, b) => b.projection - a.projection);
  const fronts = new Set(
    brief.anatomy === 'quadruped' ? legData.slice(0, 2).map((l) => l.role.id) : [],
  );
  if (
    brief.anatomy === 'quadruped' &&
    legData[1]!.projection - legData[2]!.projection < Math.max(0.02, unitScale * 0.04)
  )
    addIssue(
      'leg-layout',
      'Quadruped leg roots must form two spatially distinct front and hind pairs',
    );
  const footPoints = (l: AnatomyLimb, f: ReturnType<typeof frame>) => {
    if (!l.sole) return [];
    const vertices = f.vertices(cubes.get(l.sole.cube)!);
    return faceVertices[l.sole.face].map((i) => vertices[i]!);
  };
  const footCenters = legData.map((l) => bounds(footPoints(l.role, rest)).center);
  for (let i = 0; i < footCenters.length; i++)
    for (let j = i + 1; j < footCenters.length; j++)
      if (norm(sub(footCenters[i]!, footCenters[j]!)) < Math.max(0.02, unitScale * 0.04))
        addIssue(
          'coincident-feet',
          'Distinct leg chains must place distinct actual feet',
          legData[i]!.role.id,
        );
  if (
    bodyBounds &&
    legs.length &&
    !insideSupport(
      bodyBounds.center,
      legs.flatMap((l) => footPoints(l, rest)),
      unitScale * 0.05,
    )
  )
    addIssue(
      'rest-support',
      'Body projection must lie within the actual sole support polygon in rest',
    );
  const allClips: (NonNullable<Model['animations']>[number] | undefined)[] = [
    undefined,
    ...(model.animations ?? []),
  ];
  for (const clip of allClips) {
    const times = new Set<number>([0, clip?.length ?? 0]);
    if (clip) {
      if (clip.length * 24 > 20000) throw new Error('Production policy sampling budget exceeded');
      const keys = [...new Set(clip.tracks.flatMap((t) => t.keyframes.map((k) => k.time)))].sort(
        (a, b) => a - b,
      );
      for (let i = 0; i < keys.length; i++) {
        const t = keys[i]!;
        times.add(t);
        if (i) times.add((t + keys[i - 1]!) / 2);
        if (t > 0) times.add(Math.max(0, t - 1e-6));
      }
      for (let i = 1; i < Math.ceil(clip.length * 24); i++) times.add(i / 24);
    }
    if (times.size > 20000) throw new Error('Production policy sampling budget exceeded');
    work +=
      times.size *
      (model.groups.length * 4 +
        (clip?.tracks.length ?? 0) * 16 +
        model.cubes.length * 8 +
        limbs.length * 24 +
        grips.length * 8);
    if (work > 20_000_000)
      throw new Error(
        'Production policy work budget exceeded; simplify geometry or clip sampling scope',
      );
    for (const time of [...times].sort((a, b) => a - b)) {
      const f = clip ? frame(model, groups, clip, time) : rest;
      let min = Infinity,
        contacts = 0;
      for (const cube of model.cubes) {
        if (!FACE_NAMES.some((face) => cube.faces?.[face]?.enabled !== false)) continue;
        for (const p of f.vertices(cube)) min = Math.min(min, p[1]);
      }
      if (!Number.isFinite(min)) throw new Error('Nonfinite production floor measurement');
      if (min < floor - tolerances.floor)
        addIssue(
          'floor-penetration',
          'Actual model cuboid geometry penetrates the trusted floor',
          undefined,
          clip?.id,
          time,
        );
      if (
        brief.anatomy === 'prop' &&
        min > floor + tolerances.contact &&
        (!clip || !brief.airborneAnimations?.includes(clip.id))
      )
        addIssue(
          'missing-floor-contact',
          'Grounded prop geometry must touch the trusted floor; airborne clips require an explicit caller exception',
          undefined,
          clip?.id,
          time,
        );
      for (const l of limbData) {
        const root = f.point(l.role.upper, groups.get(l.role.upper)!.origin),
          joint = f.point(l.role.lower, groups.get(l.role.lower)!.origin),
          end = f.point(l.role.end, groups.get(l.role.end)!.origin);
        const upper = norm(sub(joint, root)),
          lower = norm(sub(end, joint)),
          tolerance = clamp((l.upperLength + l.lowerLength) * 0.04, 0.01, 0.3);
        if (
          Math.abs(upper - l.upperLength) > tolerance ||
          Math.abs(lower - l.lowerLength) > tolerance
        )
          addIssue(
            'limb-stretch',
            'Actual joint-to-joint bone lengths change beyond the trusted allowance',
            l.role.id,
            clip?.id,
            time,
          );
        const span = norm(sub(end, root));
        if (
          span > l.upperLength + l.lowerLength + tolerance ||
          span < Math.abs(l.upperLength - l.lowerLength) - tolerance
        )
          addIssue(
            'limb-reach',
            'Actual extremity lies outside the rest limb reach interval',
            l.role.id,
            clip?.id,
            time,
          );
        const v1 = sub(root, joint),
          v2 = sub(end, joint),
          angle =
            norm(v1) > 1e-8 && norm(v2) > 1e-8
              ? (Math.acos(clamp(dot(unit(v1), unit(v2)), -1, 1)) * 180) / Math.PI
              : NaN;
        if (!Number.isFinite(angle) || angle < 8)
          addIssue(
            'joint-angle',
            'Limb joint is collapsed or folds tighter than the trusted minimum angle',
            l.role.id,
            clip?.id,
            time,
          );
        if (norm(sub(end, root)) > 1e-8) {
          const axis = unit(sub(end, root)),
            bend = sub(sub(joint, root), mul(axis, dot(sub(joint, root), axis)));
          const base = roles.body ? groups.get(roles.body)!.origin : ([0, 0, 0] as Vec3);
          const bodyDirection = (direction: Vec3) =>
            roles.body
              ? sub(f.point(roles.body, add(base, direction)), f.point(roles.body, base))
              : direction;
          let intended =
            l.role.kind === 'arm'
              ? bodyDirection(norm(l.armOut) > 1e-8 ? unit(l.armOut) : [1, 0, 0])
              : bodyDirection(mul(forward, fronts.has(l.role.id) ? -1 : 1));
          intended = sub(intended, mul(axis, dot(intended, axis)));
          if (
            norm(bend) > Math.max(0.01, (upper + lower) * 0.01) &&
            norm(intended) > 1e-8 &&
            dot(unit(bend), unit(intended)) < -0.05
          )
            addIssue(
              'joint-direction',
              'Actual joint bends opposite the trusted anatomy direction',
              l.role.id,
              clip?.id,
              time,
            );
        }
        if (l.role.kind === 'leg') {
          const points = footPoints(l.role, f),
            ys = points.map((p) => p[1]),
            low = Math.min(...ys),
            high = Math.max(...ys);
          const grounded =
            Math.max(Math.abs(low - floor), Math.abs(high - floor)) <= tolerances.contact;
          if (grounded) contacts++;
          const normal = cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!));
          const soleAngle =
            norm(normal) > 1e-8
              ? (Math.acos(clamp(dot(unit(normal), [0, -1, 0]), -1, 1)) * 180) / Math.PI
              : NaN;
          if (!clip && !grounded)
            addIssue(
              'rest-sole-contact',
              'All four actual sole face vertices must touch the trusted floor in rest',
              l.role.id,
            );
          if (
            (grounded || !clip) &&
            (!Number.isFinite(soleAngle) || soleAngle > tolerances.soleDegrees)
          )
            addIssue(
              'sole-orientation',
              'Grounded sole face is inverted, collapsed or tilted',
              l.role.id,
              clip?.id,
              time,
            );
          if (
            clip &&
            !(brief.airborneAnimations ?? []).includes(clip.id) &&
            low > floor + (l.upperLength + l.lowerLength) * 0.5
          )
            addIssue(
              'foot-lift',
              'Foot rises too far for a nonairborne clip',
              l.role.id,
              clip.id,
              time,
            );
        }
      }
      if (
        brief.anatomy !== 'prop' &&
        (!clip || !(brief.airborneAnimations ?? []).includes(clip.id)) &&
        contacts < (brief.anatomy === 'quadruped' ? 2 : 1)
      )
        addIssue(
          'missing-support',
          'Nonairborne pose needs actual grounded support feet',
          undefined,
          clip?.id,
          time,
        );
      for (const g of grips) {
        const hp = f.point(g.hand.group, g.hand.point),
          sp = f.point(g.shaft.group, g.shaft.point),
          distance = norm(sub(hp, sp));
        const ha = sub(f.point(g.hand.group, add(g.hand.point, unit(g.hand.axis))), hp),
          sa = sub(f.point(g.shaft.group, add(g.shaft.point, unit(g.shaft.axis))), sp);
        const angle =
          norm(ha) > 1e-8 && norm(sa) > 1e-8
            ? (Math.acos(clamp(Math.abs(dot(unit(ha), unit(sa))), 0, 1)) * 180) / Math.PI
            : NaN;
        if (!Number.isFinite(distance) || distance > tolerances.grip!)
          addIssue(
            'weapon-attachment',
            'Actual hand and shaft grip points separate beyond trusted tolerance',
            g.hand.group,
            clip?.id,
            time,
          );
        if (!Number.isFinite(angle) || angle > tolerances.gripDegrees)
          addIssue(
            'weapon-axis',
            'Actual hand and weapon grip axes are misaligned',
            g.hand.group,
            clip?.id,
            time,
          );
      }
      samples++;
    }
  }
  return result();
}

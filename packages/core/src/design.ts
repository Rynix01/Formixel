import { PixelAtlas } from './atlas.js';
import { parseFXL } from './dsl.js';
import { rotate } from './geometry.js';
import { type BonePose } from './animation.js';
import { inverseRotateVector, solveTwoBone } from './rig.js';
import { rgba } from './materials.js';
import { parseAnatomyRoles, assertAnatomyReferences, type AnatomyRoles } from './policy.js';
import {
  assertModel,
  canonical,
  FACE_NAMES,
  LIMITS,
  type Model,
  type Vec3,
  type FaceName,
  type Group,
} from './model.js';

export interface SurfaceRecipe {
  id: string;
  kind: 'solid' | 'scales' | 'metal' | 'bone' | 'membrane' | 'cloth';
  base: string;
  accent: string;
  detail: number;
  seed?: number;
}
export interface SurfacePart {
  cubes: string[];
  recipe: string;
  texelsPerUnit?: number;
  faces?: Partial<Record<FaceName, string>>;
}
export interface SurfacePlan {
  size: [number, number];
  texelsPerUnit: number;
  recipes: SurfaceRecipe[];
  parts: SurfacePart[];
  requireCoverage?: boolean;
}
export interface RigMarker {
  group: string;
  /** Absolute rest coordinates, matching BBIR cube and bone origins. */
  point: Vec3;
}
interface ConstraintScope {
  id: string;
  /** Omitted checks rest and every clip; [] checks rest only. */
  animations?: string[];
  /** A time window requires exactly one explicitly named clip. */
  range?: [number, number];
}
export type RigConstraint = ConstraintScope &
  (
    | { type: 'ground'; cubes: string[]; floor: number; tolerance: number }
    | {
        type: 'contact';
        marker: RigMarker;
        floor: number;
        tolerance: number;
        lockXZ?: [number, number];
      }
    | { type: 'attachment'; a: RigMarker; b: RigMarker; maxDistance: number }
    | { type: 'level'; a: RigMarker; b: RigMarker; axis: Vec3; maxDegrees: number }
    | {
        type: 'bend';
        root: RigMarker;
        joint: RigMarker;
        end: RigMarker;
        pole: Vec3;
        minDot: number;
      }
  );
export interface IKTarget {
  time: number;
  position: Vec3;
  pole: Vec3;
}
export interface IKLimb {
  upper: string;
  lower: string;
  /** End marker in absolute rest coordinates, below the lower pivot. */
  end: Vec3;
  targets: IKTarget[];
}
export interface IKMotion {
  animation: string;
  fps: number;
  limbs: IKLimb[];
  /** Maximum endpoint error at baked keys and halfway between them. Default .25 units. */
  tolerance?: number;
}
export interface DesignDocument {
  version: 1;
  source: string;
  authoring: {
    atlas?: SurfacePlan;
    constraints?: RigConstraint[];
    motions?: IKMotion[];
    roles?: AnatomyRoles;
  };
}
export interface RigIssue {
  constraint: string;
  type: RigConstraint['type'];
  animation: string | null;
  time: number;
  value: number;
  limit: number;
  message: string;
}
export interface RigReview {
  passed: boolean;
  issueCount: number;
  issues: RigIssue[];
  checks: {
    constraint: string;
    type: RigConstraint['type'];
    samples: number;
    worst: number;
    passed: boolean;
  }[];
  sampling: string;
}
export interface AuthoringReport extends RigReview {
  atlas?: { width: number; height: number; regions: number; faces: number; coveredCubes: number };
  motions: { animation: string; limbs: number; keys: number; maximumTargetError: number }[];
}

/** Provider-facing contract, also usable by offline authoring clients. */
export const DESIGN_INSTRUCTIONS = `Return only a strict JSON Formixel design document, no markdown or executable code.
Shape: {"version":1,"source":"valid FXL model source","authoring":{"atlas":SurfacePlan,"constraints":RigConstraint[],"motions":IKMotion[]}}.
FXL supplies the actual requested geometry and named groups/animations; do not substitute a generic character. No eval, scripts, shell, imports, formulas, URLs, or external texture paths.
SurfacePlan={size:[width,height],texelsPerUnit:number,recipes:[{id,kind,base,accent,detail,seed?}],parts:[{cubes:[exactCubeIds],recipe,texelsPerUnit?,faces?:{north?:recipe,east?:recipe,south?:recipe,west?:recipe,up?:recipe,down?:recipe}}],requireCoverage?:boolean}. kind is solid|scales|metal|bone|membrane|cloth; colors are #RRGGBB; detail 0..1; seed integer 0..4294967295. Atlas dimensions integers 4..1024, area <=262144; density .125..16. Every visible cube face must be assigned (requireCoverage defaults true); recipes are deterministic local paint, not imported illustrations. No duplicate cube assignments or unknown/unused declarations.
RigMarker={group:exactGroupId,point:[x,y,z]} uses absolute rest coordinates, matching BBIR pivots. Each constraint has {id,type,animations?:[exactAnimationIds],range?:[start,end]}. Omitted animations checks rest plus every animation; [] checks rest only; range requires exactly one named animation. Types: ground adds {cubes:[exactCubeIds],floor,tolerance}; contact adds {marker:RigMarker,floor,tolerance,lockXZ?:[x,z]}; attachment adds {a:RigMarker,b:RigMarker,maxDistance}; level adds {a:RigMarker,b:RigMarker,axis:[x,y,z],maxDegrees}; bend adds {root:RigMarker,joint:RigMarker,end:RigMarker,pole:[x,y,z],minDot}. Contact checks world height and optionally fixed world X/Z; attachment checks marker distance; level checks direction a->b against axis; bend checks whether the actual joint bends toward world-space pole (minDot -1..1). Tolerances are nonnegative model units, maxDegrees 0..180. Declare applicable floor, sole, joint direction and weapon grip checks; they run through the actual animated parent hierarchy at keys, interval midpoints and 24 Hz.
Optional IKMotion={animation:exactAnimationId,fps:1..60,tolerance?:number,limbs:[{upper:exactGroupId,lower:exactGroupId,end:[x,y,z],targets:[{time,position:[x,y,z],pole:[x,y,z]}]}]}. Source must contain the animation (empty is allowed). Upper/lower have zero rest rotation; lower is a direct child with its rest pivot directly below upper on negative Y; end is directly below lower. Targets/poles are world-space, cover 0 and clip length, strictly increase, and must be reachable. Existing rotation/position/scale tracks on those two bones are rejected; animated ancestors work. Targets are linearly interpolated and baked locally. Do not use IK to hide missing geometry. Total resulting animation keys <=10000.
Optional authoring.roles={body?:groupId,head?:groupId,limbs?:[{id,kind:'leg'|'arm',upper:groupId,lower:groupId,end:groupId,sole?:{cube:cubeId,face:'down'|'up'|'north'|'south'|'east'|'west'},bendPole:Vec3}],weapon?:{hand:{group,point:Vec3,axis:Vec3},shaft:{group,point:Vec3,axis:Vec3},cubes:[cubeIds],secondary?:{hand:{group,point,axis},shaft:{group,point,axis}}}}. For articulated production output supply body/head with actual own cuboids and complete distinct upper->lower->end direct limb chains with actual own cuboids; each leg names a real sole cube face directly owned by end. Four legs for quadrupeds; two legs and optionally two arms for bipeds (two arms required for weapon). Face all4solevertices touch floor0 in rest, body supported over feet. Forward convention is negativeZ unless caller overrides it. Quadruped frontelbows bend backward/hindknees forward; bipedknees forward/armelbows outward. Hand/shaft markers must lie inside their actual geometry, maintain grip distance and shaft-axis alignment. Roles contain no policy tolerances or airborne exceptions: the caller supplies trusted anatomy/floor/flight selection and production policy independently measures geometry. Unknown fields, missing references, unreachable IK and budget overflow are errors. Constraints and motions may be omitted when inapplicable; atlas is required for a textured production result.`;

const obj = (v: unknown, path: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path}: expected object`);
  return v as Record<string, unknown>;
};
const fields = (v: unknown, names: string[], required: string[], path: string) => {
  const o = obj(v, path);
  for (const k of Object.keys(o))
    if (!names.includes(k)) throw new Error(`${path}.${k}: unknown field`);
  for (const k of required) if (o[k] === undefined) throw new Error(`${path}.${k}: required`);
  return o;
};
const num = (v: unknown, min: number, max: number, path: string, integer = false): number => {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new Error(`${path}: expected ${integer ? 'integer' : 'number'} ${min}..${max}`);
  return v;
};
const id = (v: unknown, path: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(v))
    throw new Error(`${path}: invalid identifier`);
  return v;
};
const list = (v: unknown, min: number, max: number, path: string): unknown[] => {
  if (!Array.isArray(v) || v.length < min || v.length > max)
    throw new Error(`${path}: expected ${min}..${max} entries`);
  return v;
};
const vec = (v: unknown, path: string): Vec3 =>
  list(v, 3, 3, path).map((n, i) =>
    num(n, -LIMITS.coordinate, LIMITS.coordinate, `${path}[${i}]`),
  ) as Vec3;
const ids = (v: unknown, min: number, max: number, path: string) => {
  const values = list(v, min, max, path).map((n, i) => id(n, `${path}[${i}]`));
  if (new Set(values).size !== values.length) throw new Error(`${path}: duplicate identifier`);
  return values;
};
const marker = (v: unknown, path: string) => {
  const m = fields(v, ['group', 'point'], ['group', 'point'], path);
  id(m.group, `${path}.group`);
  vec(m.point, `${path}.point`);
};
function parseConstraints(v: unknown): RigConstraint[] {
  const constraints = list(v, 0, 100, 'constraints');
  const unique = new Set<string>();
  for (const [i, value] of constraints.entries()) {
    const p = `constraints[${i}]`,
      c = obj(value, p);
    const extra: Record<string, string[]> = {
      ground: ['cubes', 'floor', 'tolerance'],
      contact: ['marker', 'floor', 'tolerance', 'lockXZ'],
      attachment: ['a', 'b', 'maxDistance'],
      level: ['a', 'b', 'axis', 'maxDegrees'],
      bend: ['root', 'joint', 'end', 'pole', 'minDot'],
    };
    if (typeof c.type !== 'string' || !extra[c.type])
      throw new Error(`${p}.type: unknown constraint`);
    const required = extra[c.type]!.filter((k) => k !== 'lockXZ');
    fields(
      c,
      ['id', 'type', 'animations', 'range', ...extra[c.type]!],
      ['id', 'type', ...required],
      p,
    );
    const key = id(c.id, `${p}.id`);
    if (unique.has(key)) throw new Error(`${p}.id: duplicate constraint`);
    unique.add(key);
    if (c.animations !== undefined) ids(c.animations, 0, 128, `${p}.animations`);
    if (c.range !== undefined) {
      const range = list(c.range, 2, 2, `${p}.range`).map((n) => num(n, 0, 3600, `${p}.range`));
      if (!Array.isArray(c.animations) || c.animations.length !== 1 || range[0]! > range[1]!)
        throw new Error(`${p}.range: requires one animation and ordered time range`);
    }
    if (c.type === 'ground') ids(c.cubes, 1, LIMITS.cubes, `${p}.cubes`);
    if (c.floor !== undefined) num(c.floor, -LIMITS.coordinate, LIMITS.coordinate, `${p}.floor`);
    if (c.tolerance !== undefined) num(c.tolerance, 0, LIMITS.coordinate, `${p}.tolerance`);
    if (c.maxDistance !== undefined) num(c.maxDistance, 0, LIMITS.coordinate, `${p}.maxDistance`);
    if (c.type === 'contact') {
      marker(c.marker, `${p}.marker`);
      if (c.lockXZ !== undefined)
        list(c.lockXZ, 2, 2, `${p}.lockXZ`).forEach((n) =>
          num(n, -LIMITS.coordinate, LIMITS.coordinate, `${p}.lockXZ`),
        );
    }
    if (c.type === 'attachment' || c.type === 'level') {
      marker(c.a, `${p}.a`);
      marker(c.b, `${p}.b`);
    }
    if (c.type === 'level') {
      if (Math.hypot(...vec(c.axis, `${p}.axis`)) < 1e-8)
        throw new Error(`${p}.axis: zero direction`);
      num(c.maxDegrees, 0, 180, `${p}.maxDegrees`);
    }
    if (c.type === 'bend') {
      for (const k of ['root', 'joint', 'end']) marker(c[k], `${p}.${k}`);
      vec(c.pole, `${p}.pole`);
      num(c.minDot, -1, 1, `${p}.minDot`);
    }
  }
  return structuredClone(constraints) as RigConstraint[];
}

/** Strict bounded data parser; authorDesign also verifies every model reference. */
export function parseDesignDocument(value: unknown): DesignDocument {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 4_000_000)
    throw new Error('Design document byte budget exceeded');
  const d = fields(
    value,
    ['version', 'source', 'authoring'],
    ['version', 'source', 'authoring'],
    'design',
  );
  if (d.version !== 1) throw new Error('design.version: expected 1');
  if (
    typeof d.source !== 'string' ||
    !d.source.trim() ||
    new TextEncoder().encode(d.source).length > LIMITS.bytes
  )
    throw new Error('design.source: expected bounded FXL source');
  const a = fields(d.authoring, ['atlas', 'constraints', 'motions', 'roles'], [], 'authoring');
  if (a.roles !== undefined) parseAnatomyRoles(a.roles);
  if (a.atlas !== undefined) {
    const p = fields(
      a.atlas,
      ['size', 'texelsPerUnit', 'recipes', 'parts', 'requireCoverage'],
      ['size', 'texelsPerUnit', 'recipes', 'parts'],
      'atlas',
    );
    const size = list(p.size, 2, 2, 'atlas.size').map((n) => num(n, 4, 1024, 'atlas.size', true));
    if (size[0]! * size[1]! > LIMITS.pixels)
      throw new Error('atlas.size: texture pixel budget exceeded');
    num(p.texelsPerUnit, 0.125, 16, 'atlas.texelsPerUnit');
    if (p.requireCoverage !== undefined && typeof p.requireCoverage !== 'boolean')
      throw new Error('atlas.requireCoverage: expected boolean');
    const recipes = list(p.recipes, 1, 128, 'atlas.recipes'),
      declared = new Set<string>();
    for (const [i, recipe] of recipes.entries()) {
      const r = fields(
        recipe,
        ['id', 'kind', 'base', 'accent', 'detail', 'seed'],
        ['id', 'kind', 'base', 'accent', 'detail'],
        `recipes[${i}]`,
      );
      const key = id(r.id, `recipes[${i}].id`);
      if (declared.has(key)) throw new Error('Duplicate surface recipe');
      declared.add(key);
      if (!['solid', 'scales', 'metal', 'bone', 'membrane', 'cloth'].includes(String(r.kind)))
        throw new Error('Unknown surface recipe kind');
      for (const color of [r.base, r.accent])
        if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))
          throw new Error('Surface colors must be #RRGGBB');
      num(r.detail, 0, 1, `recipes[${i}].detail`);
      if (r.seed !== undefined) num(r.seed, 0, 4294967295, `recipes[${i}].seed`, true);
    }
    let assignments = 0;
    for (const [i, part] of list(p.parts, 1, LIMITS.cubes, 'atlas.parts').entries()) {
      const q = fields(
        part,
        ['cubes', 'recipe', 'texelsPerUnit', 'faces'],
        ['cubes', 'recipe'],
        `parts[${i}]`,
      );
      assignments += ids(q.cubes, 1, LIMITS.cubes, `parts[${i}].cubes`).length;
      if (assignments > LIMITS.cubes) throw new Error('Atlas assignment budget exceeded');
      id(q.recipe, `parts[${i}].recipe`);
      if (!declared.has(q.recipe as string)) throw new Error('Unknown surface recipe');
      if (q.texelsPerUnit !== undefined)
        num(q.texelsPerUnit, 0.125, 16, `parts[${i}].texelsPerUnit`);
      if (q.faces !== undefined) {
        const fs = fields(q.faces, [...FACE_NAMES], [], `parts[${i}].faces`);
        for (const r of Object.values(fs))
          if (!declared.has(id(r, 'face recipe'))) throw new Error('Unknown face recipe');
      }
    }
  }
  if (a.constraints !== undefined) parseConstraints(a.constraints);
  if (a.motions !== undefined) {
    let totalTargets = 0;
    for (const [i, motion] of list(a.motions, 0, 32, 'motions').entries()) {
      const m = fields(
        motion,
        ['animation', 'fps', 'limbs', 'tolerance'],
        ['animation', 'fps', 'limbs'],
        `motions[${i}]`,
      );
      id(m.animation, 'motion.animation');
      num(m.fps, 1, 60, 'motion.fps');
      if (m.tolerance !== undefined) num(m.tolerance, 0, 1, 'motion.tolerance');
      for (const limb of list(m.limbs, 1, 32, 'motion.limbs')) {
        const l = fields(
          limb,
          ['upper', 'lower', 'end', 'targets'],
          ['upper', 'lower', 'end', 'targets'],
          'limb',
        );
        id(l.upper, 'limb.upper');
        id(l.lower, 'limb.lower');
        vec(l.end, 'limb.end');
        let previous = -1;
        for (const target of list(l.targets, 2, 1000, 'limb.targets')) {
          if (++totalTargets > LIMITS.keyframes) throw new Error('IK target budget exceeded');
          const t = fields(
            target,
            ['time', 'position', 'pole'],
            ['time', 'position', 'pole'],
            'target',
          );
          const time = num(t.time, 0, 3600, 'target.time');
          if (time <= previous) throw new Error('IK target times must strictly increase');
          previous = time;
          vec(t.position, 'target.position');
          vec(t.pole, 'target.pole');
        }
      }
    }
  }
  return structuredClone(value) as DesignDocument;
}

const sub = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n - b[i]!) as Vec3;
const length = (a: Vec3) => Math.hypot(...a);
const dot = (a: Vec3, b: Vec3) => a.reduce((v, n, i) => v + n * b[i]!, 0);
const unit = (a: Vec3): Vec3 => a.map((n) => n / length(a)) as Vec3;
const finitePoint = (p: Vec3): Vec3 => {
  if (!p.every(Number.isFinite)) throw new Error('Nonfinite or unstable world/IK transform');
  return p;
};
type TransformBudget = { charge: (amount: number) => void };
const transformBudget = (): TransformBudget => {
  let used = 0;
  return {
    charge(amount) {
      used += amount;
      if (!Number.isFinite(used) || used > 20_000_000)
        throw new Error(
          'Authoring transform work budget exceeded; split constraints, clips or time ranges',
        );
    },
  };
};
function hierarchyDepths(model: Model): Map<string, number> {
  const groups = new Map(model.groups.map((g) => [g.id, g])),
    result = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = result.get(id);
    if (cached !== undefined) return cached;
    const parent = groups.get(id)!.parent,
      value = 1 + (parent ? depth(parent) : 0);
    result.set(id, value);
    return value;
  };
  for (const g of model.groups) depth(g.id);
  return result;
}
/** Callers validate the model once. Binary search avoids revalidating atlas pixels per marker sample. */
const posesAt = (_model: Model, clip: NonNullable<Model['animations']>[number], time: number) => {
  const poses = new Map<string, BonePose>();
  for (const track of clip.tracks) {
    const keys = track.keyframes;
    let left = 0,
      right = keys.length - 1;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (keys[mid]!.time < time) left = mid + 1;
      else right = mid;
    }
    const b = keys[left]!,
      a = keys[Math.max(0, left - 1)]!;
    const f =
      time <= a.time || a.interpolation === 'step'
        ? 0
        : time >= b.time
          ? 1
          : (time - a.time) / (b.time - a.time);
    // A step holds the old value until the exact next key, then jumps to that key.
    const value =
      time >= b.time
        ? ([...b.value] as Vec3)
        : (a.value.map((n, i) => n + (b.value[i]! - n) * f) as Vec3);
    let pose = poses.get(track.group);
    if (!pose) {
      pose = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
      poses.set(track.group, pose);
    }
    pose[track.channel] = value;
  }
  return poses;
};

/** Build transforms once per sample; no repeated whole-model validation in marker loops. */
function transforms(model: Model, poses?: Map<string, BonePose>) {
  const groups = new Map(model.groups.map((g) => [g.id, g]));
  const chain = (id: string) => {
    const result: Group[] = [];
    let parent: string | undefined = id;
    while (parent) {
      const g: Group = groups.get(parent)!;
      result.push(g);
      parent = g.parent;
    }
    return result;
  };
  const point = (id: string, source: Vec3): Vec3 => {
    let p: Vec3 = [...source];
    for (const g of chain(id)) {
      const pose = poses?.get(g.id);
      if (pose) p = p.map((n, i) => g.origin[i]! + (n - g.origin[i]!) * pose.scale[i]!) as Vec3;
      p = rotate(p, g.origin, g.rotation.map((n, i) => n + (pose?.rotation[i] ?? 0)) as Vec3);
      if (pose) p = p.map((n, i) => n + pose.position[i]!) as Vec3;
    }
    return finitePoint(p);
  };
  const inverse = (id: string, source: Vec3): Vec3 => {
    let p: Vec3 = [...source];
    for (const g of chain(id).reverse()) {
      const pose = poses?.get(g.id);
      if (pose) p = p.map((n, i) => n - pose.position[i]!) as Vec3;
      const v = inverseRotateVector(
        sub(p, g.origin),
        g.rotation.map((n, i) => n + (pose?.rotation[i] ?? 0)) as Vec3,
      );
      p = v.map((n, i) => g.origin[i]! + n / (pose?.scale[i] ?? 1)) as Vec3;
      finitePoint(p);
    }
    return p;
  };
  return { point, inverse };
}

function verifyConstraintReferences(model: Model, constraints: RigConstraint[]) {
  const groups = new Set(model.groups.map((g) => g.id)),
    cubes = new Set(model.cubes.map((c) => c.id));
  const clips = new Map((model.animations ?? []).map((a) => [a.id, a]));
  for (const c of constraints) {
    if (c.type === 'ground')
      for (const cube of c.cubes)
        if (!cubes.has(cube)) throw new Error(`${c.id}: unknown constrained cube ${cube}`);
    const markers =
      c.type === 'contact'
        ? [c.marker]
        : c.type === 'attachment' || c.type === 'level'
          ? [c.a, c.b]
          : c.type === 'bend'
            ? [c.root, c.joint, c.end]
            : [];
    for (const m of markers)
      if (!groups.has(m.group)) throw new Error(`${c.id}: unknown marker group ${m.group}`);
    for (const clip of c.animations ?? [])
      if (!clips.has(clip)) throw new Error(`${c.id}: unknown animation ${clip}`);
    if (c.range && c.range[1] > clips.get(c.animations![0]!)!.length)
      throw new Error(`${c.id}: time window exceeds animation length`);
  }
}

/** General physical/rig checks, not an aesthetic score or continuous collision proof. */
function reviewWithBudget(model: Model, input: unknown, budget: TransformBudget): RigReview {
  assertModel(model);
  const constraints = parseConstraints(input);
  verifyConstraintReferences(model, constraints);
  const clips = new Map((model.animations ?? []).map((a) => [a.id, a]));
  const cubeById = new Map(model.cubes.map((c) => [c.id, c]));
  const issues: RigIssue[] = [],
    checks: RigReview['checks'] = [];
  let issueCount = 0;
  const depths = hierarchyDepths(model);
  for (const c of constraints) {
    let worst = 0,
      samples = 0,
      passed = true;
    const selectedCubes = c.type === 'ground' ? c.cubes.map((id) => cubeById.get(id)!) : [];
    const markers =
      c.type === 'contact'
        ? [c.marker]
        : c.type === 'attachment' || c.type === 'level'
          ? [c.a, c.b]
          : c.type === 'bend'
            ? [c.root, c.joint, c.end]
            : [];
    const pointWork =
      selectedCubes.reduce(
        (n, cube) => n + 8 * (1 + (cube.parent ? depths.get(cube.parent)! : 0)),
        0,
      ) + markers.reduce((n, m) => n + depths.get(m.group)!, 0);
    const selected: (string | null)[] =
      c.animations === undefined
        ? [null, ...clips.keys()]
        : c.animations.length
          ? c.animations
          : [null];
    for (const animation of selected) {
      const clip = animation === null ? undefined : clips.get(animation)!;
      const from = c.range?.[0] ?? 0,
        to = c.range?.[1] ?? clip?.length ?? 0;
      const times = new Set<number>([from, to]);
      if (clip) {
        const frames = [
          ...new Set(clip.tracks.flatMap((t) => t.keyframes.map((k) => k.time))),
        ].sort((a, b) => a - b);
        for (let i = 0; i < frames.length; i++) {
          const t = frames[i]!;
          if (t >= from && t <= to) times.add(t);
          if (i && (t + frames[i - 1]!) / 2 >= from && (t + frames[i - 1]!) / 2 <= to)
            times.add((t + frames[i - 1]!) / 2);
          // Step discontinuities are checked on both sides.
          if (t > from && t <= to) times.add(Math.max(from, t - 1e-6));
        }
        if ((to - from) * 24 > 20000)
          throw new Error('Rig review sampling budget exceeded; select a shorter range');
        for (let i = 1; i < Math.ceil((to - from) * 24); i++) times.add(from + i / 24);
      }
      if (times.size > 20000) throw new Error('Rig review sampling budget exceeded');
      // Charge all requested corner transforms including ancestor depth before sampling.
      budget.charge(
        times.size * (pointWork + model.groups.length + (clip?.tracks.length ?? 0) * 16 + 4),
      );
      for (const time of [...times].sort((a, b) => a - b)) {
        // Loop clips must expose their actual final key, not wrap it back to zero.
        const poses = clip ? posesAt(model, clip, time) : undefined;
        const tx = transforms(model, poses),
          p = (m: RigMarker) => tx.point(m.group, m.point);
        let value: number, limit: number, message: string;
        if (c.type === 'ground') {
          let min = Infinity;
          for (const cube of selectedCubes) {
            for (let i = 0; i < 8; i++) {
              let v: Vec3 = [
                i & 1 ? cube.to[0] : cube.from[0],
                i & 2 ? cube.to[1] : cube.from[1],
                i & 4 ? cube.to[2] : cube.from[2],
              ];
              v = rotate(v, cube.origin, cube.rotation);
              if (cube.parent) v = tx.point(cube.parent, v);
              min = Math.min(min, v[1]);
            }
          }
          value = Math.max(0, c.floor - min);
          limit = c.tolerance;
          message = 'Cuboid penetrates the floor';
        } else if (c.type === 'contact') {
          const a = p(c.marker);
          value = Math.max(
            Math.abs(a[1] - c.floor),
            c.lockXZ ? Math.hypot(a[0] - c.lockXZ[0], a[2] - c.lockXZ[1]) : 0,
          );
          limit = c.tolerance;
          message = 'Planted marker leaves its floor or fixed X/Z target';
        } else if (c.type === 'attachment') {
          value = length(sub(p(c.a), p(c.b)));
          limit = c.maxDistance;
          message = 'Attachment markers separate';
        } else if (c.type === 'level') {
          const delta = sub(p(c.b), p(c.a));
          value =
            length(delta) < 1e-8
              ? 181
              : (Math.acos(Math.max(-1, Math.min(1, dot(unit(delta), unit(c.axis))))) * 180) /
                Math.PI;
          limit = c.maxDegrees;
          message = 'Marker direction exceeds the allowed angle';
        } else {
          const root = p(c.root),
            axis = sub(p(c.end), root),
            hint = sub(c.pole, root),
            joint = sub(p(c.joint), root);
          let score = -2;
          if (length(axis) > 1e-8) {
            const along = unit(axis),
              rejection = (v: Vec3): Vec3 => v.map((n, i) => n - along[i]! * dot(v, along)) as Vec3;
            const j = rejection(joint),
              h = rejection(hint);
            if (length(h) > 1e-8) score = length(j) < 1e-8 ? 0 : dot(unit(j), unit(h));
          }
          value = 1 - score;
          limit = 1 - c.minDot;
          message = 'Joint bends away from its declared pole or has no defined bend direction';
        }
        if (!Number.isFinite(value) || !Number.isFinite(limit))
          throw new Error(`${c.id}: nonfinite rig measurement`);
        samples++;
        worst = Math.max(worst, value);
        if (value > limit + 1e-8) {
          passed = false;
          issueCount++;
          if (issues.length < 1000)
            issues.push({ constraint: c.id, type: c.type, animation, time, value, limit, message });
        }
      }
    }
    checks.push({ constraint: c.id, type: c.type, samples, worst, passed });
  }
  return {
    passed: issueCount === 0,
    issueCount,
    issues,
    checks,
    sampling:
      'Rest, clip endpoints, every key, before discontinuities, key interval midpoints and 24 Hz; finite sampling is not continuous collision detection. At most 1000 issue details are retained.',
  };
}

export function reviewModel(model: Model, input: unknown = []): RigReview {
  return reviewWithBudget(model, input, transformBudget());
}

function paint(recipe: SurfaceRecipe, face: FaceName, seed: number) {
  const base = rgba(recipe.base),
    accent = rgba(recipe.accent),
    d = recipe.detail;
  return (x: number, y: number, w: number, h: number): number[] => {
    if (recipe.kind === 'solid') return [...base];
    let n =
      (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ seed ^ (recipe.seed ?? 0)) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 2246822519) >>> 0;
    const noise = ((n & 255) / 255 - 0.5) * 0.12 * d;
    let shade = 1 + noise,
      blend = 0;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (recipe.kind === 'scales') {
      const row = Math.floor(y / 4),
        column = (x + (row % 2) * 2) % 5;
      if (y % 4 === 3 || column === 0) shade -= 0.28 * d;
      else if (y % 4 === 0) blend = 0.28 * d;
    } else if (recipe.kind === 'metal') {
      if (edge) {
        blend = 0.65 * d;
        shade += 0.2 * d;
      } else if ((x + y * 2) % 17 === 0) blend = 0.3 * d;
      shade += (1 - y / Math.max(1, h - 1)) * 0.12 * d;
    } else if (recipe.kind === 'bone') {
      if (x % 6 === 0) shade -= 0.12 * d;
      blend = (1 - y / Math.max(1, h - 1)) * 0.25 * d;
    } else if (recipe.kind === 'membrane') {
      if ((x + Math.floor(y / 5)) % 11 === 0) shade -= 0.24 * d;
      blend = Math.max(0, 1 - Math.abs(x - (w - 1) / 2) / Math.max(1, w / 2)) * 0.25 * d;
      if (edge) shade -= 0.15 * d;
    } else if (recipe.kind === 'cloth') {
      shade += ((x + y) % 2 ? 0.06 : -0.06) * d;
      if (edge) blend = 0.4 * d;
    }
    shade += (face === 'up' ? 0.06 : face === 'down' ? -0.1 : 0) * d;
    return [0, 1, 2]
      .map((i) =>
        Math.round(
          Math.max(0, Math.min(255, (base[i]! * (1 - blend) + accent[i]! * blend) * shade)),
        ),
      )
      .concat(255);
  };
}

function authorAtlas(model: Model, plan: SurfacePlan): NonNullable<AuthoringReport['atlas']> {
  const bindings = new Map<string, SurfacePart>(),
    cubes = new Map(model.cubes.map((c) => [c.id, c]));
  const recipes = new Map(plan.recipes.map((r) => [r.id, r])),
    usedRecipes = new Set<string>();
  for (const part of plan.parts)
    for (const cube of part.cubes) {
      if (!cubes.has(cube)) throw new Error(`Unknown atlas cube ${cube}`);
      if (bindings.has(cube)) throw new Error(`Duplicate atlas assignment ${cube}`);
      bindings.set(cube, part);
    }
  const atlas = new PixelAtlas(...plan.size),
    textureId = 'formixel_design_atlas';
  if (model.textures?.some((t) => t.id === textureId))
    throw new Error('Source texture uses reserved design atlas identifier');
  let count = 0;
  const allocations: {
    cube: Model['cubes'][number];
    face: FaceName;
    width: number;
    height: number;
    recipe: SurfaceRecipe;
    key: string;
  }[] = [];
  for (const cube of model.cubes) {
    const part = bindings.get(cube.id);
    if (!part) {
      if (
        plan.requireCoverage !== false &&
        FACE_NAMES.some((f) => cube.faces?.[f]?.enabled !== false)
      )
        throw new Error(`Missing atlas assignment for ${cube.id}`);
      continue;
    }
    const size = sub(cube.to, cube.from),
      density = part.texelsPerUnit ?? plan.texelsPerUnit;
    for (const face of FACE_NAMES) {
      if (cube.faces?.[face]?.enabled === false) continue;
      const recipe = recipes.get(part.faces?.[face] ?? part.recipe)!;
      usedRecipes.add(recipe.id);
      const [a, b] =
        face === 'up' || face === 'down'
          ? [0, 2]
          : face === 'east' || face === 'west'
            ? [2, 1]
            : [0, 1];
      const width = Math.max(1, Math.ceil(size[a]! * density - 1e-9)),
        height = Math.max(1, Math.ceil(size[b]! * density - 1e-9));
      if (width > plan.size[0] - 2 || height > plan.size[1] - 2)
        throw new Error(`Surface ${cube.id}:${face} exceeds atlas at requested texel density`);
      const key = `${recipe.id}:${face}:${width}:${height}`;
      allocations.push({ cube, face, width, height, recipe, key });
    }
  }
  for (const recipe of recipes.keys())
    if (!usedRecipes.has(recipe)) throw new Error(`Unused surface recipe ${recipe}`);
  // Large rectangles first; identical recipe/orientation/size faces deliberately share padding-safe UVs.
  allocations.sort(
    (a, b) =>
      b.width * b.height - a.width * a.height || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const a of allocations) {
    const region =
      atlas.regions.get(a.key) ??
      atlas.allocate(
        a.key,
        a.width,
        a.height,
        paint(
          a.recipe,
          a.face,
          [...a.key].reduce((s, c) => (Math.imul(s, 31) + c.charCodeAt(0)) >>> 0, 0),
        ),
      );
    a.cube.faces ??= {};
    a.cube.faces[a.face] = { texture: textureId, uv: [...region.uv] };
    count++;
  }
  const referenced = new Set(
    model.cubes.flatMap((c) => Object.values(c.faces ?? {}).map((f) => f?.texture)),
  );
  model.textures = [
    ...(model.textures ?? []).filter((t) => referenced.has(t.id)),
    atlas.texture(textureId, 'Formixel authored surfaces'),
  ];
  model.resolution = [...plan.size];
  if (model.textures.reduce((n, t) => n + t.width * t.height, 0) > LIMITS.pixels)
    throw new Error('Combined texture pixel budget exceeded');
  return {
    width: atlas.width,
    height: atlas.height,
    regions: atlas.regions.size,
    faces: count,
    coveredCubes: bindings.size,
  };
}

function targetAt(targets: IKTarget[], time: number): { position: Vec3; pole: Vec3 } {
  let left = 0,
    right = targets.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (targets[mid]!.time < time) left = mid + 1;
    else right = mid;
  }
  const next = left;
  if (next <= 0) return targets[next === -1 ? targets.length - 1 : 0]!;
  const a = targets[next - 1]!,
    b = targets[next]!,
    f = (time - a.time) / (b.time - a.time);
  const mix = (x: Vec3, y: Vec3): Vec3 => x.map((n, i) => n + (y[i]! - n) * f) as Vec3;
  return { position: mix(a.position, b.position), pole: mix(a.pole, b.pole) };
}

function authorMotions(
  model: Model,
  motions: IKMotion[],
  budget: TransformBudget,
): AuthoringReport['motions'] {
  const reports: AuthoringReport['motions'] = [],
    groups = new Map(model.groups.map((g) => [g.id, g]));
  const clipIds = new Set<string>();
  const depths = hierarchyDepths(model);
  let keys = (model.animations ?? []).reduce(
    (n, a) => n + a.tracks.reduce((s, t) => s + t.keyframes.length, 0),
    0,
  );
  for (const motion of motions) {
    if (clipIds.has(motion.animation)) throw new Error('Duplicate IK motion animation');
    clipIds.add(motion.animation);
    const clip = model.animations?.find((a) => a.id === motion.animation);
    if (!clip) throw new Error(`Unknown IK animation ${motion.animation}`);
    const bones = new Set<string>();
    for (const limb of motion.limbs) {
      for (const name of [limb.upper, limb.lower]) {
        if (bones.has(name)) throw new Error('Duplicate IK bone assignment');
        bones.add(name);
        if (!groups.has(name)) throw new Error(`Unknown IK group ${name}`);
        if (groups.get(name)!.rotation.some((n) => Math.abs(n) > 1e-8))
          throw new Error('IK bones must have zero rest rotation');
        if (clip.tracks.some((t) => t.group === name))
          throw new Error('IK bone already has animation tracks');
      }
      const upper = groups.get(limb.upper)!,
        lower = groups.get(limb.lower)!;
      if (
        lower.parent !== upper.id ||
        lower.origin[1] >= upper.origin[1] ||
        Math.abs(lower.origin[0] - upper.origin[0]) > 1e-8 ||
        Math.abs(lower.origin[2] - upper.origin[2]) > 1e-8 ||
        limb.end[1] >= lower.origin[1] ||
        Math.abs(limb.end[0] - lower.origin[0]) > 1e-8 ||
        Math.abs(limb.end[2] - lower.origin[2]) > 1e-8
      )
        throw new Error('IK requires a negative-Y direct two-bone rest chain');
      if (
        limb.targets[0]!.time !== 0 ||
        limb.targets.at(-1)!.time !== clip.length ||
        limb.targets.some((t) => t.time > clip.length)
      )
        throw new Error('IK targets must cover exactly the complete animation');
    }
    for (const limb of motion.limbs) {
      let parent = groups.get(limb.upper)!.parent;
      while (parent) {
        if (bones.has(parent))
          throw new Error('IK limb roots cannot descend from another controlled limb');
        parent = groups.get(parent)!.parent;
      }
    }
    const times = new Set<number>([0, clip.length]);
    const frameCount = Math.ceil(clip.length * motion.fps);
    if (frameCount > LIMITS.keyframes) throw new Error('IK bake sampling budget exceeded');
    for (let i = 1; i < frameCount; i++) times.add(i / motion.fps);
    for (const t of clip.tracks.flatMap((t) => t.keyframes)) times.add(t.time);
    for (const limb of motion.limbs) for (const t of limb.targets) times.add(t.time);
    const ordered = [...times].sort((a, b) => a - b),
      added = ordered.length * 2 * motion.limbs.length;
    if (keys + added > LIMITS.keyframes) throw new Error('IK animation keyframe budget exceeded');
    const sampleWork = model.groups.length + (clip.tracks.length + motion.limbs.length * 2) * 16;
    const parentWork = motion.limbs.reduce((n, limb) => {
      const parent = groups.get(limb.upper)!.parent;
      return n + 2 * (parent ? depths.get(parent)! : 0);
    }, 0);
    // One generation sample per limb/key, then a shared endpoint sample per key/midpoint.
    budget.charge(
      ordered.length * (motion.limbs.length * sampleWork + parentWork) +
        (ordered.length * 2 - 1) *
          (sampleWork + motion.limbs.reduce((n, l) => n + depths.get(l.lower)!, 0)),
    );
    for (const limb of motion.limbs) {
      const upper = groups.get(limb.upper)!,
        lower = groups.get(limb.lower)!;
      const up: NonNullable<Model['animations']>[number]['tracks'][number] = {
        group: upper.id,
        channel: 'rotation',
        keyframes: [],
      };
      const down: typeof up = { group: lower.id, channel: 'rotation', keyframes: [] };
      for (const time of ordered) {
        const poses = posesAt(model, clip, time),
          tx = transforms(model, poses);
        const target = targetAt(limb.targets, time),
          local = (p: Vec3) => (upper.parent ? tx.inverse(upper.parent, p) : p);
        const localTarget = local(target.position),
          localPole = local(target.pole);
        const axis = sub(localTarget, upper.origin),
          hint = sub(localPole, upper.origin);
        if (
          length(axis) < 1e-8 ||
          length(hint.map((n, i) => n - unit(axis)[i]! * dot(hint, unit(axis))) as Vec3) < 1e-8
        )
          throw new Error(`IK pole must define a bend plane: ${clip.id}/${upper.id} at ${time}`);
        const solved = solveTwoBone(
          upper.origin,
          localTarget,
          localPole,
          upper.origin[1] - lower.origin[1],
          lower.origin[1] - limb.end[1],
        );
        if (solved.clamped && length(sub(solved.end, localTarget)) > 1e-5)
          throw new Error(`IK target unreachable: ${clip.id}/${upper.id} at ${time}`);
        up.keyframes.push({ time, value: solved.upper, interpolation: 'linear' });
        down.keyframes.push({ time, value: solved.lower, interpolation: 'linear' });
      }
      clip.tracks.push(up, down);
    }
    keys += added;
    assertModel(model);
    let maximumTargetError = 0;
    const checks = [...ordered, ...ordered.slice(1).map((t, i) => (t + ordered[i]!) / 2)];
    for (const time of checks) {
      const tx = transforms(model, posesAt(model, clip, time));
      for (const limb of motion.limbs)
        maximumTargetError = Math.max(
          maximumTargetError,
          length(sub(tx.point(limb.lower, limb.end), targetAt(limb.targets, time).position)),
        );
    }
    if (maximumTargetError > (motion.tolerance ?? 0.25) + 1e-8)
      throw new Error(
        `IK baked endpoint error ${maximumTargetError} exceeds tolerance; increase fps or simplify targets`,
      );
    reports.push({
      animation: clip.id,
      limbs: motion.limbs.length,
      keys: added,
      maximumTargetError,
    });
  }
  return reports;
}

/** Deterministic local authoring. Never runs provider supplied programs or substitutes geometry. */
export function authorDesign(input: DesignDocument): { model: Model; report: AuthoringReport } {
  const doc = parseDesignDocument(input),
    model = canonical(parseFXL(doc.source));
  if (!model.cubes.length) throw new Error('Design requires actual requested model geometry');
  if (doc.authoring.roles) assertAnatomyReferences(model, doc.authoring.roles);
  const atlas = doc.authoring.atlas ? authorAtlas(model, doc.authoring.atlas) : undefined;
  const budget = transformBudget(),
    motions = authorMotions(model, doc.authoring.motions ?? [], budget);
  assertModel(model);
  const report: AuthoringReport = {
    ...reviewWithBudget(model, doc.authoring.constraints ?? [], budget),
    ...(atlas ? { atlas } : {}),
    motions,
  };
  return { model: canonical(model), report };
}

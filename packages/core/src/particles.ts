import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  assertModel,
  serialize,
  type Diagnostic,
  type Group,
  type Model,
  type Vec3,
} from './model.js';
import { rotate } from './geometry.js';
import type { BonePose } from './animation.js';

export interface ParticleRecipe {
  id: string;
  seed: number;
  shape: 'cone';
  direction: Vec3;
  spread: number;
  speed: [number, number];
  lifetime: [number, number];
  acceleration: Vec3;
  drag: number;
  size: [number, number][];
  color: [number, string][];
  render: 'voxel' | 'sprite';
  blend: 'alpha' | 'additive';
}
export interface ParticleEvent {
  id: string;
  animation: string;
  time: number;
  recipe: string;
  duration: number;
  rate: number;
  burst: number;
  attachment: { group: string; point: Vec3 };
  space: 'world' | 'local';
}
export interface ParticleDocument {
  version: 1;
  modelDigest: string;
  recipes: ParticleRecipe[];
  events: ParticleEvent[];
}
export interface SampledParticle {
  id: string;
  position: Vec3;
  size: number;
  color: string;
  blend: ParticleRecipe['blend'];
  render: ParticleRecipe['render'];
  age: number;
  lifetime: number;
}
export const PARTICLE_LIMITS = {
  bytes: 2_000_000,
  recipes: 64,
  events: 256,
  curveNodes: 32,
  rate: 256,
  burst: 512,
  duration: 10,
  lifetime: 5,
  evaluatedBirths: 4096,
  liveParticles: 1024,
  scheduleIterations: 4096,
  transformWork: 1_000_000,
} as const;

class ParticleError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}
function fail(path: string, message: string): never {
  throw new ParticleError(path, message);
}
function object(value: unknown, fields: string[], path: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    fail(path, 'Expected a plain data object');
  const record: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key)) fail(path, 'Unknown particle field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, 'value'))
      fail(`${path}.${key}`, 'Accessors are not particle data');
    record[key] = descriptor.value;
  }
  for (const field of fields)
    if (!Object.hasOwn(record, field)) fail(`${path}.${field}`, 'Required particle field');
  return record;
}
function number(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(path, `Expected a finite number in ${min}..${max}`);
  return value;
}
function integer(value: unknown, min: number, max: number, path: string): number {
  const result = number(value, min, max, path);
  if (!Number.isInteger(result)) fail(path, 'Expected an integer');
  return result;
}
function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(value))
    fail(path, 'Invalid identifier');
  return value;
}
function vector(value: unknown, bound: number, path: string): Vec3 {
  const values = array(value, 3, path);
  if (values.length !== 3) fail(path, 'Expected three components');
  return values.map((v, i) => number(v, -bound, bound, `${path}[${i}]`)) as Vec3;
}
function pair(value: unknown, min: number, max: number, path: string): [number, number] {
  const values = array(value, 2, path);
  if (values.length !== 2) fail(path, 'Expected a min/max pair');
  const a = number(values[0], min, max, `${path}[0]`),
    b = number(values[1], min, max, `${path}[1]`);
  if (a > b) fail(path, 'Minimum exceeds maximum');
  return [a, b];
}
function array(value: unknown, max: number, path: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max
  )
    fail(path, `Expected an array with at most ${max} entries`);
  for (const key of Reflect.ownKeys(value))
    if (
      key !== 'length' &&
      (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
    )
      fail(path, 'Unknown particle array property');
  const values: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor) fail(path, 'Sparse particle arrays are not supported');
    if (!Object.hasOwn(descriptor, 'value'))
      fail(`${path}[${i}]`, 'Accessors are not particle data');
    values.push(descriptor.value);
  }
  return values;
}
function curve<T>(
  value: unknown,
  parse: (value: unknown, path: string) => T,
  path: string,
): [number, T][] {
  const values = array(value, PARTICLE_LIMITS.curveNodes, path);
  if (values.length < 2) fail(path, 'Curve requires endpoints at zero and one');
  let previous = -1;
  const result = values.map((entry, i): [number, T] => {
    const node = array(entry, 2, `${path}[${i}]`);
    if (node.length !== 2) fail(`${path}[${i}]`, 'Expected an age/value pair');
    const age = number(node[0], 0, 1, `${path}[${i}][0]`);
    if (age <= previous) fail(path, 'Curve ages must strictly increase');
    previous = age;
    return [age, parse(node[1], `${path}[${i}][1]`)];
  });
  if (result[0]![0] !== 0 || result.at(-1)![0] !== 1)
    fail(path, 'Curve requires endpoints at zero and one');
  return result;
}
const color = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{8}$/.test(value))
    fail(path, 'Expected #RRGGBBAA');
  return value.toLowerCase();
};

/** Exact canonical BBIR binding; includes geometry, textures and all animation tracks. */
export function particleModelDigest(model: Model): string {
  return bytesToHex(sha256(new TextEncoder().encode(serialize(model))));
}

/** Strict, detached data only. No executable expressions, paths, or renderer/model mutations. */
export function parseParticleDocument(model: Model, input: unknown): ParticleDocument {
  assertModel(model);
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > PARTICLE_LIMITS.bytes)
      fail('$', 'Particle document exceeds 2 MB');
    try {
      input = JSON.parse(input);
    } catch {
      fail('$', 'Invalid particle JSON');
    }
  }
  const doc = object(input, ['version', 'modelDigest', 'recipes', 'events'], '$');
  if (doc.version !== 1) fail('version', 'Expected particle document version 1');
  if (typeof doc.modelDigest !== 'string' || !/^[a-f0-9]{64}$/.test(doc.modelDigest))
    fail('modelDigest', 'Expected a lowercase SHA-256 digest');
  if (doc.modelDigest !== particleModelDigest(model))
    fail('modelDigest', 'Stale particle document: model digest does not match');
  const recipeIds = new Set<string>();
  const recipes = array(doc.recipes, PARTICLE_LIMITS.recipes, 'recipes').map(
    (value, i): ParticleRecipe => {
      const path = `recipes[${i}]`,
        r = object(
          value,
          [
            'id',
            'seed',
            'shape',
            'direction',
            'spread',
            'speed',
            'lifetime',
            'acceleration',
            'drag',
            'size',
            'color',
            'render',
            'blend',
          ],
          path,
        );
      const recipeId = id(r.id, `${path}.id`);
      if (recipeIds.has(recipeId)) fail(`${path}.id`, 'Duplicate recipe identifier');
      recipeIds.add(recipeId);
      if (r.shape !== 'cone') fail(`${path}.shape`, 'Only cone emission is supported');
      const direction = vector(r.direction, 1_000_000, `${path}.direction`);
      if (Math.hypot(...direction) === 0)
        fail(`${path}.direction`, 'Cone direction must be nonzero');
      const lifetime = pair(r.lifetime, 0, PARTICLE_LIMITS.lifetime, `${path}.lifetime`);
      if (lifetime[0] <= 0) fail(`${path}.lifetime`, 'Lifetime must be positive');
      if (r.render !== 'voxel' && r.render !== 'sprite')
        fail(`${path}.render`, 'Expected voxel or sprite');
      if (r.blend !== 'alpha' && r.blend !== 'additive')
        fail(`${path}.blend`, 'Expected alpha or additive');
      return {
        id: recipeId,
        seed: integer(r.seed, 0, 0xffffffff, `${path}.seed`),
        shape: 'cone',
        direction,
        spread: number(r.spread, 0, 180, `${path}.spread`),
        speed: pair(r.speed, 0, 10_000, `${path}.speed`),
        lifetime,
        acceleration: vector(r.acceleration, 10_000, `${path}.acceleration`),
        drag: number(r.drag, 0, 100, `${path}.drag`),
        size: curve(r.size, (v, p) => number(v, 0, 1024, p), `${path}.size`),
        color: curve(r.color, color, `${path}.color`),
        render: r.render,
        blend: r.blend,
      };
    },
  );
  const groups = new Set(model.groups.map((g) => g.id));
  const clips = new Map(model.animations?.map((a) => [a.id, a]));
  const eventIds = new Set<string>();
  const events = array(doc.events, PARTICLE_LIMITS.events, 'events').map(
    (value, i): ParticleEvent => {
      const path = `events[${i}]`,
        e = object(
          value,
          ['id', 'animation', 'time', 'recipe', 'duration', 'rate', 'burst', 'attachment', 'space'],
          path,
        );
      const eventId = id(e.id, `${path}.id`);
      if (eventIds.has(eventId)) fail(`${path}.id`, 'Duplicate event identifier');
      eventIds.add(eventId);
      const animation = id(e.animation, `${path}.animation`),
        clip = clips.get(animation);
      if (!clip) fail(`${path}.animation`, 'Unknown animation identifier');
      const time = number(e.time, 0, clip.length, `${path}.time`);
      if (clip.loop && time === clip.length)
        fail(`${path}.time`, 'Loop event time must be before clip end');
      const recipe = id(e.recipe, `${path}.recipe`);
      if (!recipeIds.has(recipe)) fail(`${path}.recipe`, 'Unknown particle recipe');
      const a = object(e.attachment, ['group', 'point'], `${path}.attachment`),
        group = id(a.group, `${path}.attachment.group`);
      if (!groups.has(group)) fail(`${path}.attachment.group`, 'Unknown attachment group');
      if (e.space !== 'world' && e.space !== 'local')
        fail(`${path}.space`, 'Expected world or local attachment');
      const duration = number(e.duration, 0, PARTICLE_LIMITS.duration, `${path}.duration`),
        rate = number(e.rate, 0, PARTICLE_LIMITS.rate, `${path}.rate`),
        burst = integer(e.burst, 0, PARTICLE_LIMITS.burst, `${path}.burst`);
      if (!burst && (!rate || !duration)) fail(path, 'Event must emit at least one particle');
      return {
        id: eventId,
        animation,
        time,
        recipe,
        duration,
        rate,
        burst,
        attachment: { group, point: vector(a.point, 1_000_000, `${path}.attachment.point`) },
        space: e.space,
      };
    },
  );
  return { version: 1, modelDigest: doc.modelDigest, recipes, events };
}

/** Nonthrowing diagnostics for UI/host validation; parsing remains the authoritative boundary. */
export function validateParticleDocument(model: Model, input: unknown): Diagnostic[] {
  try {
    parseParticleDocument(model, input);
    return [];
  } catch (error) {
    return [
      {
        path: error instanceof ParticleError ? error.path : '$',
        message: (error as Error).message,
      },
    ];
  }
}

const unit = (v: Vec3): Vec3 => {
  const scale = Math.max(...v.map(Math.abs)),
    scaled = v.map((n) => n / scale),
    length = Math.hypot(...scaled);
  return scaled.map((n) => n / length) as Vec3;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function randomFor(seed: number, identity: string): () => number {
  let state = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < identity.length; i++)
    state = Math.imul(state ^ identity.charCodeAt(i), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let v = Math.imul(state ^ (state >>> 15), state | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}
function initial(recipe: ParticleRecipe, identity: string) {
  const random = randomFor(recipe.seed, identity),
    axis = unit(recipe.direction);
  const tangent = unit(cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0])),
    bitangent = cross(axis, tangent);
  const cosine = 1 - random() * (1 - Math.cos((recipe.spread * Math.PI) / 180));
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine)),
    azimuth = random() * 2 * Math.PI;
  const speed = recipe.speed[0] + random() * (recipe.speed[1] - recipe.speed[0]);
  const velocity = axis.map(
    (n, i) =>
      speed *
      (n * cosine + sine * (tangent[i]! * Math.cos(azimuth) + bitangent[i]! * Math.sin(azimuth))),
  ) as Vec3;
  return {
    velocity,
    lifetime: recipe.lifetime[0] + random() * (recipe.lifetime[1] - recipe.lifetime[0]),
  };
}
function factors(drag: number, age: number): [number, number] {
  const x = drag * age;
  if (x < 0.001)
    return [
      age * (1 - x / 2 + (x * x) / 6 - x ** 3 / 24 + x ** 4 / 120),
      age * age * (0.5 - x / 6 + (x * x) / 24 - x ** 3 / 120 + x ** 4 / 720),
    ];
  const a = -Math.expm1(-x) / drag;
  return [a, (age - a) / drag];
}
function curveSegment<T>(nodes: [number, T][], age: number): [T, T, number] {
  for (let i = 1; i < nodes.length; i++) {
    const [at, value] = nodes[i]!,
      [previous, before] = nodes[i - 1]!;
    if (age <= at) return [before, value, (age - previous) / (at - previous)];
  }
  return [nodes.at(-1)![1], nodes.at(-1)![1], 0];
}
function sampledColor(nodes: [number, string][], age: number): string {
  const [a, b, f] = curveSegment(nodes, age);
  return (
    '#' +
    [1, 3, 5, 7]
      .map((offset) => {
        const before = parseInt(a.slice(offset, offset + 2), 16),
          after = parseInt(b.slice(offset, offset + 2), 16);
        return Math.round(before + (after - before) * f)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/** Stateless bounded evaluation at absolute elapsed seconds, including live births from older loops. */
export function sampleParticles(
  model: Model,
  document: unknown,
  animation: string,
  time: number,
): SampledParticle[] {
  const doc = parseParticleDocument(model, document);
  if (!Number.isFinite(time) || time < 0)
    fail('time', 'Particle sample time must be finite and nonnegative');
  const clip = model.animations?.find((a) => a.id === animation);
  if (!clip) fail('animation', 'Unknown animation identifier');
  const recipes = new Map(doc.recipes.map((r) => [r.id, r])),
    groups = new Map(model.groups.map((g) => [g.id, g]));
  const events = doc.events
    .filter((e) => e.animation === clip.id)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  let work = 0,
    scans = 0,
    births = 0;
  const charge = (amount: number) => {
    work += amount;
    if (!Number.isFinite(work) || work > PARTICLE_LIMITS.transformWork)
      fail('$', 'Particle transform work budget exceeded');
  };
  const chains = new Map<string, Group[]>(),
    relevant = new Set<string>();
  for (const event of events) {
    if (chains.has(event.attachment.group)) continue;
    const chain: Group[] = [];
    let current: string | undefined = event.attachment.group;
    while (current) {
      const g: Group = groups.get(current)!;
      chain.push(g);
      relevant.add(g.id);
      current = g.parent;
    }
    chains.set(event.attachment.group, chain);
  }
  const tracks = clip.tracks.filter((t) => relevant.has(t.group));
  const poseCache = new Map<number, Map<string, BonePose>>();
  const posesAt = (elapsed: number) => {
    const phase = clip.loop ? elapsed % clip.length : Math.min(elapsed, clip.length);
    const cached = poseCache.get(phase);
    if (cached) return cached;
    const poses = new Map<string, BonePose>();
    for (const track of tracks) {
      charge(1);
      const keys = track.keyframes;
      let left = 0,
        right = keys.length - 1;
      while (left < right) {
        charge(1);
        const mid = Math.floor((left + right) / 2);
        if (keys[mid]!.time < phase) left = mid + 1;
        else right = mid;
      }
      const b = keys[left]!,
        a = keys[Math.max(0, left - 1)]!;
      const f =
        phase <= a.time || a.interpolation === 'step' ? 0 : (phase - a.time) / (b.time - a.time);
      const value =
        phase >= b.time
          ? ([...b.value] as Vec3)
          : (a.value.map((n, i) => n + (b.value[i]! - n) * f) as Vec3);
      let pose = poses.get(track.group);
      if (!pose) {
        pose = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
        poses.set(track.group, pose);
      }
      pose[track.channel] = value;
    }
    poseCache.set(phase, poses);
    return poses;
  };
  const output: SampledParticle[] = [];
  const emit = (
    event: ParticleEvent,
    recipe: ParticleRecipe,
    loop: number,
    kind: string,
    index: number,
    birth: number,
  ) => {
    // Search tolerances may widen the candidate range, never the actual birth window.
    if (birth > time || birth < Math.max(0, time - recipe.lifetime[1])) return;
    if (++births > PARTICLE_LIMITS.evaluatedBirths)
      fail('$', 'Particle evaluated birth budget exceeded');
    const identity = `${event.id}/${loop}/${kind}/${index}`,
      initialState = initial(recipe, identity),
      age = Math.max(0, time - birth);
    if (age >= initialState.lifetime) return;
    if (output.length >= PARTICLE_LIMITS.liveParticles)
      fail('$', 'Particle live count budget exceeded');
    const [velocityFactor, accelerationFactor] = factors(recipe.drag, age);
    let point = event.attachment.point.map(
      (n, i) =>
        n +
        initialState.velocity[i]! * velocityFactor +
        recipe.acceleration[i]! * accelerationFactor,
    ) as Vec3;
    // Derive a scheduled birth's loop phase from its event/offset rather than a rounded k*length.
    const birthPoseTime = clip.loop
      ? (event.time + (kind === 'rate' ? index / event.rate : 0)) % clip.length
      : birth;
    const poses = posesAt(event.space === 'world' ? birthPoseTime : time);
    let logScale = 0;
    for (const group of chains.get(event.attachment.group)!) {
      charge(16);
      const pose = poses.get(group.id);
      if (pose) {
        if (pose.scale.some((n) => !Number.isFinite(n) || n <= 0))
          fail('$', 'Unrepresentable particle attachment scale');
        point = point.map(
          (n, i) => group.origin[i]! + (n - group.origin[i]!) * pose.scale[i]!,
        ) as Vec3;
        logScale += pose.scale.reduce((sum, n) => sum + Math.log(n), 0) / 3;
      }
      point = rotate(
        point,
        group.origin,
        group.rotation.map((n, i) => n + (pose?.rotation[i] ?? 0)) as Vec3,
      );
      if (pose) point = point.map((n, i) => n + pose.position[i]!) as Vec3;
      if (!point.every(Number.isFinite)) fail('$', 'Nonfinite particle attachment transform');
    }
    const normalizedAge = age / initialState.lifetime,
      [before, after, fraction] = curveSegment(recipe.size, normalizedAge);
    const sizeValue = before + (after - before) * fraction,
      size = sizeValue === 0 ? 0 : Math.exp(Math.log(sizeValue) + logScale);
    if (!Number.isFinite(size) || (sizeValue > 0 && size === 0))
      fail('$', 'Unrepresentable particle size');
    output.push({
      id: identity,
      position: point,
      size,
      color: sampledColor(recipe.color, normalizedAge),
      blend: recipe.blend,
      render: recipe.render,
      age,
      lifetime: initialState.lifetime,
    });
  };
  for (const event of events) {
    const recipe = recipes.get(event.recipe)!,
      lower = Math.max(0, time - recipe.lifetime[1]);
    const extent = event.rate > 0 ? event.duration : 0;
    const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, time) * 4);
    const first = clip.loop
      ? Math.max(0, Math.ceil((lower - event.time - extent - tolerance) / clip.length))
      : 0;
    const last = clip.loop ? Math.floor((time - event.time + tolerance) / clip.length) : 0;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last))
      fail('time', 'Particle loop index exceeds timeline precision budget');
    if (last < first) continue;
    if (last - first + 1 > PARTICLE_LIMITS.scheduleIterations - scans)
      fail('$', 'Particle schedule iteration budget exceeded');
    for (let loop = first; loop <= last; loop++) {
      scans++;
      const base = loop * clip.length + event.time;
      if (base >= lower - tolerance && base <= time + tolerance)
        for (let i = 0; i < event.burst; i++) emit(event, recipe, loop, 'burst', i, base);
      if (event.rate <= 0 || event.duration <= 0) continue;
      const begin = Math.max(0, Math.ceil((lower - base - tolerance) * event.rate));
      const end = Math.min(
        Math.max(0, Math.ceil(event.duration * event.rate) - 1),
        Math.floor((time - base + tolerance) * event.rate),
      );
      for (let i = begin; i <= end; i++) {
        const offset = i / event.rate;
        if (offset < event.duration) emit(event, recipe, loop, 'rate', i, base + offset);
      }
    }
  }
  return output;
}

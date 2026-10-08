export type Vec3 = [number, number, number];
export const FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'] as const;
export type FaceName = (typeof FACE_NAMES)[number];
export interface Face {
  uv: [number, number, number, number];
  texture?: string;
  rotation?: 0 | 90 | 180 | 270;
  enabled?: boolean;
}
export interface Material {
  id: string;
  color: string;
}
export interface Texture {
  id: string;
  name: string;
  width: number;
  height: number;
  pixels: number[];
}
export interface Keyframe {
  time: number;
  value: Vec3;
  interpolation: 'linear' | 'step';
}
export interface Track {
  group: string;
  channel: 'rotation' | 'position' | 'scale';
  keyframes: Keyframe[];
}
export interface Animation {
  id: string;
  name: string;
  length: number;
  loop: boolean;
  tracks: Track[];
}
export interface Cube {
  id: string;
  name: string;
  from: Vec3;
  to: Vec3;
  origin: Vec3;
  rotation: Vec3;
  color: number;
  parent?: string;
  material?: string;
  faces?: Partial<Record<FaceName, Face>>;
}
export interface Group {
  id: string;
  name: string;
  origin: Vec3;
  rotation: Vec3;
  parent?: string;
}
export interface Model {
  version: 1 | 2;
  name: string;
  format: 'free';
  resolution: [number, number];
  cubes: Cube[];
  groups: Group[];
  materials?: Material[];
  textures?: Texture[];
  animations?: Animation[];
}
export interface Diagnostic {
  path: string;
  message: string;
}
export const LIMITS = {
  bytes: 2_000_000,
  cubes: 10_000,
  groups: 1_000,
  depth: 32,
  coordinate: 1_000_000,
  pixels: 262_144,
  keyframes: 10_000,
} as const;
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const vector = (x: unknown): x is Vec3 =>
  Array.isArray(x) &&
  x.length === 3 &&
  x.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMITS.coordinate);
export function validate(input: unknown): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  if (!object(input)) return [{ path: '$', message: 'Expected a BBIR object' }];
  for (const key of Object.keys(input))
    if (
      ![
        'version',
        'name',
        'format',
        'resolution',
        'cubes',
        'groups',
        ...(input.version === 2 ? ['materials', 'textures', 'animations'] : []),
      ].includes(key)
    )
      add(key, 'Unknown BBIR property');
  if (input.version !== 1 && input.version !== 2) add('version', 'Expected BBIR version 1 or 2');
  if (input.format !== 'free') add('format', 'Only free format is supported');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 128)
    add('name', 'Expected a nonempty name up to 128 characters');
  if (
    !Array.isArray(input.resolution) ||
    input.resolution.length !== 2 ||
    !input.resolution.every((n) => Number.isInteger(n) && n > 0 && n <= 8192)
  )
    add('resolution', 'Expected two integers in 1..8192');
  if (!Array.isArray(input.cubes) || !Array.isArray(input.groups)) {
    add('$', 'cubes and groups must be arrays');
    return errors;
  }
  if (input.cubes.length > LIMITS.cubes || input.groups.length > LIMITS.groups) {
    add('$', 'Geometry budget exceeded');
    return errors;
  }
  const ids = new Set<string>();
  const groups = new Map<string, Record<string, unknown>>();
  const nodes = [
    ...input.groups.map((n: unknown, i: number) => ({ n, path: `groups[${i}]`, group: true })),
    ...input.cubes.map((n: unknown, i: number) => ({ n, path: `cubes[${i}]`, group: false })),
  ];
  for (const { n, path, group } of nodes) {
    if (!object(n)) {
      add(path, 'Expected object');
      continue;
    }
    const allowed = group
      ? ['id', 'name', 'origin', 'rotation', 'parent']
      : [
          'id',
          'name',
          'from',
          'to',
          'origin',
          'rotation',
          'color',
          'parent',
          ...(input.version === 2 ? ['material', 'faces'] : []),
        ];
    for (const key of Object.keys(n))
      if (!allowed.includes(key)) add(`${path}.${key}`, 'Unknown BBIR property');
    if (typeof n.id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(n.id))
      add(`${path}.id`, 'Invalid identifier');
    else {
      if (ids.has(n.id)) add(`${path}.id`, 'Duplicate identifier');
      ids.add(n.id);
      if (group) groups.set(n.id, n);
    }
    if (typeof n.name !== 'string' || !n.name.trim() || n.name.length > 128)
      add(`${path}.name`, 'Invalid name');
    for (const key of group ? ['origin', 'rotation'] : ['from', 'to', 'origin', 'rotation'])
      if (!vector(n[key])) add(`${path}.${key}`, 'Expected three finite bounded numbers');
    if (!group && vector(n.from) && vector(n.to) && n.from.some((v, i) => v >= (n.to as Vec3)[i]!))
      add(path, 'Cube dimensions must be positive');
    if (!group && (!Number.isInteger(n.color) || Number(n.color) < 0 || Number(n.color) > 7))
      add(`${path}.color`, 'Expected palette index 0..7');
    if (n.parent !== undefined && typeof n.parent !== 'string')
      add(`${path}.parent`, 'Expected group identifier');
  }
  for (const { n, path } of nodes) {
    if (!object(n)) continue;
    let parent = n.parent;
    const seen = new Set([n.id]);
    let depth = 0;
    while (typeof parent === 'string') {
      if (seen.has(parent)) {
        add(`${path}.parent`, 'Group cycle');
        break;
      }
      if (++depth > LIMITS.depth) {
        add(`${path}.parent`, 'Hierarchy depth exceeded');
        break;
      }
      seen.add(parent);
      const next = groups.get(parent);
      if (!next) {
        add(`${path}.parent`, 'Missing group');
        break;
      }
      parent = next.parent;
    }
  }
  const materials = new Set<string>();
  const textures = new Map<string, Record<string, unknown>>();
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(id);
  const extraArray = (key: string, max: number): Record<string, unknown>[] => {
    const value = input[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max || value.some((v) => !object(v))) {
      add(key, 'Invalid or oversized array');
      return [];
    }
    return value as Record<string, unknown>[];
  };
  const props = (o: Record<string, unknown>, allowed: string[], path: string) => {
    for (const k of Object.keys(o))
      if (!allowed.includes(k)) add(`${path}.${k}`, 'Unknown property');
  };
  for (const [i, m] of extraArray('materials', 256).entries()) {
    props(m, ['id', 'color'], `materials[${i}]`);
    if (!validId(m.id) || materials.has(m.id))
      add(`materials[${i}].id`, 'Invalid or duplicate material');
    else materials.add(m.id);
    if (typeof m.color !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(m.color))
      add(`materials[${i}].color`, 'Expected #RRGGBB or #RRGGBBAA');
  }
  let pixels = 0;
  for (const [i, t] of extraArray('textures', 32).entries()) {
    props(t, ['id', 'name', 'width', 'height', 'pixels'], `textures[${i}]`);
    if (!validId(t.id) || textures.has(t.id))
      add(`textures[${i}].id`, 'Invalid or duplicate texture');
    else textures.set(t.id, t);
    if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 128)
      add(`textures[${i}].name`, 'Invalid texture name');
    if (
      !Number.isInteger(t.width) ||
      !Number.isInteger(t.height) ||
      Number(t.width) < 1 ||
      Number(t.height) < 1 ||
      Number(t.width) > 1024 ||
      Number(t.height) > 1024
    )
      add(`textures[${i}]`, 'Invalid texture dimensions');
    const count = Number(t.width) * Number(t.height);
    pixels += count;
    if (
      !Array.isArray(t.pixels) ||
      t.pixels.length !== count * 4 ||
      t.pixels.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    )
      add(`textures[${i}].pixels`, 'Expected bounded RGBA8 bytes');
  }
  if (pixels > LIMITS.pixels) add('textures', 'Texture pixel budget exceeded');
  for (const { n, path, group } of nodes) {
    if (group || !object(n)) continue;
    if (n.material !== undefined && (!validId(n.material) || !materials.has(n.material)))
      add(`${path}.material`, 'Missing material');
    if (n.faces !== undefined) {
      if (!object(n.faces)) {
        add(`${path}.faces`, 'Expected face map');
        continue;
      }
      for (const [key, f] of Object.entries(n.faces)) {
        if (!FACE_NAMES.includes(key as FaceName) || !object(f)) {
          add(`${path}.faces.${key}`, 'Invalid face');
          continue;
        }
        props(f, ['uv', 'texture', 'rotation', 'enabled'], `${path}.faces.${key}`);
        if (
          !Array.isArray(f.uv) ||
          f.uv.length !== 4 ||
          !f.uv.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 8192)
        )
          add(`${path}.faces.${key}.uv`, 'Invalid UV rectangle');
        if (f.texture !== undefined && (!validId(f.texture) || !textures.has(f.texture)))
          add(`${path}.faces.${key}.texture`, 'Missing texture');
        if (f.rotation !== undefined && ![0, 90, 180, 270].includes(Number(f.rotation)))
          add(`${path}.faces.${key}.rotation`, 'Expected quarter-turn UV rotation');
        if (f.enabled !== undefined && typeof f.enabled !== 'boolean')
          add(`${path}.faces.${key}.enabled`, 'Expected boolean');
      }
    }
  }
  let keyframes = 0;
  const animationIds = new Set<string>();
  for (const [i, a] of extraArray('animations', 128).entries()) {
    const path = `animations[${i}]`;
    props(a, ['id', 'name', 'length', 'loop', 'tracks'], path);
    if (!validId(a.id) || animationIds.has(a.id))
      add(`${path}.id`, 'Invalid or duplicate animation');
    else animationIds.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 128)
      add(`${path}.name`, 'Invalid animation name');
    if (
      typeof a.length !== 'number' ||
      !Number.isFinite(a.length) ||
      a.length <= 0 ||
      a.length > 3600
    )
      add(`${path}.length`, 'Animation length must be 0..3600 seconds');
    if (typeof a.loop !== 'boolean') add(`${path}.loop`, 'Expected boolean');
    if (!Array.isArray(a.tracks) || a.tracks.length > 3000) {
      add(`${path}.tracks`, 'Invalid track array');
      continue;
    }
    const tracks = new Set<string>();
    for (const [j, t] of a.tracks.entries()) {
      const tp = `${path}.tracks[${j}]`;
      if (!object(t)) {
        add(tp, 'Invalid track');
        continue;
      }
      props(t, ['group', 'channel', 'keyframes'], tp);
      if (typeof t.group !== 'string' || !groups.has(t.group))
        add(`${tp}.group`, 'Missing animated group');
      if (!['rotation', 'position', 'scale'].includes(String(t.channel)))
        add(`${tp}.channel`, 'Invalid animation channel');
      const key = `${t.group}:${t.channel}`;
      if (tracks.has(key)) add(tp, 'Duplicate track');
      tracks.add(key);
      if (!Array.isArray(t.keyframes) || t.keyframes.length < 1) {
        add(`${tp}.keyframes`, 'Expected keyframes');
        continue;
      }
      keyframes += t.keyframes.length;
      if (keyframes > LIMITS.keyframes) {
        add('animations', 'Keyframe budget exceeded');
        return errors;
      }
      let previous = -1;
      for (const [k, f] of t.keyframes.entries()) {
        if (!object(f)) {
          add(`${tp}.keyframes[${k}]`, 'Invalid keyframe');
          continue;
        }
        props(f, ['time', 'value', 'interpolation'], `${tp}.keyframes[${k}]`);
        if (
          typeof f.time !== 'number' ||
          !Number.isFinite(f.time) ||
          f.time < 0 ||
          f.time > Number(a.length) ||
          f.time <= previous
        )
          add(`${tp}.keyframes[${k}].time`, 'Keyframe times must increase within animation length');
        previous = Number(f.time);
        if (!vector(f.value)) add(`${tp}.keyframes[${k}].value`, 'Expected finite vector');
        if (t.channel === 'scale' && vector(f.value) && f.value.some((v) => v <= 0))
          add(`${tp}.keyframes[${k}].value`, 'Scale must be positive');
        if (!['linear', 'step'].includes(String(f.interpolation)))
          add(`${tp}.keyframes[${k}].interpolation`, 'Unsupported interpolation');
      }
    }
  }
  return errors;
}
export function assertModel(input: unknown): asserts input is Model {
  const errors = validate(input);
  if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
}
export function canonical(model: Model): Model {
  assertModel(model);
  const copy = structuredClone(model);
  copy.version = 2;
  copy.materials ??= [];
  copy.textures ??= [];
  copy.animations ??= [];
  copy.cubes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  copy.groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const list of [copy.materials, copy.textures, copy.animations])
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const a of copy.animations)
    a.tracks.sort((x, y) => (`${x.group}:${x.channel}` < `${y.group}:${y.channel}` ? -1 : 1));
  return copy;
}
export function serialize(model: Model): string {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, ordered(v)]),
          )
        : value;
  return JSON.stringify(ordered(canonical(model)), null, 2) + '\n';
}

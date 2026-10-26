import {
  assertModel,
  canonical,
  type Model,
  type Vec3,
  type Cube,
  type Group,
  type Material,
  type Texture,
  type Animation,
  type Track,
} from './model.js';

export type PatchKind = 'cube' | 'group' | 'material' | 'texture' | 'animation';
type Resource = Cube | Group | Material | Texture | Animation;
export type Patch =
  | { op: 'add'; id: string; kind: PatchKind; node: Resource }
  | { op: 'replace'; id: string; kind?: PatchKind; node: Resource }
  | { op: 'translate'; id: string; offset: Vec3 }
  | { op: 'remove'; id: string; kind?: PatchKind }
  | { op: 'rename'; id: string; name: string; kind?: PatchKind }
  | { op: 'mirror'; id: string; axis: 'x' | 'y' | 'z'; newId: string }
  | { op: 'scale-subtree'; id: string; factor: number; pivot?: Vec3 }
  | {
      op: 'paint';
      id: string;
      rect: [number, number, number, number];
      color: [number, number, number, number];
    }
  | { op: 'paint'; id: string; rect: [number, number, number, number]; pixels: number[] }
  | { op: 'set-track'; id: string; track: Track }
  | { op: 'remove-track'; id: string; group: string; channel: Track['channel'] };

export const PATCH_LIMITS = { operations: 1000, bytes: 8_000_000, paintPixels: 4096 } as const;
export const PATCH_INSTRUCTIONS = `Return a JSON array of operations only, without Markdown, code or a full model. Every operation includes op and id; unknown properties are forbidden.
Exact operation shapes:
{"op":"add","id":ID,"kind":KIND,"node":NODE}
{"op":"replace","id":ID,"kind":KIND,"node":NODE}
{"op":"remove","id":ID,"kind":KIND}
{"op":"rename","id":ID,"kind":KIND,"name":NAME}
{"op":"translate","id":CUBE_ID,"offset":[X,Y,Z]}
{"op":"mirror","id":CUBE_ID,"axis":"x|y|z","newId":UNUSED_NODE_ID}
{"op":"scale-subtree","id":GROUP_ID,"factor":UNIFORM_FACTOR,"pivot":[X,Y,Z]}
{"op":"paint","id":TEXTURE_ID,"rect":[X,Y,WIDTH,HEIGHT],"color":[R,G,B,A]}
{"op":"paint","id":TEXTURE_ID,"rect":[X,Y,WIDTH,HEIGHT],"pixels":[RGBA8_BYTES_IN_ROW_ORDER]}
{"op":"set-track","id":ANIMATION_ID,"track":{"group":GROUP_ID,"channel":"rotation|position|scale","keyframes":[KEYFRAME]}}
{"op":"remove-track","id":ANIMATION_ID,"group":GROUP_ID,"channel":"rotation|position|scale"}
KIND is cube, group, material, texture or animation. For replace/remove/rename, kind may be omitted only to target geometry. Material has no name; rename is unavailable for materials. Replacements preserve id. Removal must leave no dangling references. New groups/cubes share one unique ID namespace; resources each have their own namespace. scale-subtree scales a complete group subtree uniformly by factor 0.1..10 about an optional pivot (default: group origin); coordinates, bone origins and affected numeric position tracks scale together; rotations, scale tracks, IDs, UVs and textures stay unchanged. Only explicitly editable or transform-selected complete subtrees may be scaled.
NODE shapes: cube {id,name,from:[X,Y,Z],to:[X,Y,Z],origin:[X,Y,Z],rotation:[X,Y,Z],color:0..7,parent?:GROUP_ID,material?:MATERIAL_ID,faces?:FACE_MAP}; group {id,name,origin:[X,Y,Z],rotation:[X,Y,Z],parent?:GROUP_ID}; material {id,color:"#RRGGBB|#RRGGBBAA"}; texture {id,name,width,height,pixels:[RGBA8_BYTES]}; animation {id,name,length,loop,tracks:[TRACK]}.
FACE_MAP keys are north,east,south,west,up,down and values {uv:[U0,V0,U1,V1],texture?:TEXTURE_ID,rotation?:0|90|180|270,enabled?:BOOLEAN}. KEYFRAME is {time:SECONDS,value:[X,Y,Z],interpolation:"linear|step"}. Times strictly increase inside the clip length; scales are positive. IDs match [A-Za-z0-9_.:/-]{1,128}; all numbers are finite. Paint is integer bounded RGBA8, at most 4096 texels per operation, and requires exactly one color or pixels field. New dimensions are positive; preserve all unedited content.`;
const kinds = ['cube', 'group', 'material', 'texture', 'animation'];
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value);
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Accept JSON data only. No executable values, accessors, cycles or excessive nesting. */
export function patchJSON(value: unknown, maxBytes: number = PATCH_LIMITS.bytes): string {
  const seen = new Set<object>();
  let members = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++members > 1_200_000 || depth > 40) throw new Error('Patch data budget exceeded');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object') throw new Error('Patch must contain plain JSON data');
    if (seen.has(v)) throw new Error('Patch must not contain cycles');
    if (Reflect.ownKeys(v).some((k) => typeof k === 'symbol'))
      throw new Error('Patch symbol properties are not supported');
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        Object.keys(v).some((k) => !/^(0|[1-9][0-9]*)$/.test(k)))
    )
      throw new Error('Patch arrays must be dense JSON arrays');
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error('Patch must contain plain JSON objects');
    seen.add(v);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && key === 'length') continue;
      if (!('value' in descriptor) || !descriptor.enumerable)
        throw new Error('Patch accessors and hidden properties are not supported');
      visit(descriptor.value, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > maxBytes)
    throw new Error('Patch byte budget exceeded');
  return json;
}

/** Apply an entire transaction to a clone. Only a fully valid final model is returned. */
export function applyPatch(input: Model, operations: unknown): Model {
  assertModel(input);
  if (!Array.isArray(operations) || operations.length > PATCH_LIMITS.operations)
    throw new Error(`Expected up to ${PATCH_LIMITS.operations} patch operations`);
  patchJSON(operations);
  const m = canonical(input);
  const collection = (kind: PatchKind): Resource[] => {
    if (kind === 'cube') return m.cubes;
    if (kind === 'group') return m.groups;
    if (kind === 'material') return (m.materials ??= []);
    if (kind === 'texture') return (m.textures ??= []);
    return (m.animations ??= []);
  };
  const fields = new Map<string, string[]>([
    ['translate', ['offset']],
    ['remove', ['kind']],
    ['rename', ['name', 'kind']],
    ['mirror', ['axis', 'newId']],
    ['scale-subtree', ['factor', 'pivot']],
    ['add', ['kind', 'node']],
    ['replace', ['kind', 'node']],
    ['paint', ['rect', 'color', 'pixels']],
    ['set-track', ['track']],
    ['remove-track', ['group', 'channel']],
  ]);
  for (const p of operations as Record<string, any>[]) {
    if (!object(p) || !id(p.id) || typeof p.op !== 'string')
      throw new Error('Invalid patch operation');
    const allowed = fields.get(p.op);
    if (!allowed || Object.keys(p).some((k) => !['op', 'id', ...allowed].includes(k)))
      throw new Error('Unknown patch operation or property');
    if (p.kind !== undefined && !kinds.includes(p.kind)) throw new Error('Invalid patch kind');
    if (p.op === 'scale-subtree') {
      const root = m.groups.find((g) => g.id === p.id);
      if (!root) throw new Error('Subtree scaling requires a group target');
      if (
        typeof p.factor !== 'number' ||
        !Number.isFinite(p.factor) ||
        p.factor < 0.1 ||
        p.factor > 10
      )
        throw new Error('Uniform subtree factor must be in 0.1..10');
      const pivot = p.pivot ?? root.origin;
      if (
        !Array.isArray(pivot) ||
        pivot.length !== 3 ||
        !pivot.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000)
      )
        throw new Error('Invalid bounded subtree pivot');
      const descendants = new Set([p.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g of m.groups)
          if (g.parent && descendants.has(g.parent) && !descendants.has(g.id)) {
            descendants.add(g.id);
            changed = true;
          }
      }
      const scaled = (v: Vec3): Vec3 =>
        v.map((n, i) => pivot[i] + (n - pivot[i]) * p.factor) as Vec3;
      for (const cube of m.cubes)
        if (cube.parent && descendants.has(cube.parent))
          for (const key of ['from', 'to', 'origin'] as const) cube[key] = scaled(cube[key]);
      for (const group of m.groups)
        if (descendants.has(group.id)) group.origin = scaled(group.origin);
      for (const animation of m.animations ?? [])
        for (const track of animation.tracks)
          if (track.channel === 'position' && descendants.has(track.group))
            for (const key of track.keyframes)
              key.value = key.value.map((n) => n * p.factor) as Vec3;
      continue;
    }
    if (p.op === 'paint') {
      const texture = m.textures?.find((t) => t.id === p.id);
      if (!texture) throw new Error(`Unknown texture target ${p.id}`);
      const r = p.rect;
      if (
        !Array.isArray(r) ||
        r.length !== 4 ||
        !r.every(Number.isInteger) ||
        r[0] < 0 ||
        r[1] < 0 ||
        r[2] < 1 ||
        r[3] < 1 ||
        r[0] + r[2] > texture.width ||
        r[1] + r[3] > texture.height ||
        r[2] * r[3] > PATCH_LIMITS.paintPixels
      )
        throw new Error('Invalid or oversized paint rectangle');
      const color = p.color,
        pixels = p.pixels;
      const rgba = color ?? pixels;
      if (
        (color === undefined) === (pixels === undefined) ||
        !Array.isArray(rgba) ||
        rgba.length !== (color !== undefined ? 4 : r[2] * r[3] * 4) ||
        !rgba.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255)
      )
        throw new Error('Paint requires exactly one bounded RGBA color or pixel array');
      for (let y = 0; y < r[3]; y++)
        for (let x = 0; x < r[2]; x++) {
          const to = ((r[1] + y) * texture.width + r[0] + x) * 4;
          const from = color !== undefined ? 0 : (y * r[2] + x) * 4;
          for (let c = 0; c < 4; c++) texture.pixels[to + c] = rgba[from + c];
        }
      continue;
    }
    if (p.op === 'set-track' || p.op === 'remove-track') {
      const animation = m.animations?.find((a) => a.id === p.id);
      if (!animation) throw new Error(`Unknown animation target ${p.id}`);
      const t = p.op === 'set-track' ? p.track : { group: p.group, channel: p.channel };
      if (
        !object(t) ||
        !id(t.group) ||
        !['rotation', 'position', 'scale'].includes(String(t.channel))
      )
        throw new Error('Invalid animation track target');
      const existing = animation.tracks.findIndex(
        (v) => v.group === t.group && v.channel === t.channel,
      );
      if (p.op === 'remove-track') {
        if (existing < 0) throw new Error('Unknown animation track');
        animation.tracks.splice(existing, 1);
      } else if (existing < 0) animation.tracks.push(structuredClone(p.track));
      else animation.tracks[existing] = structuredClone(p.track);
      continue;
    }
    let kind = p.kind as PatchKind | undefined;
    if (kind === undefined) kind = m.cubes.some((c) => c.id === p.id) ? 'cube' : 'group';
    const list = collection(kind);
    const index = list.findIndex((n) => n.id === p.id);
    if (p.op === 'add') {
      if (!kinds.includes(p.kind) || !object(p.node) || p.node.id !== p.id)
        throw new Error('Invalid add operation');
      if (
        index >= 0 ||
        (['cube', 'group'].includes(kind) && [...m.cubes, ...m.groups].some((n) => n.id === p.id))
      )
        throw new Error('Duplicate patch identifier');
      list.push(structuredClone(p.node) as unknown as Resource);
      continue;
    }
    const node = list[index];
    if (!node) throw new Error(`Unknown patch target ${p.id}`);
    if (p.op === 'replace') {
      if (!object(p.node) || p.node.id !== p.id)
        throw new Error('Replacement must preserve identifier');
      list[index] = structuredClone(p.node) as unknown as Resource;
    } else if (p.op === 'rename' && typeof p.name === 'string' && kind !== 'material') {
      (node as Cube | Group | Texture | Animation).name = p.name;
    } else if (p.op === 'remove') {
      if (kind === 'group' && [...m.groups, ...m.cubes].some((n) => n.parent === p.id))
        throw new Error('Cannot remove nonempty group');
      list.splice(index, 1);
    } else if (p.op === 'translate' && kind === 'cube') {
      if (
        !Array.isArray(p.offset) ||
        p.offset.length !== 3 ||
        !p.offset.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
      )
        throw new Error('Invalid translation');
      const cube = node as Cube;
      for (const key of ['from', 'to', 'origin'] as const)
        cube[key] = cube[key].map((n, i) => n + p.offset[i]) as Vec3;
    } else if (p.op === 'mirror' && kind === 'cube') {
      if (!['x', 'y', 'z'].includes(p.axis) || !id(p.newId)) throw new Error('Invalid mirror');
      if ([...m.cubes, ...m.groups].some((n) => n.id === p.newId))
        throw new Error('Duplicate patch identifier');
      const cube = node as Cube,
        axis = ['x', 'y', 'z'].indexOf(p.axis),
        c = structuredClone(cube);
      c.id = p.newId;
      c.name = p.newId;
      c.from[axis] = -cube.to[axis]!;
      c.to[axis] = -cube.from[axis]!;
      c.origin[axis] = -cube.origin[axis]!;
      c.rotation = c.rotation.map((n, i) => (i === axis ? n : -n)) as Vec3;
      m.cubes.push(c);
    } else throw new Error(`Unsupported patch operation ${p.op}`);
  }
  assertModel(m);
  return canonical(m);
}

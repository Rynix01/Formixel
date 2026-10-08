import { assertModel, LIMITS, type Model, type Vec3, type Cube, type Group } from './model.js';
import { bakeMaterials, checkerTexture } from './materials.js';
/** BBScript is the descriptive language name; FXL is its file extension. No executable expressions. */
export function parseFXL(source: string): Model {
  if (new TextEncoder().encode(source).length > LIMITS.bytes)
    throw new Error('FXL input budget exceeded');
  const tokens: { value: string; offset: number }[] = [];
  const re =
    /\s+|#[^\n]*|"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_.-]*|-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[{}\[\],]/gy;
  const fail = (message: string, offset: number): never => {
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - (before.lastIndexOf('\n') + 1) + 1;
    throw new Error(`FXL ${line}:${column}: ${message}`);
  };
  let offset = 0;
  while (offset < source.length) {
    re.lastIndex = offset;
    const match = re.exec(source);
    if (!match) return fail('Unexpected character', offset);
    const value = match[0];
    if (!/^\s|^#/.test(value)) tokens.push({ value, offset });
    offset = re.lastIndex;
  }
  let cursor = 0;
  const peek = () => tokens[cursor]?.value;
  const take = () => {
    const token = tokens[cursor++];
    if (!token) return fail('Unexpected end of FXL', source.length);
    return token.value;
  };
  const expect = (s: string) => {
    if (take() !== s) fail(`Expected ${s}`, tokens[cursor - 1]?.offset ?? source.length);
  };
  const name = () => {
    const s = take();
    if (s.startsWith('"')) return JSON.parse(s) as string;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s)) throw new Error('Expected name');
    return s;
  };
  const number = () => {
    const s = take();
    const n = Number(s);
    if (!/^-?(?:\d|\.)/.test(s) || !Number.isFinite(n)) throw new Error('Expected finite number');
    return n;
  };
  const vec = (): Vec3 => {
    expect('[');
    const x = number();
    expect(',');
    const y = number();
    expect(',');
    const z = number();
    expect(']');
    return [x, y, z];
  };
  expect('model');
  const model: Model = {
    version: 2,
    format: 'free',
    name: name(),
    resolution: [64, 64],
    cubes: [],
    groups: [],
    materials: [],
    textures: [],
    animations: [],
  };
  let macro = 0;
  const block = (parent: string | undefined, depth: number, stop: boolean): void => {
    if (depth > LIMITS.depth) throw new Error('FXL hierarchy depth exceeded');
    while (peek() && peek() !== '}') {
      const command = take();
      if (command === 'texture' && parent === undefined && !stop) {
        model.resolution = [number(), number()];
        continue;
      }
      if (command === 'material' && parent === undefined && !stop) {
        const id = name(),
          color = name();
        model.materials!.push({ id, color });
        continue;
      }
      if (command === 'pattern' && parent === undefined && !stop) {
        const id = name(),
          width = number(),
          height = number(),
          a = name(),
          b = name();
        model.textures!.push(checkerTexture(id, width, height, a, b));
        continue;
      }
      if (command === 'animation' && parent === undefined && !stop) {
        const id = name(),
          length = number(),
          loop = take();
        if (!['loop', 'once'].includes(loop)) throw new Error('Animation requires loop or once');
        const tracks: NonNullable<Model['animations']>[number]['tracks'] = [];
        expect('{');
        while (peek() && peek() !== '}') {
          const op = take(),
            channel =
              op === 'rotate'
                ? 'rotation'
                : op === 'move'
                  ? 'position'
                  : op === 'scale'
                    ? 'scale'
                    : undefined;
          if (!channel) throw new Error('Unknown animation channel');
          const group = name(),
            time = number(),
            value = vec(),
            interpolation = peek() === 'step' ? (take(), 'step' as const) : ('linear' as const);
          let track = tracks.find((t) => t.group === group && t.channel === channel);
          if (!track) {
            track = { group, channel, keyframes: [] };
            tracks.push(track);
          }
          track.keyframes.push({ time, value, interpolation });
          if (tracks.reduce((n, t) => n + t.keyframes.length, 0) > LIMITS.keyframes)
            throw new Error('Keyframe budget exceeded');
        }
        expect('}');
        model.animations!.push({ id, name: id, length, loop: loop === 'loop', tracks });
        continue;
      }
      if (command === 'repeat' || command === 'mirror') {
        const index = macro++,
          count = command === 'repeat' ? number() : 2,
          axis = command === 'mirror' ? take() : undefined;
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          count > 1000 ||
          (axis !== undefined && !['x', 'y', 'z'].includes(axis))
        )
          throw new Error('Invalid bounded macro');
        const delta = command === 'repeat' ? (expect('offset'), vec()) : ([0, 0, 0] as Vec3);
        const startCubes = model.cubes.length,
          startGroups = model.groups.length;
        expect('{');
        block(parent, depth + 1, true);
        expect('}');
        const cubes = model.cubes.splice(startCubes),
          groups = model.groups.splice(startGroups);
        if (
          model.cubes.length + cubes.length * count > LIMITS.cubes ||
          model.groups.length + groups.length * count > LIMITS.groups
        )
          throw new Error('Macro expansion budget exceeded');
        for (let i = 0; i < count; i++) {
          const prefix = `${parent ? parent + '/' : ''}${command}_${index}_${i}/`,
            oldPrefix = parent ? parent + '/' : '';
          const remap = new Map(
            [...cubes, ...groups].map((n) => [n.id, prefix + n.id.slice(oldPrefix.length)]),
          );
          for (const original of [...groups, ...cubes] as (Group | Cube)[]) {
            const n = structuredClone(original);
            n.id = remap.get(n.id)!;
            if (n.parent && remap.has(n.parent)) n.parent = remap.get(n.parent)!;
            const keys = 'from' in n ? (['from', 'to', 'origin'] as const) : (['origin'] as const);
            for (const key of keys) {
              const v = (n as any)[key] as Vec3;
              (n as any)[key] = v.map((value, j) => value + i * delta[j]!) as Vec3;
            }
            if (axis && i === 1) {
              const j = ['x', 'y', 'z'].indexOf(axis);
              n.origin[j] = -n.origin[j]!;
              n.rotation = n.rotation.map((v, k) => (k === j ? v : -v)) as Vec3;
              if ('from' in n) {
                const c = n as Cube;
                const from = c.from[j]!;
                c.from[j] = -c.to[j]!;
                c.to[j] = -from;
              }
            }
            if ('from' in n) model.cubes.push(n as Cube);
            else model.groups.push(n);
          }
        }
        continue;
      }
      if (command === 'group') {
        const n = name();
        const id = parent ? `${parent}/${n}` : n;
        const origin = peek() === 'origin' ? (take(), vec()) : ([0, 0, 0] as Vec3);
        const rotation = peek() === 'rotate' ? (take(), vec()) : ([0, 0, 0] as Vec3);
        model.groups.push({ id, name: n, origin, rotation, ...(parent ? { parent } : {}) });
        if (model.groups.length > LIMITS.groups) throw new Error('Group budget exceeded');
        expect('{');
        block(id, depth + 1, true);
        expect('}');
      } else if (command === 'cube') {
        const n = name();
        const from = vec();
        const size = vec();
        const origin = peek() === 'origin' ? (take(), vec()) : ([0, 0, 0] as Vec3);
        const rotation = peek() === 'rotate' ? (take(), vec()) : ([0, 0, 0] as Vec3);
        const color = peek() === 'color' ? (take(), number()) : 0;
        const material = peek() === 'material' ? (take(), name()) : undefined;
        const surface = peek() === 'surface' ? (take(), name()) : undefined;
        const texture = surface ? model.textures!.find((t) => t.id === surface) : undefined;
        if (surface && !texture) throw new Error(`Unknown surface ${surface}`);
        model.cubes.push({
          id: parent ? `${parent}/${n}` : n,
          name: n,
          from,
          to: from.map((v, i) => v + size[i]!) as Vec3,
          origin,
          rotation,
          color,
          ...(parent ? { parent } : {}),
          ...(material ? { material } : {}),
          ...(texture
            ? {
                faces: Object.fromEntries(
                  ['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [
                    f,
                    { uv: [0, 0, texture.width, texture.height], texture: texture.id },
                  ]),
                ),
              }
            : {}),
        });
        if (model.cubes.length > LIMITS.cubes) throw new Error('Cube budget exceeded');
      } else throw new Error(`Unknown FXL statement ${command}`);
    }
    if (!stop && peek()) throw new Error('Unexpected closing brace');
  };
  block(undefined, 0, false);
  assertModel(model);
  return bakeMaterials(model);
}

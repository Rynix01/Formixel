import { assertModel, canonical, type Model, type Vec3, type Cube, type Group } from './model.js';
export type Patch =
  | { op: 'add'; id: string; kind: 'cube'; node: Cube }
  | { op: 'add'; id: string; kind: 'group'; node: Group }
  | { op: 'replace'; id: string; node: Cube | Group }
  | { op: 'translate'; id: string; offset: Vec3 }
  | { op: 'remove'; id: string }
  | { op: 'rename'; id: string; name: string }
  | { op: 'mirror'; id: string; axis: 'x' | 'y' | 'z'; newId: string };
export function applyPatch(input: Model, operations: unknown): Model {
  assertModel(input);
  if (!Array.isArray(operations) || operations.length > 1000)
    throw new Error('Expected up to 1000 patch operations');
  const m = canonical(input);
  for (const p of operations) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string')
      throw new Error('Invalid patch operation');
    const fields: Record<string, string[]> = {
      translate: ['offset'],
      remove: [],
      rename: ['name'],
      mirror: ['axis', 'newId'],
      add: ['kind', 'node'],
      replace: ['node'],
    };
    const allowed = fields[p.op];
    if (!allowed || Object.keys(p).some((k) => !['op', 'id', ...allowed].includes(k)))
      throw new Error('Unknown patch operation or property');
    if (p.op === 'add') {
      if (
        !p.node ||
        typeof p.node !== 'object' ||
        p.node.id !== p.id ||
        !['cube', 'group'].includes(p.kind)
      )
        throw new Error('Invalid add operation');
      if ([...m.cubes, ...m.groups].some((n) => n.id === p.id))
        throw new Error('Duplicate patch identifier');
      if (p.kind === 'cube') m.cubes.push(structuredClone(p.node));
      else m.groups.push(structuredClone(p.node));
      assertModel(m);
      continue;
    }
    const cube = m.cubes.find((c) => c.id === p.id);
    const group = m.groups.find((g) => g.id === p.id);
    const node = cube ?? group;
    if (!node) throw new Error(`Unknown patch target ${p.id}`);
    if (p.op === 'replace') {
      if (!p.node || typeof p.node !== 'object' || p.node.id !== p.id)
        throw new Error('Replacement must preserve identifier');
      if (cube) m.cubes[m.cubes.indexOf(cube)] = structuredClone(p.node);
      else m.groups[m.groups.indexOf(group!)] = structuredClone(p.node);
      assertModel(m);
    } else if (p.op === 'rename' && typeof p.name === 'string') node.name = p.name;
    else if (p.op === 'remove') {
      if (group && [...m.groups, ...m.cubes].some((n) => n.parent === p.id))
        throw new Error('Cannot remove nonempty group');
      m.cubes = m.cubes.filter((c) => c.id !== p.id);
      m.groups = m.groups.filter((g) => g.id !== p.id);
    } else if (p.op === 'translate' && cube) {
      if (
        !Array.isArray(p.offset) ||
        p.offset.length !== 3 ||
        !p.offset.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
      )
        throw new Error('Invalid translation');
      for (const key of ['from', 'to', 'origin'] as const)
        cube[key] = cube[key].map((n, i) => n + p.offset[i]) as Vec3;
    } else if (p.op === 'mirror' && cube) {
      if (!['x', 'y', 'z'].includes(p.axis) || typeof p.newId !== 'string')
        throw new Error('Invalid mirror');
      const axis = ['x', 'y', 'z'].indexOf(p.axis);
      const c = structuredClone(cube);
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

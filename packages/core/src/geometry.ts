import { assertModel, type Model, type Vec3 } from './model.js';
import type { BonePose } from './animation.js';
export function rotate(point: Vec3, origin: Vec3, degrees: Vec3): Vec3 {
  let [x, y, z] = point.map((v, i) => v - origin[i]!) as Vec3;
  const [rx, ry, rz] = degrees.map((v) => (v * Math.PI) / 180) as Vec3;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + origin[0], y + origin[1], z + origin[2]];
}
export function geometry(
  model: Model,
  poses?: Map<string, BonePose>,
): { id: string; vertices: Vec3[]; color: number }[] {
  assertModel(model);
  const groups = new Map(model.groups.map((g) => [g.id, g]));
  return model.cubes.map((c) => {
    const vertices: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      let p: Vec3 = [
        i & 1 ? c.to[0] : c.from[0],
        i & 2 ? c.to[1] : c.from[1],
        i & 4 ? c.to[2] : c.from[2],
      ];
      p = rotate(p, c.origin, c.rotation);
      let parent = c.parent;
      while (parent) {
        const g = groups.get(parent)!;
        const pose = poses?.get(parent);
        if (pose) p = p.map((v, i) => g.origin[i]! + (v - g.origin[i]!) * pose.scale[i]!) as Vec3;
        p = rotate(
          p,
          g.origin,
          pose ? (g.rotation.map((v, i) => v + pose.rotation[i]!) as Vec3) : g.rotation,
        );
        if (pose) p = p.map((v, i) => v + pose.position[i]!) as Vec3;
        parent = g.parent;
      }
      vertices.push(p);
    }
    return { id: c.id, vertices, color: c.color };
  });
}
export function inspect(model: Model) {
  const points = geometry(model).flatMap((c) => c.vertices);
  const bounds = points.length
    ? {
        min: [0, 1, 2].map((i) => points.reduce((n, p) => Math.min(n, p[i]!), Infinity)),
        max: [0, 1, 2].map((i) => points.reduce((n, p) => Math.max(n, p[i]!), -Infinity)),
      }
    : null;
  return {
    name: model.name,
    cubes: model.cubes.length,
    groups: model.groups.length,
    faces: model.cubes.length * 6,
    bounds,
  };
}
const palette = [
  '#a855f7',
  '#f0abfc',
  '#64748b',
  '#22c55e',
  '#3b82f6',
  '#ef4444',
  '#f59e0b',
  '#f8fafc',
];
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
/** Deterministic isometric flat-color SVG preview; no GPU or texture decoding. */
export function renderSVG(model: Model): string {
  const faces = [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
  ];
  const project = (p: Vec3) => [((p[0] - p[2]) * Math.sqrt(3)) / 2, (p[0] + p[2]) / 2 - p[1]];
  const polygons = geometry(model)
    .flatMap((c) =>
      faces.flatMap((f) => {
        const vertices = f.map((j) => c.vertices[j]!);
        const a = vertices[1]!.map((v, i) => v - vertices[0]![i]!) as Vec3;
        const b = vertices[2]!.map((v, i) => v - vertices[0]![i]!) as Vec3;
        const normal: Vec3 = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        if (normal[0] + normal[1] + normal[2] <= 0) return [];
        const length = Math.hypot(...normal);
        const shade =
          0.6 + 0.4 * Math.max(0, (normal[0] * 0.3 + normal[1] * 0.8 + normal[2] * 0.5) / length);
        const color = palette[c.color]!.slice(1)
          .match(/../g)!
          .map((hex) =>
            Math.round(parseInt(hex, 16) * shade)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('');
        return [
          {
            points: vertices.map(project),
            depth: vertices.reduce((s, p) => s + p[0] + p[1] + p[2], 0) / 4,
            color: `#${color}`,
          },
        ];
      }),
    )
    .sort((a, b) => a.depth - b.depth);
  const points = polygons.flatMap((p) => p.points);
  const minX = points.reduce((n, p) => Math.min(n, p[0]!), 0),
    minY = points.reduce((n, p) => Math.min(n, p[1]!), 0);
  const maxX = points.reduce((n, p) => Math.max(n, p[0]!), 0),
    maxY = points.reduce((n, p) => Math.max(n, p[1]!), 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="${minX - 2} ${minY - 2} ${Math.max(4, maxX - minX + 4)} ${Math.max(4, maxY - minY + 4)}"><title>${escape(model.name)}</title>${polygons.map((p) => `<polygon points="${p.points.map((v) => v.map((n) => n.toFixed(6)).join(',')).join(' ')}" fill="${p.color}" stroke="#1e293b" stroke-width="0.08"/>`).join('')}</svg>\n`;
}

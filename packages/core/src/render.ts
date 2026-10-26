import { assertModel, type Model, type Vec3, type FaceName } from './model.js';
import { geometry } from './geometry.js';
import { bakeMaterials, rgba } from './materials.js';
import { encodePNG, type ImageRGBA } from './png.js';
import { sampleAnimation } from './animation.js';
import { faceUVs } from './uv.js';
import { sampleParticles, type ParticleDocument } from './particles.js';
import { validateEmissionDocument, type EmissionDocument } from './emission.js';
export interface RenderOptions {
  width?: number;
  height?: number;
  animation?: string;
  time?: number;
  background?: string;
  view?: RenderView;
  /** A fixed world-space envelope for consistent framing across animation frames. */
  bounds?: { min: Vec3; max: Vec3 };
  framing?: { min: [number, number]; max: [number, number] };
  /** Trusted in-process accounting hook; never read from a task/model file. */
  onWork?: (candidatePixels: number) => void;
  /** Digest-bound independent effects; animation selects their timeline. */
  particles?: ParticleDocument;
  emission?: EmissionDocument;
}
export const RENDER_VIEWS = ['isometric', 'front', 'back', 'left', 'right', 'top'] as const;
export type RenderView = (typeof RENDER_VIEWS)[number];
const faceIndices: Record<FaceName, number[]> = {
  west: [0, 4, 6, 2],
  east: [1, 3, 7, 5],
  down: [0, 1, 5, 4],
  up: [2, 6, 7, 3],
  north: [0, 2, 3, 1],
  south: [4, 5, 7, 6],
};
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
export function renderPixels(input: Model, options: RenderOptions = {}): ImageRGBA {
  assertModel(input);
  if (options.particles && !options.animation)
    throw new Error('Particle preview requires an animation');
  const particles = options.particles
    ? sampleParticles(input, options.particles, options.animation!, options.time ?? 0)
    : [];
  const masks = new Map(
    (options.emission ? validateEmissionDocument(input, options.emission).masks : []).map(
      (mask) => [mask.texture, mask],
    ),
  );
  const model = bakeMaterials(input),
    width = options.width ?? 512,
    height = options.height ?? 512;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 1024 ||
    height > 1024
  )
    throw new Error('Render size must be 16..1024');
  const poses = options.animation
    ? sampleAnimation(model, options.animation, options.time ?? 0)
    : undefined;
  const mesh = geometry(model, poses);
  const textures = new Map((model.textures ?? []).map((t) => [t.id, t]));
  const cubes = new Map(model.cubes.map((c) => [c.id, c]));
  const view = options.view ?? 'isometric';
  if (!RENDER_VIEWS.includes(view)) throw new Error('Unknown render view');
  const directions: Record<RenderView, Vec3> = {
    isometric: [1, 1, -1],
    front: [0, 0, -1],
    back: [0, 0, 1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 1, 0],
  };
  const direction = directions[view];
  const project = (p: Vec3): Vec3 => {
    switch (view) {
      case 'front':
        return [p[0], -p[1], -p[2]];
      case 'back':
        return [-p[0], -p[1], p[2]];
      case 'left':
        return [-p[2], -p[1], -p[0]];
      case 'right':
        return [p[2], -p[1], p[0]];
      case 'top':
        return [p[0], p[2], p[1]];
      default:
        return [((p[0] + p[2]) * Math.sqrt(3)) / 2, (p[0] - p[2]) / 2 - p[1], p[0] + p[1] - p[2]];
    }
  };
  if (
    options.bounds &&
    (!Array.isArray(options.bounds.min) ||
      !Array.isArray(options.bounds.max) ||
      options.bounds.min.length !== 3 ||
      options.bounds.max.length !== 3 ||
      !options.bounds.min.every(Number.isFinite) ||
      !options.bounds.max.every(Number.isFinite) ||
      options.bounds.min.some((n, i) => n >= options.bounds!.max[i]!))
  )
    throw new Error('Invalid render framing bounds');
  if (
    options.framing &&
    (options.bounds ||
      !Array.isArray(options.framing.min) ||
      !Array.isArray(options.framing.max) ||
      options.framing.min.length !== 2 ||
      options.framing.max.length !== 2 ||
      ![...options.framing.min, ...options.framing.max].every(Number.isFinite) ||
      options.framing.min.some((n, i) => n >= options.framing!.max[i]!))
  )
    throw new Error('Invalid projected framing');
  const all: Vec3[] = options.framing
    ? [
        [options.framing.min[0], options.framing.min[1], 0],
        [options.framing.max[0], options.framing.max[1], 0],
      ]
    : options.bounds
      ? Array.from({ length: 8 }, (_, i) =>
          project([
            i & 1 ? options.bounds!.max[0] : options.bounds!.min[0],
            i & 2 ? options.bounds!.max[1] : options.bounds!.min[1],
            i & 4 ? options.bounds!.max[2] : options.bounds!.min[2],
          ]),
        )
      : mesh.length
        ? mesh.flatMap((c) => c.vertices.map(project))
        : particles.length
          ? particles.flatMap((p) => {
              const point = project(p.position),
                radius = p.size / 2;
              return [
                [point[0] - radius, point[1] - radius, point[2]],
                [point[0] + radius, point[1] + radius, point[2]],
              ] as Vec3[];
            })
          : [[0, 0, 0] as Vec3];
  const minX = all.reduce((n, p) => Math.min(n, p[0]), Infinity),
    maxX = all.reduce((n, p) => Math.max(n, p[0]), -Infinity),
    minY = all.reduce((n, p) => Math.min(n, p[1]), Infinity),
    maxY = all.reduce((n, p) => Math.max(n, p[1]), -Infinity);
  const scale = all.length
    ? Math.min(
        (width * 0.84) / Math.max(1, maxX - minX),
        (height * 0.84) / Math.max(1, maxY - minY),
      )
    : 1;
  const centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  const pixels = new Uint8Array(width * height * 4),
    depth = new Float64Array(width * height).fill(-Infinity);
  const bg = rgba(options.background ?? '#101827ff');
  for (let i = 0; i < width * height; i++) pixels.set(bg, i * 4);
  let workload = 0;
  for (const element of mesh) {
    const cube = cubes.get(element.id)!;
    for (const [key, indices] of Object.entries(faceIndices)) {
      const face = cube.faces?.[key as FaceName];
      if (face?.enabled === false) continue;
      const verts = indices.map((i) => element.vertices[i]!);
      const a = verts[1]!.map((v, i) => v - verts[0]![i]!) as Vec3,
        b = verts[2]!.map((v, i) => v - verts[0]![i]!) as Vec3;
      const normal: Vec3 = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      if (normal.reduce((sum, v, i) => sum + v * direction[i]!, 0) <= 0) continue;
      const shade =
        0.65 +
        0.35 *
          Math.max(
            0,
            (normal[0] * 0.3 + normal[1] * 0.8 - normal[2] * 0.5) / Math.hypot(...normal),
          );
      const points = verts.map((v) => {
        const p = project(v);
        return [
          (p[0] - centerX) * scale + width / 2,
          (p[1] - centerY) * scale + height / 2,
          p[2],
        ] as Vec3;
      });
      const texcoords = faceUVs(key as FaceName, face?.uv ?? [0, 0, 1, 1], face?.rotation ?? 0);
      const texture = face?.texture ? textures.get(face.texture) : undefined,
        base = rgba(palette[cube.color]!);
      for (const triangle of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const [ia, ib, ic] = triangle as [number, number, number],
          p = points[ia]!,
          q = points[ib]!,
          r = points[ic]!;
        const area = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
        if (Math.abs(area) < 1e-10) continue;
        const x0 = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0]))),
          x1 = Math.min(width - 1, Math.ceil(Math.max(p[0], q[0], r[0]))),
          y0 = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1]))),
          y1 = Math.min(height - 1, Math.ceil(Math.max(p[1], q[1], r[1])));
        workload += (x1 - x0 + 1) * (y1 - y0 + 1);
        if (workload > 100_000_000)
          throw new Error('Render work budget exceeded; reduce geometry or resolution');
        options.onWork?.((x1 - x0 + 1) * (y1 - y0 + 1));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const wa = ((q[1] - r[1]) * (x + 0.5 - r[0]) + (r[0] - q[0]) * (y + 0.5 - r[1])) / area,
              wb = ((r[1] - p[1]) * (x + 0.5 - r[0]) + (p[0] - r[0]) * (y + 0.5 - r[1])) / area,
              wc = 1 - wa - wb;
            if (Math.min(wa, wb, wc) < -1e-9) continue;
            const z = wa * p[2] + wb * q[2] + wc * r[2],
              index = y * width + x;
            if (z < depth[index]!) continue;
            let color = base;
            let emission = 0;
            if (texture) {
              const u = wa * texcoords[ia]![0]! + wb * texcoords[ib]![0]! + wc * texcoords[ic]![0]!,
                v = wa * texcoords[ia]![1]! + wb * texcoords[ib]![1]! + wc * texcoords[ic]![1]!;
              const tx = Math.max(0, Math.min(texture.width - 1, Math.floor(u))),
                ty = Math.max(0, Math.min(texture.height - 1, Math.floor(v)));
              color = texture.pixels.slice(
                (ty * texture.width + tx) * 4,
                (ty * texture.width + tx) * 4 + 4,
              );
              emission = masks.get(texture.id)?.pixels[ty * texture.width + tx] ?? 0;
            }
            // Cutout alpha: deterministic Minecraft-style pixel textures, no order-dependent blending.
            if (color[3]! < 128) continue;
            depth[index] = z;
            pixels.set(
              [
                Math.round(
                  Math.round(color[0]! * shade) * (1 - emission / 255) +
                    (color[0]! * emission) / 255,
                ),
                Math.round(
                  Math.round(color[1]! * shade) * (1 - emission / 255) +
                    (color[1]! * emission) / 255,
                ),
                Math.round(
                  Math.round(color[2]! * shade) * (1 - emission / 255) +
                    (color[2]! * emission) / 255,
                ),
                255,
              ],
              index * 4,
            );
          }
      }
    }
  }
  // Independent screen-facing particle quads, sorted back to front against opaque model depth.
  // Voxel mode uses sharp square pixels; sprite mode uses a soft radial alpha falloff.
  for (const particle of particles
    .map((p) => ({ ...p, projected: project(p.position) }))
    .sort((a, b) => a.projected[2] - b.projected[2] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const [px, py, z] = particle.projected;
    const cx = (px - centerX) * scale + width / 2,
      cy = (py - centerY) * scale + height / 2;
    const radius = (particle.size * scale) / 2;
    if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid particle preview size');
    if (radius === 0) continue;
    const color = rgba(particle.color);
    if (!color[3]) continue;
    const x0 = Math.max(0, Math.floor(cx - radius)),
      x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)),
      y1 = Math.min(height - 1, Math.ceil(cy + radius));
    if (x1 < x0 || y1 < y0) continue;
    const work = (x1 - x0 + 1) * (y1 - y0 + 1);
    workload += work;
    if (workload > 100_000_000) throw new Error('Particle render work budget exceeded');
    options.onWork?.(work);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / radius,
          dy = (y + 0.5 - cy) / radius;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
        const alpha =
          (color[3]! / 255) *
          (particle.render === 'sprite' ? Math.max(0, 1 - Math.hypot(dx, dy)) : 1);
        const index = y * width + x;
        if (alpha <= 0 || z < depth[index]!) continue;
        const at = index * 4,
          oldAlpha = pixels[at + 3]! / 255;
        const nextAlpha = alpha + oldAlpha * (1 - alpha);
        for (let channel = 0; channel < 3; channel++)
          pixels[at + channel] =
            particle.blend === 'additive'
              ? Math.min(
                  255,
                  Math.round(
                    (pixels[at + channel]! * oldAlpha + color[channel]! * alpha) / nextAlpha,
                  ),
                )
              : Math.round(
                  (color[channel]! * alpha + pixels[at + channel]! * oldAlpha * (1 - alpha)) /
                    nextAlpha,
                );
        pixels[at + 3] = Math.round(nextAlpha * 255);
      }
  }
  return { width, height, pixels };
}
export function renderPNG(model: Model, options: RenderOptions = {}): Uint8Array {
  return encodePNG(renderPixels(model, options));
}

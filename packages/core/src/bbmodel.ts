import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  assertModel,
  canonical,
  FACE_NAMES,
  type Model,
  type Face,
  type Animation,
  type Track,
  type Vec3,
} from './model.js';
import { encodePNG, pngDataURL, pngFromDataURL } from './png.js';
import { bakeMaterials } from './materials.js';
const uuid = (s: string) => {
  const h = bytesToHex(sha256(new TextEncoder().encode(`Formixel:${s}`)));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export function exportBBModel(input: Model): Record<string, unknown> {
  const m = bakeMaterials(input);
  const children = (parent?: string): unknown[] => [
    ...m.groups
      .filter((g) => g.parent === parent)
      .map((g) => ({
        name: g.name,
        uuid: uuid(g.id),
        origin: g.origin,
        rotation: g.rotation,
        children: children(g.id),
        export: true,
        isOpen: true,
        visibility: true,
        formixel_id: g.id,
      })),
    ...m.cubes.filter((c) => c.parent === parent).map((c) => uuid(c.id)),
  ];
  return {
    meta: { format_version: '5.0', model_format: 'free', box_uv: false },
    name: m.name,
    resolution: { width: m.resolution[0], height: m.resolution[1] },
    elements: m.cubes.map((c) => ({
      name: c.name,
      uuid: uuid(c.id),
      type: 'cube',
      from: c.from,
      to: c.to,
      origin: c.origin,
      rotation: c.rotation,
      color: c.color,
      box_uv: false,
      faces: Object.fromEntries(
        ['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [
          f,
          {
            uv: c.faces?.[f as keyof typeof c.faces]?.uv ?? [0, 0, 0, 0],
            texture:
              c.faces?.[f as keyof typeof c.faces]?.enabled === false
                ? null
                : c.faces?.[f as keyof typeof c.faces]?.texture
                  ? (m.textures ?? []).findIndex(
                      (t) => t.id === c.faces?.[f as keyof typeof c.faces]?.texture,
                    )
                  : false,
            rotation: c.faces?.[f as keyof typeof c.faces]?.rotation ?? 0,
          },
        ]),
      ),
      formixel_id: c.id,
      ...(c.material ? { formixel_material: c.material } : {}),
    })),
    outliner: children(),
    formixel_materials: m.materials ?? [],
    textures: (m.textures ?? []).map((t, i) => ({
      uuid: uuid(`texture:${t.id}`),
      id: String(i),
      name: t.name,
      width: t.width,
      height: t.height,
      uv_width: t.width,
      uv_height: t.height,
      source: pngDataURL(
        encodePNG({ width: t.width, height: t.height, pixels: Uint8Array.from(t.pixels) }),
      ),
      internal: true,
      formixel_id: t.id,
    })),
    animations: (m.animations ?? []).map((a) => ({
      uuid: uuid(`animation:${a.id}`),
      formixel_id: a.id,
      name: a.name,
      length: a.length,
      loop: a.loop ? 'loop' : 'once',
      animators: Object.fromEntries(
        m.groups
          .filter((g) => a.tracks.some((t) => t.group === g.id))
          .map((g) => [
            uuid(g.id),
            {
              name: g.name,
              type: 'bone',
              keyframes: a.tracks
                .filter((t) => t.group === g.id)
                .flatMap((t) =>
                  t.keyframes.map((k) => ({
                    uuid: uuid(`${a.id}:${g.id}:${t.channel}:${k.time}`),
                    channel: t.channel,
                    time: k.time,
                    interpolation: k.interpolation,
                    data_points: [{ x: k.value[0], y: k.value[1], z: k.value[2] }],
                  })),
                ),
            },
          ]),
      ),
    })),
  };
}
/** Cuboid importer: embedded RGBA/RGB8 PNG, UVs and numeric linear/step bone tracks. */
export function importBBModel(input: unknown): Model {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Expected bbmodel object');
  const b = input as Record<string, any>;
  if (b.meta?.model_format !== 'free') throw new Error('Only free bbmodel format is supported');
  if (!['4.10', '5.0'].includes(b.meta?.format_version))
    throw new Error('Supported bbmodel versions are 4.10 and 5.0');
  if (!Array.isArray(b.elements) || !Array.isArray(b.outliner))
    throw new Error('Missing bbmodel elements/outliner');
  if (b.elements.length > 10_000) throw new Error('Element budget exceeded');
  for (const key of ['animation_controllers', 'texture_groups', 'collections'])
    if (b[key] !== undefined && (!Array.isArray(b[key]) || b[key].length))
      throw new Error(`Unsupported bbmodel ${key}; refusing lossy import`);
  if (b.display && Object.keys(b.display).length) throw new Error('Unsupported display transforms');
  const m: Model = {
    version: 2,
    name: b.name,
    format: 'free',
    resolution: [b.resolution?.width, b.resolution?.height],
    cubes: [],
    groups: [],
    materials: b.formixel_materials ?? [],
    textures: [],
    animations: [],
  };
  if (b.textures !== undefined && (!Array.isArray(b.textures) || b.textures.length > 32))
    throw new Error('Invalid texture array');
  const textureIds = new Map<string, string>();
  let pixelCount = 0;
  for (const [i, t] of (b.textures ?? []).entries()) {
    if (!t || typeof t.source !== 'string' || t.frame_time || t.animated)
      throw new Error('Textures must be static embedded PNGs');
    const image = pngFromDataURL(t.source);
    pixelCount += image.width * image.height;
    if (pixelCount > 262144) throw new Error('Texture pixel budget exceeded');
    if (
      (t.uv_width !== undefined && t.uv_width !== image.width) ||
      (t.uv_height !== undefined && t.uv_height !== image.height)
    )
      throw new Error('Unsupported scaled texture UV dimensions');
    const id = t.formixel_id ?? t.uuid ?? `texture_${i}`;
    textureIds.set(String(i), id);
    if (t.uuid) textureIds.set(t.uuid, id);
    m.textures!.push({
      id,
      name: t.name ?? id,
      width: image.width,
      height: image.height,
      pixels: Array.from(image.pixels),
    });
  }
  const map = new Map<string, string>();
  for (const e of b.elements) {
    if (
      !e ||
      (e.type && e.type !== 'cube') ||
      e.inflate ||
      (e.box_uv ?? b.meta.box_uv) ||
      e.rescale ||
      e.visibility === false ||
      e.export === false ||
      e.shade === false ||
      (e.stretch &&
        (!Array.isArray(e.stretch) ||
          e.stretch.length !== 3 ||
          e.stretch.some((n: unknown) => n !== 1)))
    )
      throw new Error('Unsupported cube/mesh properties');
    if (typeof e.uuid !== 'string' || map.has(e.uuid))
      throw new Error('Missing or duplicate element UUID');
    const faces: Partial<Record<(typeof FACE_NAMES)[number], Face>> = {};
    if (e.faces) {
      if (
        typeof e.faces !== 'object' ||
        Array.isArray(e.faces) ||
        Object.keys(e.faces).some((k) => !FACE_NAMES.includes(k as any))
      )
        throw new Error('Invalid face map');
      for (const key of FACE_NAMES) {
        const f = e.faces[key];
        if (!f) continue;
        if (f.cullface || f.material_name || (f.tint !== undefined && f.tint !== -1))
          throw new Error('Unsupported game-specific face properties');
        const texture =
          f.texture === null || f.texture === false || f.texture === undefined
            ? undefined
            : textureIds.get(String(f.texture));
        if (f.texture !== null && f.texture !== false && f.texture !== undefined && !texture)
          throw new Error('Missing face texture');
        const uv = f.uv ?? [0, 0, 0, 0];
        const rotation = f.rotation ?? 0;
        if (
          texture ||
          f.texture === null ||
          f.enabled === false ||
          rotation ||
          uv.some((n: unknown) => n !== 0)
        )
          faces[key] = {
            uv,
            ...(texture ? { texture } : {}),
            ...(rotation ? { rotation } : {}),
            ...(f.texture === null || f.enabled === false ? { enabled: false } : {}),
          };
      }
    }
    const id = e.formixel_id ?? e.uuid;
    map.set(e.uuid, id);
    m.cubes.push({
      id,
      name: e.name,
      from: e.from,
      to: e.to,
      origin: e.origin ?? [0, 0, 0],
      rotation: e.rotation ?? [0, 0, 0],
      color: e.color ?? 0,
      ...(e.formixel_material ? { material: e.formixel_material } : {}),
      ...(Object.keys(faces).length ? { faces } : {}),
    });
  }
  const assigned = new Set<string>();
  const groupUuids = new Set<string>();
  const groupTemplates = new Map<string, Record<string, any>>();
  const groupIds = new Map<string, string>();
  if (b.groups !== undefined) {
    if (!Array.isArray(b.groups) || b.groups.length > 1000) throw new Error('Invalid group table');
    for (const g of b.groups) {
      if (!g || typeof g.uuid !== 'string' || groupTemplates.has(g.uuid) || map.has(g.uuid))
        throw new Error('Invalid group table UUID');
      groupTemplates.set(g.uuid, g);
    }
  }
  const visit = (nodes: unknown[], parent: string | undefined, depth: number) => {
    if (depth > 32) throw new Error('Outliner depth exceeded');
    for (const node of nodes) {
      if (typeof node === 'string') {
        const id = map.get(node);
        if (!id || assigned.has(node)) throw new Error('Unknown or duplicate outliner element');
        assigned.add(node);
        const cube = m.cubes.find((c) => c.id === id)!;
        if (parent) cube.parent = parent;
      } else {
        const outline = node as Record<string, any>;
        const g = outline ? { ...groupTemplates.get(outline.uuid), ...outline } : outline;
        if (
          !g ||
          typeof g.uuid !== 'string' ||
          !Array.isArray(g.children) ||
          groupUuids.has(g.uuid) ||
          map.has(g.uuid)
        )
          throw new Error('Invalid outliner group');
        if (g.visibility === false || g.export === false)
          throw new Error('Unsupported hidden/nonexported group');
        groupUuids.add(g.uuid);
        if (m.groups.length >= 1000) throw new Error('Group budget exceeded');
        const id = g.formixel_id ?? g.uuid;
        groupIds.set(g.uuid, id);
        m.groups.push({
          id,
          name: g.name,
          origin: g.origin ?? [0, 0, 0],
          rotation: g.rotation ?? [0, 0, 0],
          ...(parent ? { parent } : {}),
        });
        visit(g.children, id, depth + 1);
      }
    }
  };
  visit(b.outliner, undefined, 0);
  if (assigned.size !== m.cubes.length) throw new Error('Elements missing from outliner');
  if ([...groupTemplates.keys()].some((id) => !groupUuids.has(id)))
    throw new Error('Groups missing from outliner');
  if (b.animations !== undefined && (!Array.isArray(b.animations) || b.animations.length > 128))
    throw new Error('Invalid animation array');
  for (const [i, a] of (b.animations ?? []).entries()) {
    if (
      !a ||
      !['loop', 'once', undefined].includes(a.loop) ||
      a.anim_time_update ||
      a.blend_weight ||
      a.start_delay ||
      a.loop_delay ||
      a.override
    )
      throw new Error('Unsupported animation loop or expression');
    const tracks: Track[] = [];
    for (const [bone, value] of Object.entries(a.animators ?? {})) {
      const animator = value as Record<string, any>;
      const group = groupIds.get(bone);
      if (!group || animator.type !== 'bone' || !Array.isArray(animator.keyframes))
        throw new Error('Unsupported animator');
      for (const channel of ['rotation', 'position', 'scale'] as const) {
        const keyframes = animator.keyframes
          .filter((k: any) => k.channel === channel)
          .map((k: any) => {
            if (
              !['linear', 'step', undefined].includes(k.interpolation) ||
              !Array.isArray(k.data_points) ||
              k.data_points.length !== 1
            )
              throw new Error('Unsupported keyframe interpolation');
            const point = k.data_points[0];
            const numbers = [point?.x, point?.y, point?.z].map(Number);
            if (
              [point?.x, point?.y, point?.z].some(
                (v) =>
                  !(
                    typeof v === 'number' ||
                    (typeof v === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v))
                  ),
              ) ||
              numbers.some((n) => !Number.isFinite(n))
            )
              throw new Error('Animation expressions are unsupported');
            if (b.meta.format_version === '4.10') {
              if (channel === 'position') numbers[0] = -numbers[0]!;
              if (channel === 'rotation') {
                numbers[0] = -numbers[0]!;
                numbers[1] = -numbers[1]!;
              }
            }
            return {
              time: k.time,
              value: numbers as Vec3,
              interpolation: k.interpolation ?? 'linear',
            };
          })
          .sort((x: any, y: any) => x.time - y.time);
        if (keyframes.length) tracks.push({ group, channel, keyframes });
      }
      if (
        animator.keyframes.some((k: any) => !['rotation', 'position', 'scale'].includes(k.channel))
      )
        throw new Error('Unsupported animation channel');
    }
    const animation: Animation = {
      id: a.formixel_id ?? a.uuid ?? `animation_${i}`,
      name: a.name,
      length: a.length,
      loop: a.loop === 'loop',
      tracks,
    };
    m.animations!.push(animation);
  }
  assertModel(m);
  return canonical(m);
}

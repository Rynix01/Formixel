import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { assertModel, FACE_NAMES, serialize, type Model } from './model.js';
import { exportBBModel, importBBModel } from './bbmodel.js';
import { reviewModel, type RigConstraint } from './design.js';
import { geometry } from './geometry.js';
import {
  parseProductionBrief,
  parseAnatomyRoles,
  assertAnatomyReferences,
  type ProductionBrief,
  type AnatomyRoles,
} from './policy.js';

export interface ModelContextOptions {
  brief: ProductionBrief;
  roles?: unknown;
  constraints?: unknown;
}

/** Portable policy data bound to exact canonical geometry, pixels and motion. */
export interface ModelContext {
  version: 1;
  modelDigest: string;
  brief: ProductionBrief;
  roles?: AnatomyRoles;
  constraints?: RigConstraint[];
}

const digest = (model: Model) => bytesToHex(sha256(new TextEncoder().encode(serialize(model))));

/** Validate metadata before reusing its policy; stale context is always an error. */
export function validateModelContext(model: Model, value: unknown): ModelContext {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Model context must be an object');
  const context = value as Record<string, unknown>;
  if (
    Object.keys(context).some(
      (key) => !['version', 'modelDigest', 'brief', 'roles', 'constraints'].includes(key),
    )
  )
    throw new Error('Unknown model context field');
  if (
    context.version !== 1 ||
    typeof context.modelDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(context.modelDigest)
  )
    throw new Error('Invalid model context version or digest');
  if (context.modelDigest !== digest(model))
    throw new Error('Stale model context: model digest does not match');
  const brief = parseProductionBrief(context.brief);
  const roles = context.roles === undefined ? undefined : parseAnatomyRoles(context.roles);
  if (roles !== undefined) assertAnatomyReferences(model, roles);
  // Failing physical checks are valid repair input; malformed declarations and references are not.
  if (context.constraints !== undefined) reviewModel(model, context.constraints);
  return {
    version: 1,
    modelDigest: context.modelDigest,
    brief,
    ...(roles !== undefined ? { roles } : {}),
    ...(context.constraints !== undefined
      ? { constraints: structuredClone(context.constraints) as RigConstraint[] }
      : {}),
  };
}

/** JSON-serializable as a .context.json sidecar when an editor strips custom fields. */
export function createModelContext(model: Model, options: ModelContextOptions): ModelContext {
  return validateModelContext(model, {
    version: 1,
    modelDigest: digest(model),
    brief: options.brief,
    ...(options.roles !== undefined ? { roles: options.roles } : {}),
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
  });
}

/** Bind to the actual native roundtrip, including baked materials and preserved semantic IDs. */
export function exportBBModelWithContext(model: Model, context?: unknown): Record<string, unknown> {
  const validated = context === undefined ? undefined : validateModelContext(model, context);
  const native = exportBBModel(model);
  if (validated !== undefined)
    native.formixel_context = createModelContext(importBBModel(native), validated);
  return native;
}

/** Rebind only a verified editor serialization, using the host's trusted native UUID mapping. */
export function rebindModelContext(
  context: unknown,
  sourceModel: Model,
  destinationModel: Model,
  idMap: Record<string, string>,
): ModelContext {
  const original = validateModelContext(sourceModel, context);
  assertModel(destinationModel);
  const stale = (): never => {
    throw new Error('Stale model context: editor representation changed');
  };
  if (!idMap || typeof idMap !== 'object' || Array.isArray(idMap)) stale();
  const mapped = (id: string) => {
    const value = Object.hasOwn(idMap, id) ? idMap[id] : id;
    if (typeof value !== 'string') stale();
    return value!;
  };
  const near = (a: number, b: number) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.001) stale();
  };
  const vector = (a: number[], b: number[]) => {
    if (a.length !== b.length) stale();
    a.forEach((value, index) => near(value, b[index]!));
  };
  const same = (a: unknown, b: unknown) => {
    if (a !== b) stale();
  };
  same(sourceModel.format, destinationModel.format);
  vector(sourceModel.resolution, destinationModel.resolution);

  const textureKey = (texture: NonNullable<Model['textures']>[number]) =>
    `${texture.width}:${texture.height}:${bytesToHex(sha256(Uint8Array.from(texture.pixels)))}`;
  const textures = new Map<string, string>(),
    usedTextures = new Set<string>();
  same(sourceModel.textures?.length ?? 0, destinationModel.textures?.length ?? 0);
  for (const texture of sourceModel.textures ?? []) {
    const candidates = (destinationModel.textures ?? []).filter(
      (candidate) =>
        !usedTextures.has(candidate.id) && textureKey(candidate) === textureKey(texture),
    );
    const explicit = candidates.find((candidate) => candidate.id === mapped(texture.id));
    const candidate = explicit ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!candidate) stale();
    textures.set(texture.id, candidate!.id);
    usedTextures.add(candidate!.id);
  }
  for (const kind of ['groups', 'cubes'] as const) {
    same(sourceModel[kind].length, destinationModel[kind].length);
    const destinations = new Map(destinationModel[kind].map((node) => [node.id, node]));
    const used = new Set<string>();
    for (const node of sourceModel[kind]) {
      const id = mapped(node.id),
        target = destinations.get(id);
      if (!target || used.has(id)) stale();
      used.add(id);
      same(node.parent === undefined ? undefined : mapped(node.parent), target!.parent);
      same(node.name, target!.name);
      vector(node.origin, target!.origin);
      vector(node.rotation, target!.rotation);
    }
  }
  const cubes = new Map(destinationModel.cubes.map((cube) => [cube.id, cube]));
  for (const cube of sourceModel.cubes) {
    const target = cubes.get(mapped(cube.id))!;
    vector(cube.from, target.from);
    vector(cube.to, target.to);
    same(cube.color, target.color);
    for (const face of FACE_NAMES) {
      const a = cube.faces?.[face],
        b = target.faces?.[face];
      vector(a?.uv ?? [0, 0, 0, 0], b?.uv ?? [0, 0, 0, 0]);
      same(a?.rotation ?? 0, b?.rotation ?? 0);
      same(a?.enabled ?? true, b?.enabled ?? true);
      same(a?.texture === undefined ? undefined : textures.get(a.texture), b?.texture);
    }
  }
  // Local rounding must also remain within tolerance after the complete parent hierarchy.
  const destinationGeometry = new Map(geometry(destinationModel).map((cube) => [cube.id, cube]));
  for (const cube of geometry(sourceModel)) {
    const target = destinationGeometry.get(mapped(cube.id))!;
    cube.vertices.forEach((point, index) => {
      if (Math.hypot(...point.map((n, axis) => n - target.vertices[index]![axis]!)) > 0.001)
        stale();
    });
  }
  same(sourceModel.animations?.length ?? 0, destinationModel.animations?.length ?? 0);
  const animations = new Map((destinationModel.animations ?? []).map((clip) => [clip.id, clip]));
  const usedAnimations = new Set<string>();
  for (const clip of sourceModel.animations ?? []) {
    const id = mapped(clip.id),
      target = animations.get(id);
    if (!target || usedAnimations.has(id)) stale();
    usedAnimations.add(id);
    same(clip.name, target!.name);
    same(clip.loop, target!.loop);
    near(clip.length, target!.length);
    same(clip.tracks.length, target!.tracks.length);
    for (const track of clip.tracks) {
      const destinationTrack = target!.tracks.find(
        (t) => t.group === mapped(track.group) && t.channel === track.channel,
      );
      if (!destinationTrack) stale();
      same(track.keyframes.length, destinationTrack!.keyframes.length);
      track.keyframes.forEach((key, index) => {
        const destinationKey = destinationTrack!.keyframes[index]!;
        near(key.time, destinationKey.time);
        vector(key.value, destinationKey.value);
        same(key.interpolation, destinationKey.interpolation);
      });
    }
  }

  const roles = original.roles;
  if (roles) {
    if (roles.body !== undefined) roles.body = mapped(roles.body);
    if (roles.head !== undefined) roles.head = mapped(roles.head);
    for (const limb of roles.limbs ?? []) {
      limb.upper = mapped(limb.upper);
      limb.lower = mapped(limb.lower);
      limb.end = mapped(limb.end);
      if (limb.sole) limb.sole.cube = mapped(limb.sole.cube);
    }
    if (roles.weapon) {
      roles.weapon.hand.group = mapped(roles.weapon.hand.group);
      roles.weapon.shaft.group = mapped(roles.weapon.shaft.group);
      roles.weapon.cubes = roles.weapon.cubes.map(mapped);
      if (roles.weapon.secondary) {
        roles.weapon.secondary.hand.group = mapped(roles.weapon.secondary.hand.group);
        roles.weapon.secondary.shaft.group = mapped(roles.weapon.secondary.shaft.group);
      }
    }
  }
  for (const constraint of original.constraints ?? []) {
    if (constraint.animations) constraint.animations = constraint.animations.map(mapped);
    if (constraint.type === 'ground') constraint.cubes = constraint.cubes.map(mapped);
    else if (constraint.type === 'contact')
      constraint.marker.group = mapped(constraint.marker.group);
    else if (constraint.type === 'attachment' || constraint.type === 'level') {
      constraint.a.group = mapped(constraint.a.group);
      constraint.b.group = mapped(constraint.b.group);
    } else {
      constraint.root.group = mapped(constraint.root.group);
      constraint.joint.group = mapped(constraint.joint.group);
      constraint.end.group = mapped(constraint.end.group);
    }
  }
  if (original.brief.airborneAnimations)
    original.brief.airborneAnimations = original.brief.airborneAnimations.map(mapped);
  return createModelContext(destinationModel, original);
}

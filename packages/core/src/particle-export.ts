import type { Model, Vec3 } from './model.js';
import { encodePNG } from './png.js';
import { parseParticleDocument } from './particles.js';

export interface ParticleExportOptions {
  target: 'bedrock';
  namespace: string;
  entity: string;
}
export interface ParticleExportManifest {
  version: 1;
  target: 'bedrock';
  kind: 'integration-fragments';
  modelDigest: string;
  entity: string;
  installablePack: false;
  runtimeVerified: false;
  modelUnitsPerBlock: 16;
  geometryIdentifier: string;
  paths: {
    texture: string;
    animation: string;
    geometryFragment: string;
    clientEntityFragment: string;
    limitations: string;
  };
  effects: {
    sourceEvent: string;
    sourceRecipe: string;
    identifier: string;
    alias: string;
    path: string;
    burst: number;
  }[];
  bones: { sourceGroup: string; name: string; parent?: string }[];
  locators: { sourceEvent: string; sourceGroup: string; bone: string; name: string; point: Vec3 }[];
  animations: {
    sourceAnimation: string;
    identifier: string;
    alias: string;
    loop: boolean;
    length: number;
  }[];
  files: string[];
  limitations: string[];
  requiredIntegration: string[];
  sources: string[];
}
export interface ParticleAssetBundle {
  assets: Record<string, Uint8Array>;
  manifest: ParticleExportManifest;
}

const SOURCES = [
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particleentityintegration?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlesintroduction?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftemitter_rate_instant?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftemitter_lifetime_once?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftparticle_lifetime_expression?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftparticle_appearance_billboard?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftparticle_appearance_tinting?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftemitter_local_space?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/actor_animation.v1.8.0?view=minecraft-bedrock-stable',
  'https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.12.0?view=minecraft-bedrock-stable',
];
const fail = (message: string): never => {
  throw new Error(`Bedrock particle export: ${message}`);
};
const ordered = <T extends { id: string }>(values: T[]): T[] =>
  [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const code = (prefix: string, i: number): string => `${prefix}${String(i).padStart(3, '0')}`;
function safeId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(value) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value)
  )
    return fail(`${field} must be a safe lowercase identifier of at most 32 characters`);
  return value;
}
function options(value: ParticleExportOptions): ParticleExportOptions {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ['target', 'namespace', 'entity'].some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (k) => typeof k !== 'string' || !['target', 'namespace', 'entity'].includes(k),
    )
  )
    return fail('Unknown or invalid export options');
  if (value.target !== 'bedrock') return fail('Only the explicit bedrock target is supported');
  const namespace = safeId(value.namespace, 'namespace'),
    entity = safeId(value.entity, 'entity');
  if (namespace === 'minecraft') return fail('The minecraft namespace is reserved');
  return { target: 'bedrock', namespace, entity };
}
function direction(vector: Vec3): Vec3 {
  const max = Math.max(...vector.map(Math.abs)),
    scaled = vector.map((n) => n / max),
    length = Math.hypot(...scaled);
  return scaled.map((n) => n / length) as Vec3;
}
function rgba(hex: string): number[] {
  return [1, 3, 5, 7].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
/** Decimal timeline keys, including very small positive times, without expression syntax. */
function timestamp(time: number): string {
  const value = String(time);
  if (!value.includes('e')) return value;
  const [mantissa, exponent] = value.split('e'),
    [whole, fraction = ''] = mantissa!.split('.');
  const digits = whole! + fraction,
    point = whole!.length + Number(exponent);
  return point <= 0
    ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length
      ? digits + '0'.repeat(point - digits.length)
      : digits.slice(0, point) + '.' + digits.slice(point);
}

/** Export a deliberately narrow, data-only Bedrock integration bundle; never a complete game pack. */
export function exportParticleAssets(
  model: Model,
  document: unknown,
  exportOptions: ParticleExportOptions,
): ParticleAssetBundle {
  const target = options(exportOptions),
    doc = parseParticleDocument(model, document);
  if (!doc.events.length) return fail('At least one particle event is required');
  const recipes = new Map(doc.recipes.map((recipe) => [recipe.id, recipe]));
  const groups = new Map(model.groups.map((group) => [group.id, group]));
  const clips = new Map(model.animations!.map((clip) => [clip.id, clip]));
  // Validate the complete supported subset before creating an output asset or a PNG.
  for (const recipe of doc.recipes) {
    if (recipe.render !== 'sprite')
      return fail(`${recipe.id}: voxel rendering is unsupported; select sprite explicitly`);
    if (recipe.spread !== 0)
      return fail(`${recipe.id}: nonzero cone spread cannot preserve seeded samples in Bedrock`);
    if (recipe.speed[0] !== recipe.speed[1] || recipe.lifetime[0] !== recipe.lifetime[1])
      return fail(
        `${recipe.id}: randomized speed or lifetime cannot preserve the source seeded sequence`,
      );
    if (recipe.drag !== 0 || recipe.acceleration.some((n) => n !== 0))
      return fail(`${recipe.id}: drag and acceleration are outside the strict export subset`);
    if (
      recipe.size.some((node) => node[1] !== recipe.size[0]![1]) ||
      recipe.color.some((node) => node[1] !== recipe.color[0]![1])
    )
      return fail(
        `${recipe.id}: changing size or color curves are outside the strict export subset`,
      );
    if (
      (recipe.speed[0] > 0 && recipe.speed[0] / 16 === 0) ||
      (recipe.size[0]![1] > 0 && recipe.size[0]![1] / 16 === 0)
    )
      return fail(`${recipe.id}: model-to-block conversion underflows a positive speed or size`);
  }
  const usedGroups = new Set<string>(),
    usedClips = new Set<string>();
  for (const event of doc.events) {
    const clip = clips.get(event.animation)!;
    if (event.space !== 'world')
      return fail(`${event.id}: local-space particle semantics are unsupported`);
    if (event.rate !== 0 || event.duration !== 0 || event.burst <= 0)
      return fail(`${event.id}: only instantaneous positive bursts are supported`);
    if (event.time >= clip.length)
      return fail(
        `${event.id}: events exactly at clip end require explicit host timing and are unsupported`,
      );
    usedClips.add(clip.id);
    const ancestors = new Set<string>();
    let parent: string | undefined = event.attachment.group;
    while (parent) {
      ancestors.add(parent);
      usedGroups.add(parent);
      parent = groups.get(parent)!.parent;
    }
    for (const track of clip.tracks)
      if (
        ancestors.has(track.group) &&
        track.channel === 'scale' &&
        track.keyframes.some((key) => key.value.some((n) => n !== 1))
      )
        return fail(
          `${event.id}: nonidentity inherited animated scale cannot be mapped faithfully`,
        );
  }
  const { namespace, entity } = target,
    prefix = `integration/${namespace}/${entity}`;
  const paths = {
    texture: `textures/particle/${namespace}/${entity}/pixel.png`,
    animation: `animations/${namespace}/${entity}.particles.animation.json`,
    geometryFragment: `${prefix}/geometry-locators.fragment.json`,
    clientEntityFragment: `${prefix}/client-entity.fragment.json`,
    limitations: `${prefix}/limitations.json`,
  };
  const sortedGroups = ordered(model.groups.filter((group) => usedGroups.has(group.id)));
  const boneNames = new Map(
    sortedGroups.map((group, i) => [group.id, `fx_${entity}_${code('b', i)}`]),
  );
  const bones: ParticleExportManifest['bones'] = sortedGroups.map((group) => ({
    sourceGroup: group.id,
    name: boneNames.get(group.id)!,
    ...(group.parent ? { parent: boneNames.get(group.parent)! } : {}),
  }));
  const animations = ordered(model.animations!.filter((clip) => usedClips.has(clip.id))).map(
    (clip, i) => ({
      sourceAnimation: clip.id,
      identifier: `animation.${namespace}.${entity}.particles.${code('a', i)}`,
      alias: `fx_${entity}_${code('a', i)}`,
      loop: clip.loop,
      length: clip.length,
    }),
  );
  const animationBindings = new Map(
    animations.map((binding) => [binding.sourceAnimation, binding]),
  );
  const events = ordered(doc.events);
  const effects = events.map((event, i) => ({
    sourceEvent: event.id,
    sourceRecipe: event.recipe,
    identifier: `${namespace}:${entity}_${code('e', i)}`,
    alias: `fx_${entity}_${code('e', i)}`,
    path: `particles/${namespace}/${entity}/${code('e', i)}.particle.json`,
    burst: event.burst,
  }));
  const locators = events.map((event, i) => ({
    sourceEvent: event.id,
    sourceGroup: event.attachment.group,
    bone: boneNames.get(event.attachment.group)!,
    name: `fx_${entity}_${code('l', i)}`,
    point: [...event.attachment.point] as Vec3,
  }));
  const assets: Record<string, Uint8Array> = Object.create(null);
  const writeJSON = (path: string, value: unknown) => {
    assets[path] = new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
  };
  for (const [i, event] of events.entries()) {
    const recipe = recipes.get(event.recipe)!,
      effect = effects[i]!;
    writeJSON(effect.path, {
      format_version: '1.10.0',
      particle_effect: {
        description: {
          identifier: effect.identifier,
          basic_render_parameters: {
            material: recipe.blend === 'additive' ? 'particles_add' : 'particles_blend',
            texture: paths.texture.slice(0, -4),
          },
        },
        components: {
          'minecraft:emitter_local_space': { position: false, rotation: false, velocity: false },
          'minecraft:emitter_rate_instant': { num_particles: event.burst },
          'minecraft:emitter_lifetime_once': { active_time: recipe.lifetime[0] },
          'minecraft:emitter_shape_point': {
            offset: [0, 0, 0],
            direction: direction(recipe.direction),
          },
          'minecraft:particle_initial_speed': recipe.speed[0] / 16,
          'minecraft:particle_lifetime_expression': { max_lifetime: recipe.lifetime[0] },
          'minecraft:particle_motion_dynamic': {
            linear_acceleration: [0, 0, 0],
            linear_drag_coefficient: 0,
          },
          'minecraft:particle_appearance_billboard': {
            size: [recipe.size[0]![1] / 16, recipe.size[0]![1] / 16],
            facing_camera_mode: 'lookat_xyz',
            uv: { texture_width: 1, texture_height: 1, uv: [0, 0], uv_size: [1, 1] },
          },
          'minecraft:particle_appearance_tinting': { color: rgba(recipe.color[0]![1]) },
        },
      },
    });
  }
  assets[paths.texture] = encodePNG({
    width: 1,
    height: 1,
    pixels: Uint8Array.of(255, 255, 255, 255),
  });
  const animationJSON: Record<
    string,
    { loop: boolean; animation_length: number; particle_effects: Record<string, unknown[]> }
  > = {};
  for (const binding of animations)
    animationJSON[binding.identifier] = {
      loop: binding.loop,
      animation_length: binding.length,
      particle_effects: {},
    };
  for (const [i, event] of events.entries()) {
    const timeline =
      animationJSON[animationBindings.get(event.animation)!.identifier]!.particle_effects;
    (timeline[timestamp(event.time)] ??= []).push({
      effect: effects[i]!.alias,
      locator: locators[i]!.name,
      bind_to_actor: false,
    });
  }
  writeJSON(paths.animation, { format_version: '1.8.0', animations: animationJSON });
  const geometryIdentifier = `geometry.${namespace}.${entity}.particle_locators`;
  writeJSON(paths.geometryFragment, {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: geometryIdentifier,
          texture_width: model.resolution[0],
          texture_height: model.resolution[1],
        },
        bones: sortedGroups.map((group) => ({
          name: boneNames.get(group.id)!,
          ...(group.parent ? { parent: boneNames.get(group.parent)! } : {}),
          pivot: [...group.origin],
          rotation: [...group.rotation],
          locators: Object.fromEntries(
            locators
              .filter((locator) => locator.sourceGroup === group.id)
              .map((locator) => [
                locator.name,
                { offset: locator.point, rotation: [0, 0, 0], ignore_inherited_scale: false },
              ]),
          ),
        })),
      },
    ],
  });
  writeJSON(paths.clientEntityFragment, {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${namespace}:${entity}`,
        particle_effects: Object.fromEntries(
          effects.map((effect) => [effect.alias, effect.identifier]),
        ),
        animations: Object.fromEntries(
          animations.map((animation) => [animation.alias, animation.identifier]),
        ),
      },
    },
  });
  const manifest: ParticleExportManifest = {
    version: 1,
    target: 'bedrock',
    kind: 'integration-fragments',
    modelDigest: doc.modelDigest,
    entity: `${namespace}:${entity}`,
    installablePack: false,
    runtimeVerified: false,
    modelUnitsPerBlock: 16,
    geometryIdentifier,
    paths,
    effects,
    bones,
    locators,
    animations,
    files: [...Object.keys(assets), paths.limitations].sort(),
    limitations: [
      'Only world-space sprite bursts with fixed speed/lifetime, zero spread/forces/drag, constant size/color and identity inherited scale are exported.',
      'Source RNG seeds have no effect in this subset; no Bedrock random sequence or arbitrary Molang is emitted.',
      'The pixel is a camera-facing square. Billboard rasterization/blending and frame timing belong to Bedrock and have not been verified in a running game.',
      'Particle motion/size convert model units to blocks at 16:1; geometry locator points remain in model units.',
      'Entity-wide runtime scaling, blended/re-timed animation states, entity deletion and game particle limits may differ from stateless core sampling.',
      'The locator geometry fragment contains bones/markers only. It is not a replacement rendered model, and no particle-shaped geometry is generated.',
    ],
    requiredIntegration: [
      'Supply the resource/behavior pack manifests and an existing working entity, geometry, textures, materials and render controllers.',
      'Map generated bone aliases to the source groups in the rendered entity geometry; merge locators into those bones without replacing the entity model.',
      'Merge particle_effects and animations aliases into the existing client_entity description.',
      'Merge each generated particle timeline into its corresponding base animation, or explicitly start/stop an overlay synchronized with that source animation and its loop.',
      'Retain the source pivots, hierarchy, axes, units and matching motion in the target geometry/animations; the exporter does not convert the model or its motion.',
      'Load the merged assets and validate content logs, event timing, locator orientation and particle appearance in Bedrock before distribution.',
    ],
    sources: [...SOURCES],
  };
  writeJSON(paths.limitations, manifest);
  return { assets, manifest };
}

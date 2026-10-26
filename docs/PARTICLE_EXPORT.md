# Bedrock particle asset export

The particle exporter produces deterministic Bedrock resource assets for a strict subset of [particle sidecars](PARTICLES.md). It returns file bytes and an integration manifest. It does not create an installable pack, convert the model or its bone animation, install files, or establish that the result has run in Minecraft.

## Core API

After `npm run build`, run this from the repository root with an existing validated `model` and particle `document`:

```js
import { exportParticleAssets } from './packages/core/dist/particle-export.js';

const { assets, manifest } = exportParticleAssets(model, document, {
  target: 'bedrock',
  namespace: 'demo',
  entity: 'creature',
});
```

The function accepts a sidecar object or JSON string and returns `{ assets: Record<string, Uint8Array>, manifest: ParticleExportManifest }`. It throws a descriptive error for invalid options, stale model digests or unsupported content. Options are exactly `target`, `namespace` and `entity`; `target: "bedrock"` is required explicitly. The function performs no filesystem or network operations. A host chooses where to persist the returned bytes and performs the integration below.

## Accepted subset

The complete sidecar must pass normal model/digest/reference validation. The exporter then checks every recipe, including unused recipes, and rejects unsupported data rather than dropping it.

| Recipe field       | Accepted value             |
| ------------------ | -------------------------- |
| `render`           | `sprite`                   |
| `shape` / `spread` | `cone` / `0`               |
| `speed`            | Fixed `[value, value]`     |
| `lifetime`         | Fixed `[value, value]`     |
| `size`             | All curve values identical |
| `color`            | All curve colors identical |
| `acceleration`     | `[0, 0, 0]`                |
| `drag`             | `0`                        |
| `blend`            | `alpha` or `additive`      |

Positive speed or size values that underflow to zero during model-to-block conversion are rejected.

At least one event is required. Events must use `space: "world"`, `rate: 0`, `duration: 0` and a positive `burst`. Event time must be before the clip end, including for a nonlooping clip. Every scale key on the attached group and its ancestors in that event's clip must be exactly `[1, 1, 1]`. An absent scale track is the identity. Local attachment, ongoing emitters, spread, random speed/lifetime ranges, changing curves, acceleration, drag and inherited animated scale fail explicitly. Seeds have no effect in this fixed-value subset; the exporter does not reproduce a Bedrock random sequence or emit random expressions.

Namespace and entity options use lowercase ASCII identifiers matching `[a-z][a-z0-9_]{0,31}`. DOS reserved names are rejected, and `minecraft` cannot be used as a custom namespace. Source event, recipe, group and animation IDs are mapped to generated safe names; source IDs never become output path segments.

## Returned assets

The result is `{ assets, manifest }`, where `assets` maps resource-relative paths to `Uint8Array` bytes. Each event gets a complete particle effect file with its own baked burst count. A single white 1×1 RGBA PNG supplies the sprite texture. The animation asset contains particle events only; it has no exported bone motion.

| Asset                                                                             | Role                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| `particles/<namespace>/<entity>/e000.particle.json`, and subsequent event indices | Complete event-specific effects                 |
| `textures/particle/<namespace>/<entity>/pixel.png`                                | Shared white sprite texture                     |
| `animations/<namespace>/<entity>.particles.animation.json`                        | Event-only animation overlay                    |
| `integration/<namespace>/<entity>/geometry-locators.fragment.json`                | Bone/locator merge instructions; no cubes       |
| `integration/<namespace>/<entity>/client-entity.fragment.json`                    | Particle and overlay animation aliases to merge |
| `integration/<namespace>/<entity>/limitations.json`                               | Supported scope and required manual integration |

The manifest records source event/recipe/group/animation mappings, generated identifiers, aliases and paths in `effects`, `bones`, `locators` and `animations`. It also contains `modelDigest`, `geometryIdentifier`, `paths`, `files`, `limitations`, `requiredIntegration` and official `sources`. The same full manifest is serialized into `limitations.json`.

For the example options above, effect identifiers are `demo:creature_e000`, aliases are `fx_creature_e000`, bones are `fx_creature_b000`, and locators are `fx_creature_l000`, with subsequent indices assigned by sorted source IDs. The manifest's `kind` is `integration-fragments`, and it reports `runtimeVerified: false`, `installablePack: false` and `modelUnitsPerBlock: 16`. Use the recorded mappings rather than reconstructing generated names from source IDs.

Paths are relative to a resource pack root. Bedrock loads particle JSON from `particles`, animation JSON from `animations`, and client entities from `entity`; the singular `entity` folder is distinct from behavior-pack `entities`. The `integration` files are merge fragments, outside those automatic asset directories. A real pack still requires its own `manifest.json`. [Microsoft pack contents](https://learn.microsoft.com/en-us/minecraft/creator/documents/comprehensivepackcontents?view=minecraft-bedrock-stable)

## Units and rendering

The adapter fixes 16 model units to one block. It divides speed and scalar size by 16; locator points retain their model coordinates. Bedrock particle values use blocks and seconds, while geometry locators are points in model space. Preserve the same coordinate system when merging the locator fragment into the host model. [Particle units](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlesintroduction?view=minecraft-bedrock-stable), [geometry locators](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.12.0?view=minecraft-bedrock-stable)

`alpha` uses `particles_blend`, and `additive` uses `particles_add`. The exporter uses normalized RGBA arrays for tinting: Bedrock's eight-digit color strings use ARGB ordering, whereas sidecars use RGBA. The generated values contain no Molang expressions. A sprite is a camera-facing billboard, and its game appearance requires visual verification. [Particle materials](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlesintroduction?view=minecraft-bedrock-stable), [tint color formats](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftparticle_appearance_tinting?view=minecraft-bedrock-stable)

## Manual entity integration

An effect's identity is `particle_effect.description.identifier`, independently of its JSON filename. In the client entity, `minecraft:client_entity.description.particle_effects` maps a short alias to that identifier. An animation event's `effect` references the alias. Registering an alias alone does not start the effect. [Microsoft entity particle integration](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particleentityintegration?view=minecraft-bedrock-stable)

The following fragments illustrate those relationships; use the actual names and paths returned by the exporter. They are not a complete entity definition or resource pack.

Particle file description:

```json
{
  "identifier": "demo:creature_e000",
  "basic_render_parameters": {
    "material": "particles_blend",
    "texture": "textures/particle/demo/creature/pixel"
  }
}
```

Merge aliases into the host client entity's existing `description`:

```json
{
  "particle_effects": { "fx_creature_e000": "demo:creature_e000" },
  "animations": { "fx_creature_a000": "animation.demo.creature.particles.a000" }
}
```

Merge each generated locator into its matching host geometry bone. Locators live under `minecraft:geometry[].bones[].locators`; they follow the named bone, including its animation. The generated bone names require mapping to the host's real names. A locator point is not added to the bone pivot as a second offset. [Microsoft geometry reference](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.12.0?view=minecraft-bedrock-stable)

```json
{
  "name": "fx_creature_b000",
  "locators": {
    "fx_creature_l000": {
      "offset": [0, 8, -3],
      "rotation": [0, 0, 0]
    }
  }
}
```

The overlay triggers effects at numeric timestamps expressed as JSON object keys. For example:

```json
{
  "format_version": "1.8.0",
  "animations": {
    "animation.demo.creature.particles.a000": {
      "animation_length": 2,
      "loop": false,
      "particle_effects": {
        "0.25": [
          { "effect": "fx_creature_e000", "locator": "fx_creature_l000", "bind_to_actor": false }
        ]
      }
    }
  }
}
```

`bind_to_actor: false` makes the burst independent of the actor after spawning. Explicit false `position`, `rotation` and `velocity` values in `minecraft:emitter_local_space` preserve world simulation without inheriting emitter movement velocity. This adapter supports bursts only, so every particle in an event starts at that event's locator frame. [Animation effect fields](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/actor_animation.v1.8.0?view=minecraft-bedrock-stable), [emitter local space](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftemitter_local_space?view=minecraft-bedrock-stable)

The host must play the overlay alongside the matching bone animation, with synchronized starts, looping and playback conditions. The client entity's `animations` table registers names; `scripts.animate` or an animation controller actually plays them. The exporter does not select a controller state or insert a game-specific trigger. [Microsoft entity animation integration](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontoaddentity?view=minecraft-bedrock-stable)

For a new custom entity, the host also needs the appropriate behavior-pack definition. `is_summonable` and `is_spawnable` belong to `minecraft:entity.description` in that definition, not the client particle alias table. They enable `/summon` and a spawn egg respectively; they do not replace the particle or animation registration. Existing entity integration does not create those definitions. [Microsoft custom entity guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontoaddentity?view=minecraft-bedrock-stable)

Entity-wide scaling, blended or retimed animation states, entity deletion, frame timing and game particle limits can differ from stateless core sampling. After merging, test in Bedrock with the intended resource pack, entity, bone animation and playback controller, including content logs, locator orientation and particle appearance. A successful export establishes validated deterministic asset generation, not game-runtime parity, automatic installation or a finished `.mcpack`.

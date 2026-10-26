# Declarative authoring and rig review

Formixel can refine model geometry with a reproducible, bounded authoring document. The provider describes the requested geometry as FXL and assigns part-specific surface recipes and physical rig checks as JSON. Local code paints the atlas, optionally solves limb motion, validates the resulting BBIR and measures the actual animated hierarchy. It does not execute a provider program, load an external script, or replace an unsuccessful design with a stock creature.

The existing FXL-only path remains useful for quick geometry drafts. A design document adds production controls without making the language executable. This is a technical and physical quality gate, not an automatic aesthetic score: silhouettes, proportion choices, material art direction and reference similarity still need rendered inspection.

## Document

The TypeScript API is exported from `@formixel/core`:

```ts
const document = parseDesignDocument(JSON.parse(text));
const { model, report } = authorDesign(document);
if (!report.passed) {
  // Show issues and revise the affected parts before writing the final artifact.
}
```

`parseDesignDocument` validates the complete data schema, including declarations that are not used. `authorDesign` additionally parses FXL and resolves every cube, group, recipe and animation reference. Both reject unknown properties. Inputs are cloned; authoring never mutates the supplied document. Structural errors, insufficient atlas capacity, unreachable IK and resource exhaustion throw. Measurable rig faults return `report.passed: false` with their affected clip, time and constraint.

```json
{
  "version": 1,
  "source": "model \"armored_block\"\ngroup body origin [0,2,0] { cube shell [-2,0,-1] [4,4,2] }\nanimation idle 1 loop { rotate body 0 [0,0,0] rotate body 1 [0,0,0] }",
  "authoring": {
    "atlas": {
      "size": [64, 64],
      "texelsPerUnit": 2,
      "recipes": [
        {
          "id": "obsidian",
          "kind": "scales",
          "base": "#26262e",
          "accent": "#555866",
          "detail": 1,
          "seed": 7
        },
        {
          "id": "gold",
          "kind": "metal",
          "base": "#b88030",
          "accent": "#ffe096",
          "detail": 1,
          "seed": 7
        }
      ],
      "parts": [{ "cubes": ["body/shell"], "recipe": "obsidian", "faces": { "up": "gold" } }]
    },
    "constraints": [
      { "id": "floor", "type": "ground", "cubes": ["body/shell"], "floor": 0, "tolerance": 0.01 },
      {
        "id": "sole",
        "type": "contact",
        "marker": { "group": "body", "point": [0, 0, 0] },
        "floor": 0,
        "lockXZ": [0, 0],
        "tolerance": 0.01
      }
    ]
  }
}
```

`authoring.atlas`, `constraints` and `motions` are independently optional for local authoring. A production workflow should require surfaces and applicable constraints explicitly. An empty constraint list means no physical claims were tested; it is not evidence that the model has correct feet, limbs or grips.

## Surface plan

| Field             | Meaning and bounds                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `size`            | Integer atlas width/height, each 4–1024; combined texture area at most 262,144 pixels.                                                     |
| `texelsPerUnit`   | Requested physical density, 0.125–16 pixels per model unit.                                                                                |
| `recipes`         | 1–128 unique recipes. Every recipe must actually paint an enabled face.                                                                    |
| `parts`           | Explicit nonoverlapping cube assignments. Cube identifiers include their group paths.                                                      |
| `requireCoverage` | Defaults to `true`: every cube with an enabled face needs an assignment. `false` permits preserving existing surfaces on unassigned cubes. |

A recipe has exactly `id`, `kind`, `base`, `accent`, `detail`, and optional `seed`. Colors are six-digit RGB hex values. Detail is 0–1; seed is an unsigned 32-bit integer. Kinds are `solid`, `scales`, `metal`, `bone`, `membrane`, and `cloth`. The patterns paint actual RGBA texels, including scale seams, metal edge highlights, bone striation, membrane veins, or cloth weave. `solid` is an exact flat base color. Detail zero disables variation on every recipe.

A part has `cubes`, `recipe`, optional `texelsPerUnit`, and optional `faces`. Face overrides accept only `north`, `east`, `south`, `west`, `up` and `down`, each naming a declared recipe. There is no fuzzy selection, wildcard execution, embedded expression, external image path or material name guessing. Unknown references and duplicate assignments are errors even when full coverage is disabled.

Each face receives a rectangle whose width/height are the ceiling of the corresponding physical dimensions times its selected density. Formixel will fail rather than silently reduce density to fit. It sorts allocations deterministically, shares regions only for identical recipe/orientation/dimensions, and extrudes one pixel of padding around each region. A shared region is deliberate reuse, not unintentional UV overlap. Old unreferenced source textures are removed; preserved textures still count toward the total pixel budget. Texture resolution and every generated UV are set explicitly.

## Physical rig constraints

`reviewModel(model, constraints)` can also review imported BBIR without repainting or baking motion. Every marker is `{ "group": "exact/id", "point": [x,y,z] }`. Points use **absolute rest coordinates**, matching BBIR pivots and cube coordinates; they are not vectors relative to the bone origin. Formixel applies each bone's scale, rest plus animated rotation, translation and ancestor chain before measuring.

Each constraint has a unique `id` and `type`, plus an optional scope:

- Omit `animations` to inspect rest and every animation.
- Set `animations: []` to inspect only rest.
- Set `animations: ["walk"]` to inspect only that clip.
- Add `range: [0.2,0.4]` to check a planted stance phase. Ranges require exactly one explicitly named clip and cannot exceed its duration.

| Type         | Additional fields                                        | Measurement                                                                                                                                                              |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ground`     | `cubes`, `floor`, `tolerance`                            | Maximum floor penetration over all eight corners of every selected transformed cuboid.                                                                                   |
| `contact`    | `marker`, `floor`, `tolerance`, optional `lockXZ: [x,z]` | Marker height error and optional horizontal displacement from a fixed world target.                                                                                      |
| `attachment` | `a`, `b`, `maxDistance`                                  | Distance between two independently transformed markers, useful for hand-to-weapon grips and joints.                                                                      |
| `level`      | `a`, `b`, `axis`, `maxDegrees`                           | Angle between world vector `a → b` and the declared nonzero world axis, useful for sole normals and forward directions.                                                  |
| `bend`       | `root`, `joint`, `end`, `pole`, `minDot`                 | Dot product between the projected joint bend and projected world pole, measured perpendicular to root-to-end. A positive threshold requires the intended bend direction. |

Floors may be signed. Distances/tolerances must be finite and nonnegative; `maxDegrees` is 0–180; `minDot` is −1–1. A collapsed level direction or undefined pole plane fails rather than claiming an orientation. A perfectly straight limb has bend score zero: it can satisfy `minDot: 0`, but cannot prove a positive bend direction.

Sampling includes rest, clip endpoints, every key time, a point immediately before key discontinuities, the midpoint of every consecutive key interval and a 24 Hz grid. The actual final key of a looping clip is inspected without wrapping to zero. Thus a 360-degree limb rotation with matching start/end poses is still checked during the motion. Reports retain at most 1,000 detailed failures and count every failure. Up to 100 constraints, 20,000 samples per selected clip/window and a bounded transform work budget are allowed; an oversized review fails and asks for narrower windows instead of silently skipping checks.

The 20-million-unit transform work budget charges every selected corner or marker through its full ancestor depth, bone sampling and group lookup work. It is checked before a clip/window is sampled, and one authoring call shares it across IK generation, endpoint checks and constraint review. A deep hierarchy cannot multiply nominal corner work without being counted. Inverse transforms that overflow due to extremely small scales, nonfinite transformed points and nonfinite measurements fail closed. Collapsed directions caused by scale underflow are failed orientation checks.

This finite sample scheme detects many animation errors but is not continuous collision detection, a full-body collision solver, automatic anatomy recognition or proof of aesthetic quality. Constraints describe measurable design intent; selecting a large tolerance weakens that intent.

## Optional target-based limb motion

The `motions` array bakes two-bone IK from declarative world targets:

```json
{
  "animation": "walk",
  "fps": 30,
  "tolerance": 0.05,
  "limbs": [
    {
      "upper": "body/leg",
      "lower": "body/leg/shin",
      "end": [0, 0, 0],
      "targets": [
        { "time": 0, "position": [0, 1, 1], "pole": [0, 3, 4] },
        { "time": 1, "position": [1, 1, -1], "pole": [2, 3, 4] }
      ]
    }
  ]
}
```

The source must declare the named animation; `animation walk 1 loop { }` is valid for a clip consisting entirely of generated limb tracks. The two controlled bones must have zero rest rotation. The lower pivot must be a direct child and sit strictly below the upper pivot on negative Y. The declared end marker must sit strictly below the lower pivot on the same axis. Bone lengths are derived from those positions, so a target cannot invent a missing limb or change its length.

Targets and poles are world-space points, linearly interpolated between explicitly timed values. They must start at zero, finish exactly at clip length and strictly increase. Existing animation on the two controlled bones is an error; animated ancestors are supported by inverting their full transforms. Duplicate controlled bones, repeated animation plans, ambiguous pole planes, unsupported rest chains, and unreachable poses are errors. Limb roots cannot descend from another controlled limb; this prevents order-dependent multi-limb solving.

The bake includes a 1–60 Hz grid, source key times and every target time. It checks the actual final endpoint against the desired trajectory at every baked key and halfway between keys. `tolerance` defaults to 0.25 units and is bounded to 0–1; a bake with excessive interpolation error fails and requires more samples or simpler targets. The resulting ordinary BBIR rotation tracks count toward the normal 10,000-key limit and import/export without a special runtime. They are not live game IK. Add contact, floor, bend and attachment constraints to verify the rest of the limb and any attached geometry.

## Reproduction and regression evidence

Run the repository build, then `node --test tests/design.test.mjs`. The independent regressions check real atlas texels and face dimensions; input immutability and repeated-output equality; padding; malformed and unused declarations; missing reference errors; ground penetration under rotated parents; mid-motion plant failures hidden by matching endpoints; joint bend direction; and IK endpoints through animated ancestor transforms. Tests compare reported ground measurements to the actual geometry renderer and IK positions to `bonePoint`, rather than only checking the generated track JSON.

`DESIGN_INSTRUCTIONS` exports the exact compact JSON contract for provider adapters. Keep it, the parser, these docs and tests in sync when adding a field. Provider usage accounting, rendering, revision permission boundaries and external Blockbench operation belong to the calling workflow; a valid design document alone does not demonstrate reference similarity or a live provider run.

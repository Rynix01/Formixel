# Particle sidecars and deterministic sampling

Particle documents describe bounded numeric emitters attached to an existing model. The core validates the sidecar and returns particle records for a requested animation and elapsed time. Sampling does not mutate the model or create particle-shaped cubes. This API does not yet add particles to CLI previews, rendered PNGs/GIFs, exported `.bbmodel` files or game formats.

## Core API

```js
import {
  parseParticleDocument,
  validateParticleDocument,
  particleModelDigest,
  sampleParticles,
} from './packages/core/dist/particles.js';

// The model in this example contains group "head/mouth" and animation "fire_breath".
const input = {
  version: 1,
  modelDigest: particleModelDigest(model),
  recipes: [
    {
      id: 'embers',
      seed: 42,
      shape: 'cone',
      direction: [0, 0, -1],
      spread: 15,
      speed: [2, 4],
      lifetime: [0.5, 1],
      acceleration: [0, 1, 0],
      drag: 0.5,
      size: [
        [0, 0.2],
        [1, 0],
      ],
      color: [
        [0, '#ffbb66ff'],
        [1, '#dd330000'],
      ],
      render: 'sprite',
      blend: 'additive',
    },
  ],
  events: [
    {
      id: 'mouth_embers',
      animation: 'fire_breath',
      time: 0.25,
      recipe: 'embers',
      duration: 1,
      rate: 20,
      burst: 4,
      attachment: { group: 'head/mouth', point: [0, 8, -3] },
      space: 'world',
    },
  ],
};
const diagnostics = validateParticleDocument(model, input);
const document = parseParticleDocument(model, JSON.stringify(input));
const particles = sampleParticles(model, document, 'fire_breath', 1.25);
```

The example imports the built particle module from the repository root after building core. Public package entry point wiring is separate from this module.

`parseParticleDocument(model, input)` accepts a JSON string or an object, rejects invalid data and returns a detached typed clone. `validateParticleDocument(model, input)` returns core `Diagnostic[]` records with `path` and `message`; an empty array means the document passed validation for that model. Unknown fields and invalid references fail explicitly.

`particleModelDigest(model)` is the SHA-256 digest of the model's canonical `serialize(model)` output. A sidecar's required `modelDigest` must match. Editing model geometry, hierarchy, textures, animations or other serialized content requires rebuilding the sidecar against the updated model. The digest binds data to an exact model; it is not a signature or an author identity.

`sampleParticles(model, document, animationId, time)` returns records with `id`, `position`, `size`, `color`, `blend`, `render`, `age` and `lifetime`. Positions are world coordinates, colors are lowercase `#rrggbbaa` strings, and age/lifetime use seconds. Render metadata is `voxel` or `sprite`, and blend metadata is `alpha` or `additive`; a consuming renderer implements their appearance. The animation, recipe and attachment group references use exact model/document IDs. Display names do not resolve references.

All input is data. The sidecar cannot evaluate JavaScript, Molang, formulas or callbacks, read files, fetch URLs, choose a provider or launch a subprocess.

## Elapsed time and emission

The sample time is finite, nonnegative elapsed time measured from the start of playback. It is not normalized animation phase. Sampling is stateless: asking for a time directly, repeating a sample or requesting times out of order produces the same particle records for the same model and document.

A burst emits all its particles at the event start. A rate emitter schedules births at `eventStart + n / rate` for integers `n >= 0` while `n / rate < duration`. A zero rate schedules no rate births. Burst and rate emissions are additive: a positive burst and rate both emit at the start. A particle's age is elapsed sample time minus its scheduled birth time. It is alive exactly while `0 <= age < lifetime`; the exact expiry instant is excluded.

Looping animation poses wrap at the clip length. Particle history remains measured from playback time zero; wrapping the pose does not reset particle ages, randomness or identities. Events repeat each loop, beginning with loop zero; no occurrence precedes timeline zero. Their duration may overrun the clip boundary, and occurrences can overlap. Records retain event/loop/emission-kind/index identity so those overlapping particles remain distinct.

For a nonlooping clip, the pose clamps at the end. The event's finite emission schedule and already emitted particles continue against that clamped pose. Clip length does not silently cut off an emitter or kill living particles.

## Attachment coordinates

Attachment markers use absolute rest project coordinates, matching BBIR group origins and `bonePoint`. A marker is not an offset that should be added to every ancestor pivot. The complete attached-group hierarchy affects it, including the selected group itself.

For each group, apply animated scale around the group's absolute origin, rotate around that origin using the componentwise sum of rest and animated rotation, then add animated position. Euler rotation applies X, then Y, then Z. Compose those group transforms from the attached group toward the root. Rotations from different ancestors cannot be combined by adding their Euler angles.

In **world** attachment mode, the full attachment frame is sampled at the particle's birth time. Initial position, launch velocity and acceleration use that frame. Later parent movement does not drag the particle along, and no emitter movement velocity is inherited.

In **local** attachment mode, the particle's motion stays in the attachment's rest coordinates. At the requested sample time, the current animated hierarchy transforms the marker and its complete displacement. Later parent translation, rotation and scale therefore move living particles. Acceleration follows the same local frame.

Velocity, acceleration and displacement use the linear scale/rotation part of an attachment frame. Pivots and translations affect points, not vectors. Nonuniform animated scales remain nonuniform for particle positions. Scalar particle size uses the geometric mean of inherited animated scale, equivalently the cube root of the attachment transform's volume scale. World mode freezes that scale at birth, while local mode uses the current pose.

## Numeric recipes

Cone emission samples direction uniformly over solid angle around a normalized, nonzero direction. Spread is the cone half-angle: zero emits along the direction, and 180 degrees covers the sphere. Speed and lifetime are sampled from their declared linear ranges using a uint32 seed. The same seed, event occurrence and particle identity reproduce the same samples; seeking does not consume mutable random state.

Motion follows `dv/dt = acceleration - drag * velocity`, sampled directly at particle age. At zero drag the displacement is `initialVelocity * age + acceleration * age² / 2`. Drag is nonnegative, and acceleration is a finite vector. Size and color curves are arrays of `[normalizedAge, value]` nodes, with strictly increasing ages including both endpoints zero and one. Size values interpolate linearly. Colors use `#RRGGBBAA` values and interpolate linearly in RGBA8 channel space, rounding each output channel to the nearest integer. The alpha channel is part of the interpolated color; no texture or external image is required.

## Document fields

The root is `{ version: 1, modelDigest, recipes, events }`. Each recipe requires `id`, `seed`, `shape`, `direction`, `spread`, `speed`, `lifetime`, `acceleration`, `drag`, `size`, `color`, `render` and `blend`. Only `shape: "cone"` is accepted. `speed` and `lifetime` are ordered `[min, max]` pairs; equal endpoints select a fixed value.

Each event requires `id`, `animation`, `time`, `recipe`, `duration`, `rate`, `burst`, `attachment` and `space`. Its `attachment` is exactly `{ group, point }`, with a three-component absolute rest marker. `time` is the event start in seconds within its animation: `0 <= time < clip.length` for a looping clip, and `0 <= time <= clip.length` for a nonlooping clip. `duration` controls rate emission, and `burst` is the integer count emitted at the start. Each event must emit at least one particle: a positive burst, or both a positive rate and duration. `space` is `world` or `local`. There are no implicit field defaults.

## Validation and work limits

Every declared recipe and event field is required. Identifiers follow core ID syntax, `[A-Za-z0-9_.:/-]{1,128}`, and references must resolve to exact IDs. The document must carry the matching model digest. Validation is strict for nested objects as well as the root.

| Input                       | Limit                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| JSON/document size          | 2,000,000 UTF-8 bytes                                              |
| Recipes                     | 64                                                                 |
| Events                      | 256                                                                |
| Direction components        | `-1000000..1000000`; direction must be nonzero                     |
| Seed                        | Integer `0..4294967295`                                            |
| Spread half-angle           | `0..180` degrees                                                   |
| Speed range                 | `0..10000` units/second                                            |
| Lifetime range              | Greater than zero, at most 5 seconds                               |
| Acceleration components     | `-10000..10000` units/second²                                      |
| Drag                        | `0..100`                                                           |
| Emission rate               | `0..256` particles/second                                          |
| Burst                       | Integer `0..512` particles                                         |
| Event duration              | `0..10` seconds                                                    |
| Attachment point components | `-1000000..1000000`                                                |
| Size curve                  | `2..32` nodes; values `0..1024`; exact age endpoints `0` and `1`   |
| Color curve                 | `2..32` nodes; `#RRGGBBAA` values; exact age endpoints `0` and `1` |

One sample may evaluate at most 4,096 candidate births and return at most 1,024 live particles. Candidate births are counted within `[sampleTime - recipeMaxLifetime, sampleTime]`, including particles whose individually sampled lifetime has already expired. Schedule scanning is separately bounded to 4,096 entries. Pose key searches and affine group transforms share a 1,000,000-unit transform work budget.

There is no fixed maximum sample time, but loop indices must remain safe integers. Nonfinite intermediate/output positions, unrepresentable positive particle sizes after inherited scale and exceeded budgets fail explicitly; the sampler does not silently drop or truncate particles to fit a budget. Validation exposes diagnostics, and invalid sampling requests throw descriptive errors. These limits bound local work and do not establish a renderer's frame rate or a game's particle capacity.

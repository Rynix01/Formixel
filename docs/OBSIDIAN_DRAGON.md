# Obsidian Crimson Dragon

A quadrupedal cuboid dragon fixture with an embedded 512x512 pixel atlas and six numeric clips. Open `examples/obsidian_crimson_dragon.bbmodel` as a Generic Model in Blockbench. The separate atlas is `examples/obsidian_crimson_dragon_atlas.png`; the native project already embeds it.

![Dragon](../examples/obsidian_crimson_dragon_preview.png)

The palette is charcoal/obsidian scales, crimson membranes and dorsal spines, ivory horns/claws, emerald eyes, gold breastplate/forearm guards and red rubies. Four articulated feet, a two-part neck, opening jaw, paired two-part wings and ten connected tail bones form the rig. Layered cuboids give the scales their silhouette. The atlas contains mapped surfaces rather than labels or illustrations of body parts.

## Reproduce and inspect

```sh
npm run build
node scripts/generate-dragon.mjs dist/showcase/dragon
node packages/cli/dist/index.js validate examples/obsidian_crimson_dragon.bbmodel
node packages/cli/dist/index.js quality examples/obsidian_crimson_dragon.bbmodel
node packages/cli/dist/index.js import examples/obsidian_crimson_dragon.bbmodel -o dragon.bbir.json
node packages/cli/dist/index.js render examples/obsidian_crimson_dragon.bbmodel --animation bite_lunge --size 384 -o bite.gif
```

The generator uses Formixel's atlas, rig, canonical BBIR, native compiler and renderer APIs. It writes the native project, BBIR, atlas layout, rig markers, technical validation report, six camera views, six GIFs and four contact sheets. `--quick` omits motion previews. It runs locally without provider requests or paid APIs. The JavaScript authoring file is trusted repository source; it is never a provider-supplied executable.

This fixture demonstrates deliberately authored geometry and motion. It is not a promise that one unrestricted planner prompt reproduces the same asset. For new reference-led drafts, use the explicit Codex PNG workflow in [reference authoring](REFERENCE_AUTHORING.md), then review silhouette, UVs and motion locally. Keep private references and planner transcripts outside the public example directory.

## Motion

| Clip        | Seconds | Behavior                                                                |
| ----------- | ------- | ----------------------------------------------------------------------- |
| idle        | 3.0     | Breathing, wing settling and a slow tail wave; loops                    |
| walk        | 1.2     | Diagonal pairs, toe-off, foot clearance and level soles; loops in place |
| bite_lunge  | 1.6     | Crouch, pullback, forward burst with opening jaws, recovery             |
| tail_whip   | 2.0     | Coil, sweeping chain rotation, counterturn and recovery                 |
| fire_breath | 2.4     | Inhale, jaw opening, voxel fire cone, smoke cooldown                    |
| wing_slam   | 1.8     | Wing raise, airborne burst, downward strike and landing                 |

Moving channels are sampled at approximately 24 fps, walk at 30 fps and the fast bite/slam clips at 36 fps, with explicit phase boundaries and linear interpolation. Constant channels retain only their endpoint keys, reducing native file size without changing their values. Limb poses are solved from reachable ankle targets; full parent orientation is used to level each sole. Attack feet reposition during the burst and landing; this is authored motion, not a physical collision or root-motion controller.

## UV and verification contract

Every cuboid face has explicit UVs. Ordinary surfaces use approximately two pixels per model unit and eyes/rubies use six, rounded up with a two-pixel minimum. Equal-size faces with matching material/detail/tone may intentionally share a region; unique atlas allocations have extruded padding and do not overlap. These reusable regions reduce atlas pressure but do not provide unique hand-painted pixels for every scale.

Tests compare regenerated geometry/texture/animation against the shipped native project, roundtrip the native codec, enforce resource and UV bounds, sample actual foot markers and sole vertices at keys/interpolated times, and verify jaw direction, wing raise, tail sweep and effect recovery. Clean diagnostics establish technical validity, not visual fidelity to a concept sheet.

Fire, smoke and chest charge are bounded cuboid preview effects using positive numeric scale. Their bind geometry is microscopic and they expand only during the fire clip. They are not game particles, transparency blending or emissive shaders; eyes and gems use bright texture colors. A game integration must supply its own particle events, sound, hit timing and material behavior. The asset does not include a ready-to-install Minecraft or GeckoLib pack.

The 1,059-cuboid project was opened, saved and reopened in Blockbench web 5.2.1 on 2026-10-11. Its embedded atlas and six clips loaded; Formixel re-imported the editor's saved project with 36 groups, one texture and six clips. This check exposed two import compatibility fixes: inert static texture timing defaults and initialized bone animators with no keys. Global/quaternion animation modes and genuine animated texture strips remain unsupported. Desktop Blockbench and game integration require separate verification.

Local rendered views and codec roundtrips are reproducible. The rendering style is Formixel's local textured rasterizer; it does not reproduce the lighting or ambient occlusion of a studio concept render.

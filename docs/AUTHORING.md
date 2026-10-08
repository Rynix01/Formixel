# Atlas, rig and motion authoring

The core exposes bounded authoring helpers for explicit face textures and baked limb motion. These are trusted TypeScript/JavaScript APIs, separate from the declarative FXL provider grammar. Formixel never evaluates a program returned by a provider. Open-ended FXL generation still requires visual review and deliberate texture/rig refinement; these helpers do not automatically turn arbitrary prompts into premium artwork.

## PixelAtlas

`new PixelAtlas(width = 512, height = 512)` creates a local RGBA atlas within 262144 total pixels, with each dimension in 4..1024. `allocate(id, width, height, paint)` packs an axis-aligned rectangle with one-pixel edge extrusion on every side. The callback receives local `x,y,width,height` and must return four integer RGBA8 bytes. It is trusted in-process authoring code. Region sizes must be positive integers and fit the atlas including padding; up to 10000 unique region IDs are accepted. Invalid paint fails without committing pixels or placement.

Returned regions contain `x,y,width,height,uv`. Use `region.uv` on a cube face. `texture(id,name)` produces a BBIR texture; `png()` exports an independent PNG. Rectangle packing is deterministic for the same allocation order; output cannot fit an arbitrary number of regions into a finite atlas. It fails explicitly on exhaustion. Select texel density before painting and inspect the atlas layout.

Use each face's physical dimensions: north/south map width X and height Y; east/west map Z/Y; up/down map X/Z. Multiply by a chosen density and round to pixels. Avoid putting the same square region onto tall, wide and narrow faces. Focal regions can have higher density than concealed faces. Explicit per-part painting can supply a visor, emblem, seam, bevel or metal gradient; more pixels alone do not provide artistic quality.

## Two-bone solver

`solveTwoBone(root, target, pole, upperLength, lowerLength)` solves an elbow/knee in 3D. Both bones rest along negative Y. The pole selects the bend plane; a deterministic fallback handles a collinear hint. Input vectors require three finite bounded coordinates; lengths must be .000001..1000000. The result contains `upper` and `lower` XYZ Euler rotations, `joint`, `end`, and a `clamped` flag. Targets outside the reachable annulus are clamped explicitly. A target at the root is rejected because its direction is undefined.

`inverseRotateVector` uses the inverse of the core's XYZ rotation convention. `bonePoint(model, groupId, absoluteMarker, poses?)` maps a marker through the same complete hierarchy as rendering. Measure a hand grip/ankle using actual group transforms, rather than only comparing requested rotation values. Bone pivots remain absolute project coordinates. Only bone-bound cuboids are supported; this is not skin-weight or physics support.

Bake solved motion into ordinary numeric linear keyframes. Keep the native bind pose aligned with the clip's initial stance and store relative channel offsets. Use smooth phase functions before baking. Increasing sample rate reduces between-key target drift but consumes the 10000-keyframe budget. Validate reachability, ground clearance, endpoint error and loop seams, including between-key samples. For an in-place walk, entity translation is supplied by the game; the stance foot sweeps backward in local Z while its sole remains level.

## GIF motion review

```sh
node formixel.mjs render examples/crimson_paladin.bbmodel --animation walk --fps 12 --size 384 -o walk.gif
node formixel.mjs render examples/crimson_paladin.bbmodel --animation attack --view front -o attack.gif
```

GIF rendering is local and bundled. It starts no subprocess/provider and requires no FFmpeg install. An animation is required; `--time` selects a single PNG pose and cannot be combined with GIF. GIF accepts integer fps 1..24 and size 16..512. It caps output at 120 frames, 16777216 frame pixels, 100 million aggregate candidate raster pixels and 16 MB encoded bytes. Oversized requests fail before installing an output file. `--fps` is rejected for PNG/SVG/texture export.

The renderer fits one projected envelope over all sampled frames, then keeps scale and center fixed. It uses actual projected vertices rather than projecting unused corners of a world bounding box. `animationFraming(model,id,times,view)` and `RenderOptions.framing` expose that camera for other local renderers. `animationBounds` provides world bounds when needed. Sample arrays are bounded to 121 entries; an envelope covers those samples, not a mathematical guarantee over every continuous instant.

Loop clips repeat; once clips include their final pose and do not repeat. Delays are rounded from absolute boundaries to GIF's 10ms clock to avoid accumulated timing drift. Palettes are quantized per frame using [gifenc](https://github.com/mattdesl/gifenc); GIF is an indexed preview, while embedded PNG textures keep their original RGBA pixels. Independent decoding tests verify frame contents, delay totals and stable camera anchors.

## Paladin fixture

`node scripts/generate-paladin.mjs [output-directory]` reproduces the [Crimson Paladin](CRIMSON_PALADIN.md), its atlas/layout, native project, canonical BBIR, six views, clips, frame sequences and rig targets. Inspect static silhouette, texture density, grip, joints, cape attachment and the complete motion cycle. Technical checks and an attractive still do not replace this review. Game/controller compatibility and live editor save/reopen remain separate checks.

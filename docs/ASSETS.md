# Textures, animation and BBIR 2

BBIR version 2 extends cuboids with material swatches, static embedded PNG textures, per-face UV rectangles, quarter-turn UV rotations and face visibility. It adds numeric bone position/rotation/scale tracks with linear and step interpolation. Version 1 models remain accepted and canonical serialization upgrades them to version 2. Unsupported mesh/game metadata, interpolation expressions, effects and external texture paths still fail explicitly.

FXL now supports root `material bark "#60452fff"` and `pattern moss 8 8 "#426d32ff" "#527e40ff"`. Add `material bark` or `surface moss` after the cube's optional color clause. Material swatches bake into a deterministic power-of-two one-row atlas. Pattern faces cover the full checker texture. BBIR stores full RGBA8 pixels and explicit UVs, so custom images can be supplied through BBIR or imported embedded `.bbmodel` textures. PNG decoding supports noninterlaced RGB/RGBA8 with all five standard filters and verifies chunk CRCs. Indexed, grayscale and animated PNGs are rejected in 1.0 rather than misdecoded.

`mirror x { ... }` emits original and reflected cuboids/groups; `repeat 3 offset [0,0,2] { ... }` emits three copies. Macros have stable hierarchical IDs, bounded counts and total expansion budgets. They can nest. They are declarative expansions, not executable loops. Existing nodes outside a macro retain their semantic IDs. Mirroring reflects bounds/origins and conjugates Euler rotations; material/UV assignments are retained.

```
animation idle 2 loop {
  rotate "torso/head" 0 [0,-10,0]
  rotate "torso/head" 1 [0,10,0]
  rotate "torso/head" 2 [0,-10,0]
}
```

Animation directives: `rotate`, `move`, `scale`, followed by a quoted semantic group ID, seconds and vector. Optional trailing `step` selects hold interpolation. `loop` wraps time; `once` clamps it. Times must increase within the animation length. No Molang or event expressions are evaluated. The current compiler uses Blockbench 5.0 animation conventions; 4.10 numeric position/rotation imports are converted to modern coordinates.

`render -o preview.png --size 512 --animation idle --time 0.5` uses a software triangle rasterizer with nearest-neighbor UV sampling, opaque/cutout alpha and a per-pixel depth buffer. The default view faces the model's negative-Z front. Semi-transparent texture alpha is interpreted as a cutout at 128; translucent blending is outside this release. `render -o atlas.png --texture formixel_palette` exports a texture. SVG remains a lightweight geometry-only approximation; use PNG for textures/animation/visibility proof.

Resource budgets include 262144 total texture pixels, 32 textures, 256 material swatches and 10000 keyframes. Renderer size is bounded to 1024 and candidate raster workload to 100 million pixels. All limits fail explicitly. Add/replace patch operations validate the complete model and retain transactionality.

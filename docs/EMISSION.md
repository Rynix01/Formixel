# Explicit texture emission

An emission sidecar records which exact albedo texels should retain their color under shading. It contains one strength byte per texel: `0` uses the shaded color, `255` uses the full albedo color, and intermediate values interpolate between them. Bright albedo pixels do not imply emission. The mask is independent data selected by the author.

This is fullbright surface compositing. It does not illuminate other geometry, create scene lights, or add bloom.

## Sidecar contract

```ts
interface EmissionDocument {
  version: 1;
  modelDigest: string;
  masks: {
    texture: string;
    width: number;
    height: number;
    pixels: number[];
  }[];
}
```

`modelDigest` is the lowercase SHA-256 of the UTF-8 bytes returned by `serialize(model)`. Geometry, UVs, albedo pixels, hierarchy, and animation are included in this binding. Reusing a sidecar with a changed model fails validation. Create a new document when intentionally updating its model and masks.

Each `texture` is an exact existing BBIR texture ID. `width` and `height` must match that texture exactly. `pixels` contains exactly `width * height` integer bytes, in row-major order, with no RGB or alpha channels. One document has 1–32 masks, at most one per existing texture; a subset of textures is allowed. The total mask texel count cannot exceed the existing BBIR limit of 262,144, and the model must itself pass normal validation. Unknown fields, unknown textures, duplicate assignments, typed arrays in the JSON contract, wrong sizes, missing values, and strengths outside 0–255 are rejected. There are no expressions, selectors, URLs, or file paths in the sidecar.

## Core API

```ts
const emission = createEmissionDocument(model, [
  { texture: 'atlas', width: 2, height: 2, pixels: [0, 128, 255, 64] },
]);
const checked = validateEmissionDocument(model, JSON.parse(sidecarText));
const assets = exportEmissionMasks(model, checked);
```

The creation example requires an existing 2 × 2 texture with ID `atlas`. Validation returns independent data, sorted by exact texture ID. Creation, validation, and export preserve their input model and mask arrays.

`exportEmissionMasks(model, document, options?)` returns an array of:

```ts
{
  texture: string;
  filename: string;
  width: number;
  height: number;
  png: Uint8Array;
}
```

Its default `grayscale` target emits deterministic grayscale8 PNGs with one channel per texel and exactly the target texture's dimensions. Default filenames combine a sanitized ID prefix, a 12-digit SHA-256 ID suffix, and `_emission.png`; arbitrary texture display names are not interpreted as paths. For explicit base names, pass `{ target: 'grayscale', textureNames: { atlas: 'sentinel.png' } }` to obtain `sentinel_emission.png`.

Names must be simple base `.png` filenames using letters, digits, underscores, and hyphens. Paths, URLs, Windows device names, unknown texture-name assignments, and case-insensitive output collisions fail. Output names and PNG bytes are deterministic for the same validated inputs.

`shadeEmission(baseRGBA, shadedRGBA, strength)` accepts two RGBA8 colors and an integer strength byte. For each RGB channel it computes `round(shaded + (base - shaded) * strength / 255)` and always returns the original albedo alpha. It returns a new four-byte tuple. The caller supplies its ordinary shaded RGB; this helper applies no lighting model of its own.

## GeckoLib4 texture export

GeckoLib4 documents an emissive render layer and the `<base>_glowmask.png` filename convention. Its renderer requires `AutoGlowingGeoLayer`; exporting a texture does not install that layer. See the official [GeckoLib4 emissive-texture documentation](https://github.com/bernie-g/geckolib/wiki/Emissive-Textures-%28Geckolib4%29).

Select that target explicitly and name every masked base texture:

```ts
const glowTextures = exportEmissionMasks(model, emission, {
  target: 'geckolib4',
  textureNames: { atlas: 'sentinel.png' },
});
// glowTextures[0].filename === 'sentinel_glowmask.png'
```

This target emits RGBA8 with the source albedo RGB and alpha `round(albedoAlpha * maskStrength / 255)`. A zero-strength texel becomes transparent; a full-strength texel preserves its original alpha. A transparent albedo texel remains transparent even under a full-strength mask. These exported overlay pixels are distinct from the grayscale authoring mask. Supply names matching the actual target base textures and integrate them with the target renderer.

## Verification

```sh
node node_modules/typescript/bin/tsc -b packages/core
node --test tests/emission.test.mjs
```

The focused regressions decode real grayscale and RGBA PNG outputs, compare strength/color/alpha values, verify exact dimensions and deterministic names, enforce model digest changes and resource bounds, reject unsafe or colliding names, and check that every API preserves its inputs.

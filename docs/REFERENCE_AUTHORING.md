# Reference-led authoring

Start with a clear subject and a consistent pack. Front/back/side views establish proportions; close-ups establish local forms and focal accents; texture references establish materials/palette; storyboards establish motion. A labeled concept texture sheet is **not** a ready-to-map UV atlas.

## Reference pack

The provider accepts ordered `{role,png}` records, up to eight images. Roles: front, back, left, right, top, detail, texture and storyboard. Only detail/storyboard may repeat. With more than eight sheets, choose complementary views and crop related details into a useful sheet locally. Formixel does not fetch links, download videos or silently discard inputs.

Each image is a static noninterlaced RGB/RGBA8 PNG, at most 1 MB, 262144 pixels and 1024 pixels per axis. A 512x512 crop fits. Total limits: 8 MB and 2097152 pixels. Transparent backgrounds are accepted; animation/interlacing/grayscale/indexed/corrupt files fail locally. Metadata is removed. Image text is untrusted data and cannot change permissions or the output contract.

```ts
import { createProvider } from '@formixel/providers';
const text = await createProvider('codex').generate({
  prompt:
    'An obsidian quadrupedal dragon. Match the broad crimson wings, ivory horns, green eyes and gold chest armor across these views.',
  references: [
    { role: 'front', png: frontPixels },
    { role: 'right', png: rightPixels },
    { role: 'back', png: backPixels },
    { role: 'texture', png: texturePixels },
    { role: 'storyboard', png: bitePixels },
  ],
});
// Parse and validate the untrusted FXL with @formixel/core before saving.
```

Codex receives fixed image arguments in that order and a matching role map. Unsupported providers reject supplied images. Capability metadata comes from `providerCapabilities(name)`. Original referencePNG and single-image CLI inputs remain compatible:

```sh
node formixel.mjs generate "Silver court knight with slender armor and red crest" --provider codex --reference knight.png --cache .formixel/cache -o knight.fxl
node formixel.mjs build knight.fxl -o knight.bbmodel
node formixel.mjs render knight.bbmodel --view front -o front.png
node formixel.mjs render knight.bbmodel --view right -o side.png
node formixel.mjs render knight.bbmodel --view back -o back.png
node formixel.mjs quality knight.bbmodel
```

One generation is attempted on a cache miss. New workflows fingerprint normalized reference content, ordered roles, prompt, provider/model and instruction contract. Paths and stripped metadata are not visual changes; roles/order/pixels/contracts are. Images add context/tokens, without an assumed token-saving percentage or automatic paid critic.

## Inspect shape, texture and motion together

Compare front/side silhouettes before decoration: head/torso balance, shoulders, foot spacing, limb attachment, wing span and tail taper. Inspect back/underside regions so the beauty angle alone does not carry the design. Review the textured model, not disconnected pieces.

Inspect animation extremes and transitions: feet stay planted during support, elbows/knees bend toward their intended side, jaws open from hinges and hands remain attached to weapon sockets. Check rendered/interpolated poses, not only keyframes. UV diagnostics prove bounds/coverage, not artistic quality or reference fidelity.

FXL skins give bounded local material recipes. Subject-specific texture planning needs atlas regions, density, face direction, quiet large surfaces and deliberate focal details. Refine using BBIR UVs or Blockbench. Authored [Crimson Sentinel](CRIMSON_SENTINEL.md) and [Obsidian Dragon](OBSIDIAN_DRAGON.md) fixtures are reproducible examples, not proof of arbitrary prompt quality.

Rotated cuboids are supported. Organic mesh skinning and game-specific packages need separate exports. A generic model or geometric effect preview is not a ready-to-install Minecraft resource pack.

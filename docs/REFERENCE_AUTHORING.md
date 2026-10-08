# Reference-led authoring

Start with an identifiable subject: its silhouette, proportions, main colors and material breaks. A reference image is useful only if the intended subject is clear. Remove scenery/HUD when possible, and identify the target in the prompt if another character appears in the crop. Formixel does not download links or analyze video automatically.

## Native planning

Choose a static, noninterlaced RGB/RGBA8 PNG up to 1 MB, at most 262144 pixels and 1024 pixels on either axis. A 512x512 crop fits the pixel budget. Transparent backgrounds are accepted. Grayscale/indexed PNG, animation and corrupt images fail locally. Image bytes are normalized before forwarding to native Codex; task JSON stays path-free.

```sh
node formixel.mjs generate "Silver court knight with swept red double crest, red cape and double-bladed poleaxe. Match this subject's slender plate-armor proportions and modest shoulders." --provider codex --reference knight.png --cache .formixel/cache -o knight.fxl
node formixel.mjs build knight.fxl -o knight.bbmodel
node formixel.mjs render knight.bbmodel --view front -o front.png
node formixel.mjs render knight.bbmodel --view right -o side.png
node formixel.mjs render knight.bbmodel --view back -o back.png
node formixel.mjs quality knight.bbmodel
```

Compare the rendered silhouette against the crop before adding decoration. Check head/torso balance, foot spacing, shoulder size, limb connections and weapon grip from every side. Compare cape/crest shapes separately. Review animation extremes, not just the standing pose. Technical UV diagnostics cannot judge any of those artistic decisions.

One generation request is made on a cache miss. Matching normalized image pixels, prompt, provider, model and instructions reuse locally validated source with zero requests. An image can increase input tokens; reference support is not a token-saving percentage claim. There is no automatic paid visual critic or retry. Unsupported providers fail instead of silently sending text without the supplied image.

## Texture and rig refinement

FXL skins are bounded local surface recipes. They give a first material pass, not subject-specific texture painting. Refine an accepted shape using explicit BBIR UV regions or the Blockbench texture editor. Keep large quiet metal/cloth regions, restrained wear and distinct focal details. Use the same atlas density for neighboring plates; choose deliberate UVs for a visor, emblem or engraved breastplate.

The [Crimson Sentinel fixture](CRIMSON_SENTINEL.md) demonstrates that refinement. Its generator uses the trusted BBIR API to construct a defined character, paint a fixed atlas locally and attach animation groups. It is an authored reproducible asset, separate from the open-ended provider output. No provider-generated program is evaluated. It is not an automatic quality guarantee for arbitrary prompts.

The compiler supports rotated cuboids. Organic meshes, skin weights, translucent cloth, PBR/emissive shaders and game-specific codecs require separate authoring/export support. Open the generic project in Blockbench and use an appropriate format/plugin for the intended game.

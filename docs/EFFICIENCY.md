# Compact authoring and review

Formixel 1.1 keeps planning separate from geometry expansion, texture pixels, validation, rendering and compilation. A planner declares reusable components and a palette; the local compiler expands them. This reduces repeated source text and keeps texture arrays/native project metadata out of provider output. The shared planner instructions include the full supported grammar and art direction for silhouette, proportion, joint visibility and restrained surface detail. There is no hidden critique/repair loop or automatic second request.

## Reproducible source benchmark

Run `npm run benchmark` after building. `scripts/benchmark.mjs` expands `examples/ironroot_knight.fxl` into explicit FXL groups/cubes with the same surface declarations and animation. It checks canonical BBIR equivalence, including UVs, at 1e-8 numerical precision before reporting UTF-8 bytes. The fixture uses unit-scale instances; this comparison does not regenerate scaled instance UVs. The expanded baseline also omits zero origin/rotation and default colour clauses. This measures component reuse against concise explicit nodes, not a theoretical minimum encoding.

| Measurement               |  Result |
| ------------------------- | ------: |
| Expanded cuboids / groups | 85 / 22 |
| Compact FXL bytes         |    4212 |
| Explicit FXL bytes        |    7519 |
| Source byte reduction     |   44.0% |

These are **LF-normalized UTF-8 source bytes, not provider tokens**. Tokenization, reasoning and a native CLI's own context differ. There is no measured old/new provider token percentage here. Local recipes also generate their pixels without an image provider, but procedural textures do not replace a texture artist's bespoke atlas.

## Practical workflow

```sh
node formixel.mjs generate "An ancient forest knight with a clear silhouette" --provider codex --cache .formixel/cache -o knight.fxl
node formixel.mjs build knight.fxl -o knight.bbmodel
node formixel.mjs quality knight.bbmodel
node formixel.mjs render knight.fxl --view front -o front.png
node formixel.mjs render knight.fxl --view right -o right.png
node formixel.mjs render knight.fxl --view back -o back.png
node formixel.mjs render knight.fxl --animation idle --time 0.5 -o idle.png
```

Only `generate` invokes the provider. On a matching cache hit it makes zero generation requests. Preserve the command's numeric usage report if measuring consumption; do not call missing usage zero. Compare repeated runs with the same provider/model/style prompt and distinguish cached input from uncached input.

Check silhouette and foot contact first, then joints, front/back attachment points, proportions, focal accents, UV scale and animation motion. Use `patch` for bounded local BBIR edits rather than requesting the entire native file again. The source-based Ironroot Knight fixture demonstrates layered plates, separate limb joints, reused hands/feet/horns, six numeric idle keyframes and local surface recipes. It is an editable Generic Model, not a game-ready pack or a guarantee that every generated design will meet a premium visual target.

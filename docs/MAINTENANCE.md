# Maintenance guide

Formixel is a strict TypeScript npm monorepo. All packages use the `@formixel` namespace and aligned 1.5.0 versions. The local cuboid compiler now includes declarative surface/rig authoring, scoped revision, review artifacts and a paired editor workflow. Native Codex/Claude Code planners stay primary; APIs remain explicit alternatives.

## Development

Read README.md, ARCHITECTURE.md, SECURITY.md, FXL.md, ASSETS.md, DESIGN.md, REPAIR.md and IMPLEMENTATION_STATUS.md. Install with `npm ci --ignore-scripts` and run `npm run check`. Release builds bundle the CLI, MCP adapter and browser plugin; tests verify standalone execution and per-file hashes. Generated dist files and credentials are ignored. Keep provider account checks, mock tests, rendered inspection and current host evidence distinct.

## Implementation map

| Module                         | Responsibility                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------ |
| core/model.ts                  | BBIR validation, resource budgets and canonicalization                         |
| core/dsl.ts                    | Token scanner, bounded geometry macros and animation grammar                   |
| core/geometry.ts               | Hierarchical transforms, bounds and SVG preview                                |
| core/materials.ts              | Swatches, textures and deterministic baking                                    |
| core/skins.ts                  | Six fixed seeded local RGBA surface recipes                                    |
| core/quality.ts                | Technical UV coverage and coincident geometry diagnostics                      |
| core/png.ts                    | Bounded static PNG codec, CRC and filter handling                              |
| core/animation.ts              | Numeric linear/step bone sampling                                              |
| core/render.ts                 | Textured cutout rasterizer and depth/work budgets                              |
| core/uv.ts                     | Native face-corner orientation, reversal and rotation contract                 |
| core/bbmodel.ts                | Stable UUIDs, generic native codec and legacy axis migration                   |
| core/patch.ts                  | Transactional geometry edits                                                   |
| core/design.ts                 | Strict design JSON, local atlas/motion authoring and sampled rig constraints   |
| core/policy.ts                 | Caller brief, exact semantic roles and fixed production checks                 |
| core/context.ts                | Digest-bound brief/roles/constraints, native binding and verified ID remapping |
| core/reference-review.ts       | Bounded orthographic foreground-mask comparison and overlays                   |
| core/repair.ts                 | Compact selection context and scoped resource/track/texel permissions          |
| providers/index.ts             | Fixed argv/origins, stdin transport, process cleanup and doctor                |
| cli/index.ts                   | Compiler/source generation commands and workflow dispatch                      |
| cli/io.ts                      | Shared bounded file loading and atomic writes                                  |
| cli/workflow.ts                | One-request craft/refine, cache identity, local gates and reported metrics     |
| cli/workflow-commands.ts       | Author/review/refine/craft CLI options, references and model context           |
| cli/artifact.ts                | Atomic review ZIP, six views, bounded motion and checksums                     |
| cli/metrics.ts                 | Validated comparable evaluation records and reported-token summaries           |
| cli/bridge.ts                  | Authenticated loopback job protocol, lifecycle and cancellation                |
| mcp/index.ts                   | Compact local stdio adapter                                                    |
| blockbench/index.ts            | Shared compiler, paired workspace, selection/reference import and review/apply |
| scripts/release.mjs            | Standalone bundles, licenses and deterministic archives                        |
| scripts/benchmark.mjs          | Equivalent compact/expanded FXL source comparison                              |
| scripts/evaluate-workflows.mjs | Explicit cold/warm workflow capture and exact artifact comparisons             |
| scripts/generate-sentinel.mjs  | Reproducible textured knight and animation rig                                 |

Package module paths are relative to packages/*/src.

Version 1.3 adds `core/atlas.ts` (bounded face-region painting/packing), `core/rig.ts` (two-bone numeric IK/inverse rotations), `core/gif.ts` (fixed-camera bounded motion preview) and `geometry.ts:bonePoint` (actual hierarchy marker positions). `scripts/generate-paladin.mjs` authors the new atlas/rig fixture. `gifenc` is bundled runtime code; `omggif` is an independent dev-only decoder.

## Contracts

The 1.4 dragon fixture is authored in `scripts/generate-dragon.mjs` using the existing core APIs. `tests/dragon.test.mjs` checks the shipped native asset and actual posed marker/sole geometry. `scripts/package-dragon.mjs` packages only an explicit asset allowlist. Keep input references and provider drafts out of these outputs; see [dragon authoring](OBSIDIAN_DRAGON.md) for UV reuse, numeric effect limitations and regeneration commands.

BBIR 1 inputs upgrade to 2. Update runtime types, schemas, docs and tests together. JSON Schema does not enforce hierarchy, cycles, unique references or global budgets. Canonical sorts must preserve deterministic outputs.

Coordinates and pivots are absolute project space. Group pivots do not translate children. Legacy 4.10 rotation X/Y and position X signs convert to modern conventions. Retain independent migration fixtures. Native re-save may strip Formixel metadata; UUIDs then become imported IDs.

Material baking must preserve custom UVs. PNG support is static, noninterlaced RGB/RGBA8; unsupported formats fail explicitly. Rendering uses alpha cutout, without translucent blending.

Provider output is untrusted. Keep shell:false, fixed executables and argument lists, temporary working directories, bounded output and process-tree cancellation. Do not add permission bypasses, executable configuration or automatic API fallback. Wait for process close before temporary cleanup.

Default outputs use exclusive temporary files and atomic hard links. Explicit --force uses rename. Preserve overwrite protection and input/resource budgets.

Component definitions store geometry; instances create wrapper groups and preserve prototype UVs. Keep uniform-scale semantics, ordered references and both stored/expanded budgets. Tests must cover actual transforms and native roundtrip, not just instance counts.

Usage counters come from completed provider envelopes/events. Missing counts remain null. The CLI source cache is optional, keyed by provider/model/prompt/instructions and revalidated before use. Cache records contain no prompts/transcripts; do not add automatic paid retries on corruption. Test count of actual transport invocations and failed-write behavior.

## Validation and extension points

See VALIDATION.md for test coverage and host limits. MCP interoperability uses the official SDK; PNG uses an independent decoder. Desktop hosts and game-specific codecs need separate fixtures. Extend target formats with explicit constraints, keep repair workflows deliberate and scoped, and measure efficiency claims before publishing them.

Inspect current status and CI, choose a concrete gap, add integration coverage and update documentation. Preserve the source-first compiler architecture and optional MCP surface.

Reference PNGs are explicit CLI inputs. Keep byte/pixel/decompression limits, normalization and provider capability checks before cache lookup. Stage normalized bytes at a fixed temporary path, never let untrusted task fields add paths or CLI flags. Hash normalized content plus reference instructions, not the image filename. Cache hits still validate the supplied reference. Test same-path changed pixels, identical pixels at another path, task-run support and unsupported-provider rejection. Keep authored showcase evidence separate from open-ended planner quality.

For animation work, preserve the XYZ hierarchy convention and distinguish solver-local/rest values from native relative animation channels. Store a solved bind pose and subtract its offsets from baked tracks. Measure endpoints with complete parent transforms at key/intermediate times; requested angles alone are not evidence of foot/grip attachment. Keep GIF's aggregate raster/frame/pixel/output limits and absolute-boundary timing. Project actual sampled vertices for framing. Atlas packing must keep padding separate and commit only after validating the entire paint callback output.

## Production policy and scoped revisions

`parseProductionBrief` accepts explicit prop/biped/quadruped intent, floor, forward direction, airborne clips and weapon-hand requirements. `parseAnatomyRoles` resolves exact body/head/limb/sole/grip declarations. Keep those declarations separate from provider-controlled tolerances and preserve the caller brief across refinement. The default prop scope makes no articulated-character claim. These functions do not infer anatomy from names or images and cannot validate artistic fidelity.

Keep `DESIGN_INSTRUCTIONS`, the strict document parser and DESIGN.md in sync. `craft` requires complete atlas coverage and explicit constraints; local `author` supports independently optional atlas/constraint/motion sections. Do not describe permissive authoring input as a production guarantee. Sample actual transformed corners/markers, including rest, discontinuities, key intervals and final loop endpoints. Charge ancestor depth, IK and review against the shared work budgets.

Repair permission is enforced after every bounded provider response, independently of prompt wording. Selecting a group covers descendants; ancestors are context only. Shared atlas edits must protect every texel sampled by an unselected enabled face, including fractional/reversed UVs. Explicit whole-texture/material/animation selections intentionally broaden that resource's scope. Keep per-group track permission separate from complete-clip permission. Validate final resource use and reject newly introduced technical diagnostics atomically.

## Preserve model context

`createModelContext(model, { brief, roles, constraints })` produces plain versioned metadata with a SHA-256 digest of the complete canonical model. `validateModelContext` rejects stale geometry/pixels/motion, unknown metadata, missing referenced bones and malformed constraints. Failed physical checks can remain valid repair input; a changed digest cannot be accepted merely because the next operation is a repair.

`exportBBModelWithContext` embeds `formixel_context` rebound to the actual native import representation, including material baking. Review/refine automatically read that embedded context. Artifact `model.context.json` matches `model.bbir.json`; use the pair together:

```sh
npm run formixel -- review result/model.bbmodel -o native-review.json
npm run formixel -- review result/model.bbir.json --context result/model.context.json -o bbir-review.json
npm run formixel -- refine result/model.bbir.json --context result/model.context.json --select node:body/head --instruction "Raise the brow" --provider codex -o refined.zip
```

Replace the selection with an actual ID and retain the original ZIP. Plain BBIR serialization deliberately has no extra root metadata; preserve its sidecar. Design JSON retains its source authoring declarations, while the trusted caller brief belongs in model context. A review JSON report is not a context sidecar.

Editor saves may remove semantic IDs/custom fields or round numeric values. `rebindModelContext(context, source, destination, idMap)` is the explicit trusted-host API: it verifies geometry, pixels, motion and ID correspondence before remapping semantic roles/constraints and binding the destination digest. Never take an arbitrary provider-supplied mapping as authorization, and never copy a digest onto changed geometry. If the exact representation cannot be verified, reload checked roles/constraints for the current model and rerun review. Test both unchanged native serialization and edited-model rejection.

## Bridge and evidence maintenance

Keep the listener loopback-only, pairing tokens ephemeral and job schemas exact. Server-side authorization/host/origin/body limits must remain independent of plugin UI. Do not add file paths, executable arguments, arbitrary URLs or credential routes to job JSON. Stop active provider processes on bridge shutdown and preserve cancellation cleanup.

The plugin snapshots supported editor state, rejects unsupported features before provider use, requires explicit selection for refinement and validates returned native data before project creation. Keep result review separate from Apply. Test repeated submission, cancelled jobs, malformed responses, unload/timer cleanup and ID mapping. Mocks do not cover live CORS/local-network permissions or desktop behavior; record each claimed host/version with its saved/reimported artifact.

Use EVALUATION.md for exact cold/warm comparison. Cache hits make zero requests; missing provider counters stay null. Compare actual model/render hashes and physical checks, and inspect references/motion separately. Mock token values demonstrate accounting only. Claude live login is deferred; API coverage remains mocked until intentionally run with keys. Particles/emissive/PBR/target game exports remain unsupported and need independent contracts rather than relaxed import acceptance.

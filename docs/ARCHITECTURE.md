# Architecture and decisions

## Pipeline

```
description/task -> explicit provider -> untrusted FXL / design JSON / patch JSON
                                                 |
FXL / design / BBIR / supported bbmodel -> bounded validation -> canonical BBIR 2
                                                               |
                      local surfaces / numeric motion / scoped repair / review
                                                               |
                             editable bbmodel / review ZIP / PNG / GIF / SVG
```

The core runs without providers or Blockbench. CLI orchestration owns files, provider processes, explicit caches and atomic output installation. Providers return text and cannot mutate the model. The plugin shares the parser/compiler and uses the editor's native project codec; its paired workspace can submit bounded jobs to a separately started loopback CLI bridge. MCP exposes only bounded FXL source strings and does not gain provider or filesystem access.

In 1.1, the CLI validates generation options and computes a provider/model/prompt/instruction fingerprint before an optional cache lookup. A hit returns locally revalidated FXL with zero transport calls. A miss makes one provider request, captures allowlisted numeric usage, validates nonempty geometry and stores only source. No retry, provider substitution or critic request occurs. Invalid cached data fails before contacting the provider.

In 1.2 an explicitly selected PNG can accompany native Codex planning. CLI file limits and the shared bounded PNG decoder validate/normalize pixels before cache lookup. The provider receives bytes, not user-controlled path/flags, stages one fixed image file in its owned temporary directory and retains the restricted invocation. Reference instructions and normalized content extend the fingerprint. Unsupported providers fail locally. Reference pixels are not stored in source cache entries. The authored Sentinel fixture separately demonstrates deliberate atlas/rig construction through the core API.

| Package              | Responsibility                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| @formixel/core       | BBIR/FXL, geometry/assets, atlas/rig authoring, context/policy, repair, previews and native codec   |
| @formixel/providers  | Fixed native CLI invocations and optional fixed-origin API transports, bounded cancellation, doctor |
| @formixel/cli        | Bounded file/task loading, generation/repair workflows, review artifacts, metrics and loopback jobs |
| @formixel/mcp        | Three local stdio tools without files/providers                                                     |
| @formixel/blockbench | Browser compiler, source/task panel and explicitly paired modeling workspace                        |

## Design and revision workflow

The 1.5 `craft` path requests JSON with FXL in a `source` string, a complete per-part atlas plan and at least one numeric constraint. `parseDesignDocument` rejects unknown fields and resolves exact IDs. `authorDesign` packs/paints bounded face regions, optionally bakes world-target two-bone motion and reviews the actual hierarchy. `author` performs the same local authoring on an existing document without a provider. Authoring callbacks in the older atlas API remain trusted application code; provider documents cannot supply callbacks or expressions.

The caller selects `ProductionBrief` requirements: prop/biped/quadruped, floor, forward direction, airborne clips and optional one/two-hand weapon grip. Explicit semantic roles map those requirements to model bones, sole faces and grip markers. Fixed production-policy tolerances are local code. Names, image pixels and provider claims do not determine the trusted brief. The `prop` default makes no articulated-character claim. Role declarations and finite samples cannot establish anatomy recognition, continuous collision safety or artistic quality.

`refine` prepares a compact selected-part prompt with ancestor transforms, resource summaries and technical diagnostics. It omits full texture pixel arrays and unselected animation values. The returned patch is data applied to a clone. Selection enforcement protects unselected nodes, tracks and shared texture samples; whole-resource changes need explicit resource selection or exclusive ownership. The final model must pass validation and cannot introduce technical diagnostics. See [repair](REPAIR.md) for precise UV and resource rules.

Workflow cache identity includes provider/model, exact output contract/instructions, caller brief, prompt, ordered role/normalized-pixel hashes and the base-model digest for repair. A hit is reauthored/reviewed locally and makes zero generation requests. Cache records contain only validated response data, without raw prompts, references or provider events. Invalid data fails without inference retries or provider substitution.

Production output is one atomic `.zip`, `.bbmodel` or JSON installation. ZIPs contain canonical/native models, optional design, context, review/usage, six views, bounded full-clip GIFs, a local HTML index and hashes. Omitted motion previews are named in `motion.json`; render them separately when required. A failed review can still write a report before exiting 1. Provider/planning time and full command/render/package time are different measurements; [evaluation](EVALUATION.md) compares exact cached tasks and model/render hashes without assigning an artistic score.

## Portable review context

`ModelContext` stores a version, SHA-256 canonical-model digest, caller brief, semantic roles and numeric constraints. Validation checks both metadata structure and exact model identity before reuse. Failing physical constraints are valid repair input; stale or malformed declarations are not. Native exports embed `formixel_context` bound to their imported roundtrip representation, including material baking. A ZIP's `model.context.json` instead matches its canonical `model.bbir.json`.

The metadata is portable data, not a signature or proof that an independent reviewer accepted the model. `rebindModelContext` accepts a trusted native UUID map only after checking the complete source/destination representation, with bounded numeric tolerance for editor serialization. It cannot authorize a changed model by merely replacing its digest. Native editor saves may strip custom fields; callers must retain the matching sidecar or reload reviewed roles/constraints. Do not infer policy from bone names after metadata is lost.

## Paired editor boundary

`bridge` listens on a loopback address and random port with a one-session bearer token. Bounded job routes support health, create, status, cancel and result. Host/origin/auth checks and input validation stay in the server; the plugin is not an authorization boundary. Job payloads cannot choose executables, URLs, file routes, shell permissions or API credential locations. A server shutdown cancels its owned active job.

The plugin pairs only with `http://127.0.0.1:port`, imports explicitly selected reference images, snapshots supported editor state and maps selected native UUIDs to current IDs. It shows progress, requires result review, validates the native result locally and opens it as a new project on explicit Apply. The original remains available. Mocked-host tests cover these controls; current web/desktop network permissions, UI behavior and save/reopen need separate live evidence. See [Blockbench](BLOCKBENCH.md).

## Canonical BBIR 2

Root fields: version, name, free format, resolution, cubes, groups and optional materials/textures/animations. Version 1 geometry remains accepted and canonicalization upgrades it to 2. JSON Schemas are structural aids; runtime validation also checks references, hierarchy, global budgets and cross-field invariants. See schemas/bbir.v2.schema.json and core/model.ts.

Cube coordinates and group pivots are absolute project-space values. Groups are rotation/pivot hierarchies, not translation containers. Cube vertices rotate about their own origin in X/Y/Z order, then through each ancestor. This matches default ZYX Euler application. Animation adds numeric rotation/position/scale poses to bones; there is no expression evaluator.

IDs are semantic, globally unique node identifiers. FXL derives paths from nesting and deterministic macro expansion. Rename patches change labels, never IDs. Canonical arrays sort by ID; object keys sort recursively. Compiler UUIDs derive from SHA-256 of Formixel:<id>. Outputs contain no random IDs, dates or local paths.

Components are parser-owned prototypes, not new BBIR types. Instancing clones geometry into wrapper groups with prefixed IDs, translates/scales coordinates and pivots and applies the wrapper rotation. Only uniform scale is supported to preserve nested rotation semantics. Definitions are ordered, cannot recurse and have stored-node budgets in addition to final output caps. Existing numeric animation tracks can address instance group IDs. See FXL.md.

Materials bake to a stable swatch texture; custom RGBA pixels and per-face UVs remain explicit. Animation keyframes are numeric linear/step tracks. BBIR can be constructed independently of FXL; FXL is the compact authoring subset. See ASSETS.md.

Skin declarations expand to ordinary fixed-size RGBA textures and explicit proportional face UVs. Geometry and textures remain deterministic and require no additional provider call. Quality diagnostics inspect technical UV/duplicate geometry state; multi-angle PNGs expose geometry/attachment problems for human review. Neither substitutes for visual art direction.

## Deliberate constraints

FXL is a scanner/parser, with bounded AST geometry macros. No general loops, expressions, JavaScript, eval, imports or commands. All patch operations modify a clone and validate the model. Removing referenced/nonempty groups fails.

PNG uses a software depth-buffer rasterizer, nearest-neighbor textures, directional face shading and alpha cutout at 128. It samples one requested animation pose. SVG is an approximate flat-color painter preview; overlapping shapes may sort imperfectly. PNG is the primary textured preview.

The bbmodel codec supports a checked generic cuboid subset, not arbitrary archival conversion. Supported material metadata preserves its color fields; unsupported emissive/additive/layered/PBR rendering modes fail explicitly. Generic editor output does not include particles, game controllers or runtime effects. Game profiles require separate codecs and validation.

## Development and distribution

Strict TypeScript project references compile the packages. Esbuild bundles the browser bridge and standalone Node entry points; noble SHA-256 and fflate are shared runtime dependencies. Dev-only MCP SDK, Ajv and pngjs independently verify protocols, schemas and pixels. No test dependency is bundled into release runtime.

Version 1.3 adds local authored-atlas/limb APIs and GIF motion preview. `gifenc` is bundled for palette/LZW encoding; dev-only `omggif` independently validates decoded frames. A GIF request computes a fixed projected envelope across bounded sampled poses, then renders locally under an aggregate raster budget. Numeric IK is baked to the existing BBIR 2 keyframes. FXL/provider execution contracts are unchanged; authoring callbacks are trusted application code, not interpreted task text. See AUTHORING.md.

`npm run check` checks formatting, builds, packages and tests. `npm run release` produces the versioned standalone ZIP with fixed entry times, per-file hashes, bundled legal comments and dependency licenses. Generated dist files are ignored. Change contracts, schemas, provider instructions, docs and tests together. A passing mock or a generated archive is not a live-account, editor-host or public-release check. See [validation](VALIDATION.md) and [maintenance](MAINTENANCE.md).

# Architecture and decisions

## Pipeline

```
description/task JSON -> provider -> untrusted FXL
                                       |
FXL / BBIR / supported bbmodel -> local validation -> canonical BBIR 2
                                                      |
                               compile / inspect / patch / SVG or PNG
```

The core runs without providers or Blockbench. CLI orchestration owns files and atomic output installation. Providers return text and cannot mutate the model. The plugin shares the parser and compiler, then uses the editor's native project codec. MCP exposes only bounded source strings.

In 1.1, the CLI validates generation options and computes a provider/model/prompt/instruction fingerprint before an optional cache lookup. A hit returns locally revalidated FXL with zero transport calls. A miss makes one provider request, captures allowlisted numeric usage, validates nonempty geometry and stores only source. No retry, provider substitution or critic request occurs. Invalid cached data fails before contacting the provider.

In 1.2 an explicitly selected PNG can accompany native Codex planning. CLI file limits and the shared bounded PNG decoder validate/normalize pixels before cache lookup. The provider receives bytes, not user-controlled path/flags, stages one fixed image file in its owned temporary directory and retains the restricted invocation. Reference instructions and normalized content extend the fingerprint. Unsupported providers fail locally. Reference pixels are not stored in source cache entries. The authored Sentinel fixture separately demonstrates deliberate atlas/rig construction through the core API.

| Package              | Responsibility                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| @formixel/core       | BBIR/contracts, FXL, geometry, materials/PNG, animation, rendering, patches, bbmodel codec          |
| @formixel/providers  | Fixed native CLI invocations and optional fixed-origin API transports, bounded cancellation, doctor |
| @formixel/cli        | Bounded files/task loading, commands, atomic writes                                                 |
| @formixel/mcp        | Three local stdio tools without files/providers                                                     |
| @formixel/blockbench | Browser bundle, FXL import/build dialog, task export                                                |

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

The bbmodel codec supports a checked generic cuboid subset, not arbitrary archival conversion. Unsupported geometry/assets/metadata fail explicitly. Game profiles require separate codecs and validation; 1.0 exports editable editor projects.

## Development and distribution

Strict TypeScript project references compile the packages. Esbuild bundles the browser bridge and standalone Node entry points; noble SHA-256 and fflate are shared runtime dependencies. Dev-only MCP SDK, Ajv and pngjs independently verify protocols, schemas and pixels. No test dependency is bundled into release runtime.

npm run check builds, packages and tests. npm run release produces a deterministic ZIP with fixed entry times, per-file hashes, bundled legal comments and dependency licenses. Generated dist files are ignored. Change contracts, schemas, provider prompt, docs and tests together. See MAINTENANCE.md for extension seams.

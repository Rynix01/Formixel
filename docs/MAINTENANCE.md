# Maintenance guide

Formixel is a strict TypeScript npm monorepo. All packages use the @formixel namespace. The 1.1 contract is a local cuboid model compiler with compact authoring, optional planner transports and an editor bridge.

## Development

Read README.md, ARCHITECTURE.md, SECURITY.md, FXL.md and ASSETS.md. Install with npm ci --ignore-scripts and run npm run check. Release builds bundle the CLI, MCP adapter and browser plugin, then verify standalone execution and per-file hashes. Generated dist files and credentials are ignored.

## Implementation map

| Module                | Responsibility                                                  |
| --------------------- | --------------------------------------------------------------- |
| core/model.ts         | BBIR validation, resource budgets and canonicalization          |
| core/dsl.ts           | Token scanner, bounded geometry macros and animation grammar    |
| core/geometry.ts      | Hierarchical transforms, bounds and SVG preview                 |
| core/materials.ts     | Swatches, textures and deterministic baking                     |
| core/skins.ts         | Six fixed seeded local RGBA surface recipes                     |
| core/quality.ts       | Technical UV coverage and coincident geometry diagnostics       |
| core/png.ts           | Bounded static PNG codec, CRC and filter handling               |
| core/animation.ts     | Numeric linear/step bone sampling                               |
| core/render.ts        | Textured cutout rasterizer and depth/work budgets               |
| core/bbmodel.ts       | Stable UUIDs, generic native codec and legacy axis migration    |
| core/patch.ts         | Transactional geometry edits                                    |
| providers/index.ts    | Fixed argv/origins, stdin transport, process cleanup and doctor |
| cli/index.ts          | Commands, bounded input and atomic outputs                      |
| mcp/index.ts          | Compact local stdio adapter                                     |
| blockbench/index.ts   | Shared compiler and native codec bridge                         |
| scripts/release.mjs   | Standalone bundles, licenses and deterministic archives         |
| scripts/benchmark.mjs | Equivalent compact/expanded FXL source comparison               |

Package module paths are relative to packages/*/src.

## Contracts

BBIR 1 inputs upgrade to 2. Update runtime types, schemas, docs and tests together. JSON Schema does not enforce hierarchy, cycles, unique references or global budgets. Canonical sorts must preserve deterministic outputs.

Coordinates and pivots are absolute project space. Group pivots do not translate children. Legacy 4.10 rotation X/Y and position X signs convert to modern conventions. Retain independent migration fixtures. Native re-save may strip Formixel metadata; UUIDs then become imported IDs.

Material baking must preserve custom UVs. PNG support is static, noninterlaced RGB/RGBA8; unsupported formats fail explicitly. Rendering uses alpha cutout, without translucent blending.

Provider output is untrusted. Keep shell:false, fixed executables and argument lists, temporary working directories, bounded output and process-tree cancellation. Do not add permission bypasses, executable configuration or automatic API fallback. Wait for process close before temporary cleanup.

Default outputs use exclusive temporary files and atomic hard links. Explicit --force uses rename. Preserve overwrite protection and input/resource budgets.

Component definitions store geometry; instances create wrapper groups and preserve prototype UVs. Keep uniform-scale semantics, ordered references and both stored/expanded budgets. Tests must cover actual transforms and native roundtrip, not just instance counts.

Usage counters come from completed provider envelopes/events. Missing counts remain null. The CLI source cache is optional, keyed by provider/model/prompt/instructions and revalidated before use. Cache records contain no prompts/transcripts; do not add automatic paid retries on corruption. Test count of actual transport invocations and failed-write behavior.

## Validation and extension points

See VALIDATION.md for test coverage and host limits. MCP interoperability uses the official SDK; PNG uses an independent decoder. Desktop hosts and game-specific codecs need separate fixtures. Extend target formats with explicit constraints, add bounded repair workflows only as opt-in behavior, and benchmark efficiency claims before publishing them.

Inspect current status and CI, choose a concrete gap, add integration coverage and update documentation. Preserve the source-first compiler architecture and optional MCP surface.

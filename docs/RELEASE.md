# Formixel 1.3 release

## Artifact and installation

npm run release builds dist/release/formixel-1.3.0.zip and its .sha256 companion. The ZIP contains formixel.mjs, formixel-mcp.mjs, formixel.js, docs, examples, schemas, MIT project license, bundled runtime dependency licenses and checksums.json. Extract to a new directory and run node formixel.mjs --help with Node 22+. No runtime npm installation is required.

Source installation: npm ci --ignore-scripts; npm run check. Packages use the @formixel namespace, with aligned 1.3.0 versions. This repository release does not imply npm or Blockbench marketplace publication.

## Checks

npm run check performs formatting, strict compilation, plugin build, release packaging and tests. Release smoke tests verify all per-file hashes, extract to an independent temporary directory and run version/build/import/validate/animated PNG/GIF/doctor/MCP without workspace dependencies. A separate GIF decoder checks the standalone animation output. CI tests Windows and Linux on Node 22 and 24.

The archive has fixed ZIP timestamps and ordered entries. Identical source, lockfile, dependencies and runtime produce the same artifact. Compare SHA-256 before tagging; do not change a published artifact under an existing version. Release runtime bundles only core/CLI/provider/MCP dependencies, not development SDKs.

Before tagging: review git diff, check the current remote CI result, run dependency audit, review docs/VALIDATION.md and known limits, align versions/lockfile and ensure no credentials/transcripts are tracked. Push coherent source commits and the annotated version tag. Record unsupported/live-account checks accurately.

## Compiler boundary

1.3 is the local cuboid model compiler with optional planner transports and editor bridge. It includes pixels, UVs, bounded macros/components, local skin recipes, authored face atlases, a two-bone solver, numeric bone animations, technical review and deterministic PNG/GIF rendering. Usage reporting and source caching do not imply a guaranteed token reduction for every prompt or visual quality for every design. Game-specific packs, meshes and account authentication remain external workflows. Paid provider calls and marketplace publication require separate intentional use. Provider authentication/availability remains external; doctor reports it without making model requests.

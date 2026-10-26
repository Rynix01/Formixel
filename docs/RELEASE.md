# Formixel 1.5 release

## Artifact and installation

`npm run release` builds `dist/release/formixel-1.5.0.zip` and its `.sha256` companion. The ZIP contains `formixel.mjs`, `formixel-mcp.mjs`, `formixel.js`, docs, examples, schemas, the MIT project license, bundled runtime dependency licenses and `checksums.json`. Extract to a new directory and run with Node 22 or newer. No runtime npm installation is required.

```sh
node formixel.mjs --help
node formixel.mjs build examples/forest_golem.fxl -o golem.bbmodel
node formixel.mjs inspect golem.bbmodel
node formixel.mjs render golem.bbmodel -o golem.png
node formixel.mjs doctor
```

Source installation uses `npm ci --ignore-scripts`, then `npm run check`. All workspace packages use the `@formixel` namespace and aligned 1.5.0 versions. Building or pushing this repository does not publish an npm package or Blockbench marketplace entry.

## Modeling workflows

```sh
node formixel.mjs author design.json --anatomy prop -o authored.zip
node formixel.mjs craft "A quadrupedal stone guardian with a textured atlas and idle clip" --anatomy quadruped --provider codex --cache .formixel/workflows -o guardian.zip
node formixel.mjs bridge
```

`design.json` follows [DESIGN.md](DESIGN.md). Use `--references references.json` for an explicitly selected role/path PNG manifest; image planning currently requires Codex. The bridge prints its loopback address and private session token for pairing in the Blockbench Modeling workspace. Generation/refinement requires an installed, authenticated selected provider; local authoring, rendering and review do not.

Extract a workflow ZIP to inspect `preview.html`, six PNG views, the included full-clip GIFs, `motion.json`, `review.json` and checksums. It also includes `model.bbmodel`, `model.bbir.json`, the design when available and digest-bound review context. Inspect actual IDs before selecting a part:

```sh
node formixel.mjs inspect guardian/model.bbmodel
node formixel.mjs review guardian/model.bbmodel -o guardian-review.json
node formixel.mjs refine guardian/model.bbmodel --select node:body/head --instruction "Widen the brow and preserve the neck attachment" --provider codex -o guardian-refined.zip
node formixel.mjs review guardian/model.bbir.json --context guardian/model.context.json -o guardian-bbir-review.json
```

The examples assume extraction to `guardian/`; replace the selection with an existing ID. Native files carry `formixel_context` for their native roundtrip, while the ZIP sidecar matches its canonical BBIR. Context carries the caller brief, semantic roles and constraints. Stale context fails instead of silently dropping physical requirements. Editor-rewritten models may require explicit role/constraint reload; retain the original artifacts for comparison. See [maintenance](MAINTENANCE.md) for API details.

## Release checks and evidence

`npm run check` performs formatting, strict compilation, plugin build, release packaging and tests. The test harness includes independent temporary-directory extraction, per-file hash checks, CLI/MCP execution and independently decoded PNG/GIF outputs. The CI configuration covers Windows/Linux with Node 22/24. These describe the checks to run; only the recorded result at the final commit establishes a pass.

The archive uses fixed ZIP timestamps and ordered entries. Identical source, lockfile, dependencies and runtime should produce identical bytes; compare repeated SHA-256 results when validating the release. Runtime bundles exclude development test SDKs. Keep the hash alongside the exact archive and never replace an artifact under an already published version.

Before declaring 1.5.0 verified:

- Align manifests/lockfile/docs, review the diff and run `npm run check` plus the dependency audit on the final source revision.
- Confirm the new commands and context files in the extracted archive, without workspace dependencies.
- Record current native Codex craft/refine/cache/reference evidence and inspect the saved views and whole motion.
- Exercise the paired workspace in the exact web/desktop host being claimed, including cancellation, review/apply and save/reopen.
- Record commit/push and the final remote CI result. Update [VALIDATION.md](VALIDATION.md) and the [implementation ledger](IMPLEMENTATION_STATUS.md) with exact evidence.
- Keep Claude subscription generation deferred pending login and optional API coverage identified as mocked until explicitly run with keys/models.

Do not treat the older 1.4 dragon editor check, a new transport-only image request, mock provider counters or a successful package build as evidence that all new workflow/host gates passed.

## Supported boundary

1.5 adds declarative surface/rig authoring, scoped revisions, reference packs, numeric physical checks, portable model context, review ZIPs and a paired editor workspace to the existing local cuboid compiler. Anatomy requirements come from an explicit caller brief and semantic roles; finite local checks do not recognize anatomy automatically or judge artistic quality. Caching avoids exact repeated requests; it does not establish first-request quality or a general token-saving percentage.

Meshes, particles, emissive/PBR effects, Molang/controllers, translucent rendering and target game-pack codecs are unsupported. Dragon fire/smoke geometry is not particle support. Game integration, live account availability and marketplace publication each require their own evidence. API providers are intentional alternatives and never an authentication fallback.

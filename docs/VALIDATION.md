# Validation

The automated suite covers CLI file workflows and overwrite protection; malformed, executable, cyclic and oversized input; deterministic native exports; material/pixel/UV/animation roundtrips; PNG interoperability; depth and animation rendering; legacy 4.10 axis migration; transactional patches; BBIR schemas; official MCP SDK interoperability; process stdin, timeout and cancellation; mocked API envelopes; plugin lifecycle; and extracted standalone distributions with per-file hashes.

The suite grows with each contract change; use the current test runner summary instead of an older fixed count. CI is configured for Windows/Linux with Node 22/24. Dependency audit results apply to their exact lockfile revision; rerun the audit before distribution. A configured test or workflow is not a recorded pass at the current revision.

## Editor compatibility

Blockbench web 5.2.1 opened the textured forest-golem fixture with 11 cubes, four groups and both textures. Animation channels loaded. The local bridge loaded and built the same FXL fixture; invalid dimensions were rejected before creating a project. Version 1.4 adds dragon open/save/reopen evidence below; desktop-host coverage remains incomplete.

## Provider compatibility

Subprocess and mocked HTTP tests verify transport behavior. Installed CLI versions and account availability remain external compatibility requirements; run doctor and an intentional provider smoke test on each supported installation. No live paid API request is required by the suite. The compiler works offline without a provider account.

## Distribution

Standalone ZIP checks verify hashes, extraction and CLI/MCP execution without workspace dependencies. npm and marketplace publication are separate distribution steps. Keep unsupported import/export formats and account/host test limits explicit.

## Version 1.1 checks

Added coverage includes component transforms/IDs/ordered references and expansion guards; all six seeded skins with independent PNG decoding; technical UV diagnostics; orthographic culling; completed Codex events/usage; mocked API usage; cache hit/miss/corruption and invalid-output behavior; equivalent compact/expanded source; bundled browser components/skins; and extracted-release Knight/quality/front-view commands.

The earlier live editor evidence applies to the 1.0 fixture and bridge. New 1.1 components/skins have browser-bundle integration tests and native roundtrips, but a new live editor import/save/reopen check remains a separate host gate. Local previews do not prove editor compatibility or aesthetic quality.

## Version 1.2 checks

Independent UV-local-coordinate equations cover six faces, four quarter turns and reversed UV rectangles; asymmetric texture samples verify actual raster output. Reference checks cover decode/CRC/budgets, normalization, fixed image argv, unsupported providers, pixel-sensitive cache keys, same-image different-path hits, task-run behavior and corrupt-image failure before writes. The Sentinel fixture tests deterministic committed-project equivalence, embedded textures, grounded static geometry, polearm parentage, roundtrip and actual animated raster changes.

Native Codex 0.160.1 completed one image-attached smoke request with valid compact FXL and reported usage. An identical repeat returned cached source with zero generation calls. This verifies that installation's image transport, parser and cache workflow; it does not certify the artistic quality of arbitrary output. No image-API or Claude image compatibility is claimed. The authored Sentinel asset has locally inspected six-view and animation renders; its live editor import/save/reopen and gameplay compatibility are not verified here.

## Version 1.3 checks

Two-bone IK is checked with independent forward rotations, unreachable/inner-annulus targets and inverse-vector transforms. Atlas tests check actual decoded texels, edge padding, disjoint region bounds and failed-paint rollback. GIF tests use independent omggif decoding for frame contents, delay totals and a static camera anchor. Paladin checks measure actual hierarchy markers and sole orientation at key/intermediate samples, unique region density, native roundtrip and bind-pose consistency. Extracted distributions render real GIFs without an installed FFmpeg or workspace dependency tree.

These checks prove specified numerical/export behavior. They are not an artistic-quality certificate. Local front/back/side and animation-frame reviews apply to the new fixture; live editor save/reopen and game-controller tests remain unverified.

## Version 1.3.1 checks

Palm/shaft markers are distinct from wrist pivots. Both grips, all three wrist basis axes and forward forearm direction are checked at baked and half-interval samples across idle/walk/attack. The source fixture uses two hands in a diagonal forward guard, outward elbows and closed finger/thumb geometry. Relative wrist orientation is checked with independent nested forward transforms, including singular desired orientations. Local front/side views and complete motion frames are reviewed; live editor save/reopen and gameplay checks remain separate gates.

## Version 1.4 checks

The dragon fixture regenerates the committed 1,059-cuboid native asset deterministically. Tests sample reachable ankle targets, actual sole vertices at keys and between keys, downward jaw opening, tail sweep, wing raise and fire/smoke recovery. UV tests check the allocated regions, padding, physical face density and intentional same-size region reuse. Constant channels use endpoint keys; the complete six-clip fixture stays below the 10,000-key budget.

Blockbench web 5.2.1 opened, saved and reopened the textured dragon on 2026-10-11. Its editor-saved file re-imported with 1,059 cuboids, 36 groups, one embedded texture and six numeric clips. Independent regressions cover the editor's inert static texture timing fields and initialized empty bone animators, while rejecting animated UV strips and unsupported global/quaternion rotation modes. These checks do not certify desktop hosts, game effects or visual equivalence to a studio concept image. See [dragon asset](OBSIDIAN_DRAGON.md).

The standalone release imports, validates, checks UV quality and renders an airborne dragon pose outside the source checkout. Local contact sheets and GIFs use the same geometry and clips. No paid provider is required for fixture regeneration or these tests.

## Version 1.5 coverage and open gates

The current source adds the following regression areas. Their presence describes coverage; record the final integrated run and commit before reporting them as release evidence.

| Area                   | Automated checks                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design and motion      | Exact JSON fields/references, decoded atlas texels/density/padding, input immutability, deterministic output, transformed floor/contact/bend measurements, target IK through animated ancestors, bounded work and key/intermediate pose samples |
| Caller physical policy | Explicit prop/biped/quadruped brief, semantic limb/sole/grip roles, fixed tolerances, floor/forward/airborne declarations, complete transformed geometry and bounded failure reports                                                            |
| Scoped repair          | Atomic resource/geometry patches, selected descendants/ancestor context, shared UV texel protection, track isolation, resource usage and final-model validation                                                                                 |
| Model context          | Canonical digest, native material-baked roundtrip binding, exact brief/role/constraint retention, stale/unknown metadata rejection and verified ID remapping                                                                                    |
| Workflows              | One request or explicit cache hit, actual reported-or-null usage, failed-output preservation, review artifacts, six renders, bounded motion, reference overlays and checksums                                                                   |
| References/providers   | Ordered multi-image roles, PNG normalization/budgets, JSON-only output modes, capability rejection, native restrictions/cancellation, Claude subscription preflight and mocked API envelopes                                                    |
| Bridge/plugin          | Loopback/auth/origin/host checks, bounded jobs/status/cancel/result, repeated-click guard, polling cleanup, snapshot selection, image upload, local result validation and review/apply gate in a mocked host                                    |
| Evaluation/materials   | Cold/warm request accounting, exact task identity, model/render hash comparison, unknown token propagation, supported material-color roundtrip and rejection of unsupported render states                                                       |

The read-only account checks recorded in [PROVIDER_TESTING.md](PROVIDER_TESTING.md) on 2026-10-26 found native Codex 0.160.1 authenticated, Claude Code 2.1.91 without subscription authentication, and no OpenAI/Anthropic API keys. A limited native Codex smoke correctly identified ordered front/back solid-color images in JSON output. It establishes multi-image/JSON transport for that installation; it does not exercise production model craft/refinement or establish visual quality. Claude live subscription generation is explicitly deferred pending login. API tests remain mocked and make no paid requests.

| Current 1.5 gate                                                                           | Evidence status                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Final integrated `npm run check`, extracted 1.5 command/context smoke and dependency audit | 162/162 passed on Windows; standalone offline author/review/context passed; production audit: zero vulnerabilities                        |
| Real native Codex craft, scoped refine, cache repeat and rendered/motion inspection        | Craft floor faults rejected; exact four-cube repair and zero-call warm replay passed; output remains draft art                            |
| Paired Blockbench web UI, local network, cancel/review/apply and saved-model reopen        | Real Codex prop flow passed; separate mocked-transport precision fixture saved/reopened with matching context. Desktop remains unverified |
| Claude subscription generation                                                             | Deferred pending login; authentication failure makes zero inference calls                                                                 |
| Optional OpenAI/Anthropic generation                                                       | Mocked coverage only; no keys/live paid request                                                                                           |
| Runtime milestone commit/push and remote CI                                                | `c43f109` pushed; Windows/Linux on Node 22/24 all passed [run 40343758907](https://github.com/Rynix01/Formixel/actions/runs/40343758907)  |

Do not infer automatic anatomy recognition from roles supplied by a caller/provider. Numeric checks establish only the declared markers, geometry, tolerances and finite samples. Orthographic silhouette overlays use cropped plain-background foreground masks and do not register arbitrary poses/cameras or score artistic fidelity. Detail/texture/storyboard images require human visual review. Mock evaluation usage is accounting evidence, not measured live token savings.

## Independent effects and explicit export boundaries

Seeded particle documents are bound to the exact canonical model digest. Numerical tests cover seeking, loop history, attachment frames, inherited transforms, acceleration/drag, finite lifetimes and bounded work. Raster tests cover opaque-depth occlusion, deterministic ordering, straight alpha and cutout-preserving emission masks. CLI tests inspect actual PNG/GIF and linked target ZIP data. Native emissive/PBR texture states still reject: explicit sidecars are separate from generic editor texture modes.

The reproducible Copperback example is available through `node scripts/effects-demo.mjs OUTPUT.zip` after building the source checkout. It contains editable native/BBIR files, context, independent rich flame and emission documents, previews and a separate strict Bedrock burst integration example. The generic native file does not embed runtime particle behavior. Bedrock fragments require manual integration; GeckoLib4 glowmask files require the documented runtime layer. No game runtime or PBR certification is claimed.

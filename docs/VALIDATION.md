# Validation

The automated suite covers CLI file workflows and overwrite protection; malformed, executable, cyclic and oversized input; deterministic native exports; material/pixel/UV/animation roundtrips; PNG interoperability; depth and animation rendering; legacy 4.10 axis migration; transactional patches; BBIR schemas; official MCP SDK interoperability; process stdin, timeout and cancellation; mocked API envelopes; plugin lifecycle; and extracted standalone distributions with per-file hashes.

The release suite contains 50 tests. CI runs Windows/Linux with Node 22/24. Dependency audit results apply to their exact lockfile revision; rerun the audit before distribution.

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

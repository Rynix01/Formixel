# Validation

The automated suite covers CLI file workflows and overwrite protection; malformed, executable, cyclic and oversized input; deterministic native exports; material/pixel/UV/animation roundtrips; PNG interoperability; depth and animation rendering; legacy 4.10 axis migration; transactional patches; BBIR schemas; official MCP SDK interoperability; process stdin, timeout and cancellation; mocked API envelopes; plugin lifecycle; and extracted standalone distributions with per-file hashes.

The release suite contains 40 tests. CI runs Windows/Linux with Node 22/24. Dependency audit results apply to their exact lockfile revision; rerun the audit before distribution.

## Editor compatibility

Blockbench web 5.2.1 opened the textured forest-golem fixture with 11 cubes, four groups and both textures. Animation channels loaded. The local bridge loaded and built the same FXL fixture; invalid dimensions were rejected before creating a project. Desktop-host and editor save/reopen coverage are incomplete.

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

# Validation

The automated suite covers CLI file workflows and overwrite protection; malformed, executable, cyclic and oversized input; deterministic native exports; material/pixel/UV/animation roundtrips; PNG interoperability; depth and animation rendering; legacy 4.10 axis migration; transactional patches; BBIR schemas; official MCP SDK interoperability; process stdin, timeout and cancellation; mocked API envelopes; plugin lifecycle; and extracted standalone distributions with per-file hashes.

The release suite contains 35 tests. CI runs Windows/Linux with Node 22/24. Dependency audit results apply to their exact lockfile revision; rerun the audit before distribution.

## Editor compatibility

Blockbench web 5.2.1 opened the textured forest-golem fixture with 11 cubes, four groups and both textures. Animation channels loaded. The local bridge loaded and built the same FXL fixture; invalid dimensions were rejected before creating a project. Desktop-host and editor save/reopen coverage are incomplete.

## Provider compatibility

Subprocess and mocked HTTP tests verify transport behavior. Installed CLI versions and account availability remain external compatibility requirements; run doctor and an intentional provider smoke test on each supported installation. No live paid API request is required by the suite. The compiler works offline without a provider account.

## Distribution

Standalone ZIP checks verify hashes, extraction and CLI/MCP execution without workspace dependencies. npm and marketplace publication are separate distribution steps. Keep unsupported import/export formats and account/host test limits explicit.

## Version 1.1 checks

Added coverage includes component transforms/IDs/ordered references and expansion guards; all six seeded skins with independent PNG decoding; technical UV diagnostics; orthographic culling; completed Codex events/usage; mocked API usage; cache hit/miss/corruption and invalid-output behavior; equivalent compact/expanded source; bundled browser components/skins; and extracted-release Knight/quality/front-view commands.

The earlier live editor evidence applies to the 1.0 fixture and bridge. New 1.1 components/skins have browser-bundle integration tests and native roundtrips, but a new live editor import/save/reopen check remains a separate host gate. Local previews do not prove editor compatibility or aesthetic quality.

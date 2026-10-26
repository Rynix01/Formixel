# Roadmap

| Milestone      | Delivered in 1.0                                                                  |
| -------------- | --------------------------------------------------------------------------------- |
| Local compiler | FXL -> BBIR -> editable generic bbmodel, strict validation/inspection             |
| Assets         | Material swatches, static RGBA PNG, face UV/visibility, textured raster preview   |
| Language       | Nested groups, bounded mirror/repeat macros, transactional add/replace patches    |
| Rigging        | Numeric bone position/rotation/scale with linear/step interpolation               |
| Planning       | Restricted Codex CLI/Claude Code, optional explicit API providers, doctor         |
| Adapters       | Source-only MCP, Blockbench source/task panel sharing the compiler                |
| Distribution   | Standalone CLI/MCP/plugin ZIP, hashes/licenses, independent clean-directory tests |

Version 1.1 adds ordered reusable components, six seeded local surface recipes, provider-reported usage, opt-in validated source caching, technical quality reports and six PNG camera views. See EFFICIENCY.md for the 85-cuboid fixture, equivalent-source benchmark and practical review workflow.

Version 1.2 adds explicit bounded reference PNGs for native Codex, content-sensitive cache keys, corrected preview UV orientation and the authored Crimson Sentinel atlas/rig fixture. See REFERENCE_AUTHORING.md for the visual review and texture-refinement workflow. Reference support narrows the visual target but does not automatically guarantee premium art.

Version 1.3 adds per-face atlas/rig authoring APIs, a target-solved Paladin fixture and full-clip GIF review with a fixed camera. Future automated quality work should connect explicit art briefs and part-specific texture/rig plans to these bounded authoring operations. The current open-ended FXL planner does not automatically run those authored refinements or certify premium art. Authoring fixtures demonstrate a concrete local workflow, not general prompt fidelity.

Version 1.4 adds the Obsidian Crimson Dragon, deterministic atlas/rig generation, six numeric clips, attack/motion contact sheets and a separate checksummed asset pack. Its live web import/save/reopen evidence applies to that fixture and editor version.

## Version 1.5 implementation

| Area                 | Implemented scope                                                                                            | Evidence still required                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Production authoring | Declarative atlas recipes, bounded target motion, sampled geometry constraints, craft/author/review commands | Current integrated release run and rendered inspection of live provider designs             |
| Physical policy      | Caller-selected anatomy/floor/forward/grip brief with explicit semantic roles and fixed local checks         | Human review of anatomy, role declarations and whole motion; no automatic art certificate   |
| Scoped revision      | Selected nodes, protected shared texture texels, material and per-group animation patches                    | Real scoped Codex repair verified; general character refinement through UI remains open     |
| References           | Ordered one-to-eight role-tagged Codex PNG inputs and local orthographic overlays                            | Diverse reference/model visual assessment; overlays alone cannot judge fidelity             |
| Efficiency           | Reported usage/request/time accounting, opt-in workflow cache, exact artifact/model/render comparison        | Real usage/cache measurements recorded; no general savings percentage                       |
| Editor workspace     | Authenticated loopback jobs, progress/cancel, snapshot selection, review/apply gate                          | Web create/review/apply/cancel verified; desktop and full character UI corpus remain open   |
| Continuity           | Digest-bound native context and canonical sidecar; verified remapping API                                    | Browser serialization fixture save/reopen/context reload verified                           |
| Distribution         | Aligned 1.5.0 sources and versioned standalone archive build                                                 | 162 tests and four-platform CI passed; runtime commit pushed; external publication separate |

The [implementation ledger](IMPLEMENTATION_STATUS.md) distinguishes code, automated coverage, previous host evidence and open release gates. Claude subscription generation is deferred pending login; optional APIs retain mocked coverage without configured keys. Native CLI providers remain primary, with no automatic API fallback.

## Following work

Independent seeded particle simulation, PNG/GIF alpha/additive previews and emission sidecars are implemented. Explicit exports produce grayscale masks, GeckoLib4 glowmasks and a strict subset of Bedrock burst integration fragments; they require the documented game integration and are not installable game packs. PBR, complete entity codecs and game-runtime certification remain open. Existing geometric fire/smoke fixtures remain distinct from independent particle events.

Prioritize a diverse model/reference corpus, deliberate surface design, endpoint/attachment checks and whole-motion inspection. Expand native-account and editor-host coverage as installations become available. Authored component libraries and additional target codecs can follow measured workflow gaps.

No general token-reduction or artistic-quality percentage is claimed. Report exact task/provider/model/reference identity, real usage, request counts, elapsed-time scope and visual/constraint results before publishing efficiency claims.

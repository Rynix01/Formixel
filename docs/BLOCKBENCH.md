# Blockbench compiler and paired workspace

## File contract

Compiler output is a generic free cuboid project with format version 5.0, stable UUIDs, nested inline outliner groups, embedded RGB/RGBA PNG textures, explicit UV/visibility/quarter-turn UV rotations and numeric bone animations. Official implementation reference: [project codec](https://github.com/JannisX11/blockbench/blob/master/js/formats/bbmodel.js). Formixel's inline outliner was accepted by the actual 5.2.1 editor in the published dragon import/save/reopen check.

The importer accepts 4.10 and 5.0, including the modern split group table. Numeric 4.10 animation X/Y rotation and X position signs migrate to 5.0 conventions. Supported asset roundtrips retain faces, embedded pixels and numeric tracks. Material metadata is a Formixel extension; an editor re-save may discard it and semantic IDs. The workspace uses the current imported IDs, including UUIDs when the editor has removed Formixel metadata.

Unsupported content fails: meshes, external textures, indexed/grayscale/interlaced/APNG model textures, RGB transparency keys, scaled texture UV dimensions, Molang, effects/controllers, interpolation curves, display transforms, collections/texture groups, box UV, inflated/rescaled/stretched/hidden/nonexported cuboids and custom tint/cull properties. Import never fetches or reads external assets. Editor settings and unknown extension metadata are not archival state.

## Local source compilation

1. Load release `formixel.js`, or `packages/blockbench/dist/formixel.js`, through File → Plugins → Load Plugin from File.
2. Open Tools → Formixel.
3. Paste source or choose **Load FXL**. The picker also accepts a Formixel design JSON document.
4. Choose **Build FXL**. Parsing, validation, deterministic texture baking and compilation finish before editor mutation. Design documents additionally run their local authoring constraints.
5. The native project codec opens a new project with its textures and animations.

The first three actions retain their established order: Build FXL, Load FXL and Export task. Export task remains available for an offline handoff: run `formixel run formixel.task.json -o result.fxl` externally and load the result into the panel.

## Paired modeling workspace

The CLI owns provider processes and credentials. The plugin talks only to an explicitly paired loopback bridge; it never launches a provider, requests an API key, starts a listener or executes supplied programs.

1. Start `formixel bridge` in a local terminal. The CLI prints an address with a random port and a one-session pairing token.
2. Open Tools → Formixel → **Modeling workspace**.
3. Paste the printed address and pairing token, then choose **Connect**. The address must be exactly `http://127.0.0.1:port`. Remote hosts, aliases, user information and extra paths are rejected before any request.
4. Choose **Create a new model**, describe the model and select Codex CLI or Claude Code. OpenAI/Anthropic API providers are explicit alternatives and require an explicit model name; keys remain in the CLI environment.
5. Choose **Generate**. The progress field follows planning, local authoring and review. **Refresh status** performs an immediate check; **Cancel job** asks the CLI to abort the active provider operation.
6. Once ready, choose **Review result** to inspect the local technical findings and the provider's reported token counters, then return to the workspace and choose **Apply result**. Applying requires this explicit review step.
7. The result opens as a **new Blockbench project**. The original project remains available for comparison. Rendering and a human visual check are still needed to judge artistic quality.

A job makes one deliberate request or uses an explicit cache in the CLI workflow; there is no hidden retry or provider fallback. Starting a job is guarded against repeated clicks while submission is in flight. Polling starts only after an explicit job submission, uses a 1.5 second delay between checks and stops on a terminal state. After 600 checks, monitoring pauses until Refresh status is chosen. Local network or status failures stop automatic polling instead of causing a busy retry loop.

The workspace prevents closing or disconnecting while its job is active; cancel the job first. Closing a completed workspace or unloading the plugin clears the pairing token, references, pending network requests and polling timers. If the plugin itself is unloaded while a CLI job is running, its provider process can continue in the separate CLI; stop the bridge in the terminal to abort it. Credentials are kept only in the active window, are never included in an exported task and are never persisted in project data or browser storage.

## Refining selected parts

1. Select supported groups or cubes in the Blockbench outliner.
2. In the workspace, choose **Use selected parts**. This fills the current semantic or UUID identifiers and switches to **Refine selected parts**.
3. Describe the specific change and Generate.

The workspace compiles an embedded snapshot with `Codecs.project.compile({raw: false, bitmaps: true})`, imports the serialized JSON locally and verifies the selected scope before submitting the job. Using the editor's serializer preserves its saved numerical precision; raw objects can contain different floating-point tails. Group selections cover their descendants. Empty selections never silently mean the whole model. A manual comma-separated selection also accepts `node:`, `texture:`, `material:` and `animation:` resource prefixes; see [scoped repair](REPAIR.md) for shared texture and animation rules. Unsupported features in the current editor project fail locally before contacting a provider.

The UI maps actual selected node UUIDs through the native `formixel_id` metadata when present. A re-saved project can therefore use UUID identifiers without pretending that its old semantic IDs survived. Refinement is based on the snapshot submitted with the job; opening the completed result in a new project preserves edits made meanwhile to the original.

## Reference packs

Choose the role for the next image and **Add PNG reference**. The pack supports front, back, left, right, top, detail, texture/palette and animation storyboard roles. Orthographic roles are unique; detail and storyboard may repeat. **Clear references** clears the current pack.

The picker reads only the explicitly chosen local PNG. Static input images are limited to 4 MB, 4096 pixels per side and eight million pixels. Large or non-RGB/RGBA PNGs normalize through the host's image decoder and canvas to at most 512 pixels per side. Supported small RGB/RGBA PNGs use the strict local decoder. Both paths re-encode the pixels, removing metadata, and enforce a normalized one MB per-image limit. Animated PNG references are rejected. Up to eight normalized images may be attached, subject to the total bridge request limit. If the host cannot normalize a larger image, it asks for a resized RGB/RGBA PNG.

Image reference packs currently require **Codex CLI**. Selecting another provider with attached images fails clearly; the plugin does not silently drop images or change providers. A labeled concept sheet supplies visual guidance rather than ready-to-map UV pixels. Model texture decoding remains the stricter model-file contract described above.

## Bridge protocol and trust boundaries

The plugin sends `Authorization: Bearer TOKEN` to the paired loopback address. Connection uses `GET /health`; jobs use `POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel` and `GET /jobs/:id/result`. Redirects, cookies and referrers are disabled. Each network call has a 15 second deadline. Request/response bodies are bounded to 16 MB, including streamed response bytes.

A new model job contains the description, explicit provider/model and explicitly imported role-tagged PNGs. A refine job additionally contains the validated canonical snapshot and explicit selection. The bridge performs its own authorization, host/origin checks and input validation; the plugin is not an authorization boundary.

Before Apply, the plugin imports the returned native model locally, compiles the validated representation and imports it again immediately before native project loading. Server progress or a successful HTTP response alone cannot cause an unchecked model to enter the editor. Arbitrary code, file routes, shell commands and API credential paths are absent from the protocol.

## Validation evidence and host gates

`tests/plugin.test.mjs` exercises the bundled parser/build path, embedded textures, invalid-source rejection before project creation and action cleanup. `tests/bridge-plugin.test.mjs` executes the bundled workspace in a mock host and exercises pairing, a single submission under repeated clicks, scheduled/manual progress, cancellation, result validation, the review/apply gate, current selection mapping, reference uploads, endpoint rejection, API-model requirements and timer/credential cleanup.

These tests use a real bundled plugin and request/response flow with a mocked editor and HTTP peer. They do **not** establish a live browser's local-network permission or CORS behavior, nor prove the desktop host. The older published web checks covered Blockbench 5.2.1 source compilation and dragon native import/save/reopen. The new paired workspace requires a separate live web/desktop smoke check with the exact installed host and CLI version. Keep that distinction in release notes until such evidence is recorded.

Official host API references: [project codec](https://github.com/JannisX11/blockbench/blob/master/js/formats/bbmodel.js), [dialog options](https://web.blockbench.net/docs/interfaces/generated_interface_dialog.DialogOptions), [form element options](https://web.blockbench.net/docs/interfaces/generated_interface_form.FormElementOptions.html) and [file import](https://blockbench.net/wiki/docs/blockbench/).

## Portable context after editor saves

Native workflow outputs contain digest-bound `formixel_context`. The panel validates it before review. After applying a result it compares actual geometry, UVs, pixels and animation keys, remaps semantic references to preserved editor UUIDs, and reuses context only while that snapshot matches. Model changes invalidate the context. The form inherits the verified anatomy, floor, forward direction, airborne clips and grip requirement.

The editor project codec can strip unknown custom fields. Use **Export context** to save a matching `model.context.json` beside the editor-saved model; reload it with **Load rig context / roles** before further refinement. The ZIP sidecar binds to its canonical BBIR file; embedded native context is rebound separately after material baking. They are not interchangeable without proving representation equivalence. Invalid or stale context is rejected instead of silently remapping changed geometry.

On 2026-10-26 the installed 1.5 browser bundle paired with the real loopback bridge, submitted a Codex request, displayed 10 textured cuboids and one clip with zero local issues, reviewed and applied the result, and cancelled a second real provider job. The separate serialization regression used an explicitly mocked transport with zero inference calls. Its source coordinate `1.2000000000000002` became `1.2` through the editor serializer; exported context matched the actual saved file, passed local import/physical review and loaded successfully after reopening that file in Blockbench. Desktop hosts and general character refinement through the UI remain separate coverage gates.

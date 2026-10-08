# Blockbench compiler and bridge

## File contract

Compiler output is a generic free cuboid project with format_version 5.0, stable UUIDs, nested inline outliner groups, embedded RGB/RGBA PNG textures, explicit UV/visibility/quarter-turn UV rotations and numeric bone animations. Official implementation reference: [project codec](https://github.com/JannisX11/blockbench/blob/master/js/formats/bbmodel.js). Formixel's inline outliner is accepted by the actual 5.2.1 editor.

Importer accepts 4.10 and 5.0, including the modern split group table. Numeric 4.10 animation X/Y rotation and X position signs are migrated to 5.0 conventions. Supported asset roundtrips retain faces, embedded pixels and numeric tracks. Material metadata is a Formixel extension; arbitrary editor re-save may discard it and semantic IDs. After re-import, use the resulting UUID IDs for patches.

Unsupported content fails: meshes, external textures, indexed/grayscale/interlaced/APNG images, RGB transparency keys, scaled texture UV dimensions, Molang, effects/controllers, interpolation curves, display transforms, collections/texture groups, box UV, inflated/rescaled/stretched/hidden/nonexported cuboids and custom tint/cull properties. The importer does not fetch or read external assets. Editor settings and unknown extension metadata are not archival state.

## Bridge workflow

1. Load release formixel.js (or packages/blockbench/dist/formixel.js) through File > Plugins > Load Plugin from File.
2. Open Tools > Formixel.
3. Paste source or choose Load FXL.
4. Choose Build FXL. Parsing, validation, texture baking and compilation complete before editor mutation.
5. The native project codec opens a new project with textures and animation.
6. For planning, enter a description, choose a provider, optionally select a model (required for APIs), then Export task.
7. Run formixel run formixel.task.json -o result.fxl externally; load/build that source in the panel.

The plugin never launches a shell or provider, requests an API key, performs HTTP calls or starts a listener. Tasks contain version, description, provider and optional model; output paths stay under CLI user control.

Host declarations cover the reviewed public API subset. Minimum plugin host is 5.0. Actual web editor 5.2.1 was exercised: local plugin installation, Tools panel, Load FXL, Build FXL, 11 cubes/four groups/two textures, native file animation import, invalid-source rejection without project creation and uninstall/reinstall with one menu entry. Desktop behavior remains a separate smoke check; do not infer it from web success. Mock-host tests verify invalid-source rejection before project creation and action cleanup.

For future releases, test save/reopen, textured face orientation, animated pivots, task export and unload/reload in both intended hosts. When upgrading a locally loaded plugin file, uninstall the old local entry first; Blockbench may otherwise register duplicate plugin records. Keep sample fixtures and screenshot evidence with the exact host version.

The live host checks above cover the 1.0 bridge/fixture. Version 1.1 shares the new component/skin parser in the bundle and has mock-host integration coverage for instancing plus embedded PNG textures. A live import/save/reopen smoke of the 1.1 fixture remains a separate editor gate; local codec roundtrips and PNG previews do not establish that gate.

# Scoped repair and transactional patches

Formixel can revise an existing model without asking a provider to regenerate its full source, texture pixels and animation bake. A repair sends the selected geometry, transform dependencies, resource summaries and local technical diagnostics. The provider returns a JSON patch array. Formixel enforces the selection locally before returning any candidate model.

## CLI workflow

```sh
formixel refine model.bbmodel --select node:arm --instruction "Lower the arm swing and add a crimson wrist accent" --provider codex -o refined.bbmodel
formixel refine model.bbmodel --select node:head,texture:eyes --instruction "Keep the silhouette and brighten the eye highlights" --provider claude-code -o refined.zip
```

`--references references.json` supplies a reference manifest. `--cache DIR` enables the explicit provider cache. `--model NAME` chooses a provider model. `--constraints rig.json` supplies numeric rig checks where available. A refine action makes one intentional provider request; failed validation never triggers a hidden retry or another provider. CLI providers remain primary; selecting an API provider is explicit. A candidate is rendered and checked locally. A successful structural check is technical evidence, not proof that the model is visually attractive.

Use a new output path for review. The original input is never mutated by the core repair operation. Reference pictures, instructions, provider output and caches are untrusted data; they cannot provide executable JavaScript or expand shell permissions.

## Selection semantics

| Selection           | Editable content                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `node:arm` or `arm` | The node and its entire descendant subtree. Parent transforms appear as read-only context. |
| `texture:atlas`     | Intentional edits to the whole shared texture. This may affect every model part using it.  |
| `material:gold`     | Intentional edits to the shared material.                                                  |
| `animation:walk`    | Intentional edits to the complete clip, including tracks for otherwise unselected groups.  |

Prefix namespace selections when a node ID begins with one of these namespace names. Geometry and resource namespaces are separate; a material cannot be used to disguise a change to an unselected node.

Selecting a node grants whole-resource access only when **every consumer** of that material, texture or animation is in the selected subtree. A shared atlas can still be painted, but only inside selected face UV texels which no unselected enabled face samples. Reversed and fractional UV bounds protect the corresponding complete texels. A reused texture region stays protected even when another node uses the same pattern. To intentionally revise shared content, select that resource explicitly.

Associated animation access permits `set-track` and `remove-track` for selected groups. It never grants permission to replace a shared clip or edit another group's track. New clips can contain only selected group tracks unless that existing clip was explicitly selected. New geometry belongs to a selected group. Added materials and textures must be used by selected geometry at the end of the transaction.

## Core API

```js
import { prepareRepair, applyRepair } from '@formixel/core';

const request = prepareRepair(model, ['node:arm'], 'Lower the wrist by one unit');
// Send request.prompt through one explicitly chosen provider.
const candidate = applyRepair(model, JSON.parse(providerOutput), request.selection);
```

`prepareRepair()` returns `{ prompt, selection, editable, contextBytes, sourceBytes, diagnostics }`. `editable` lists node IDs, whole resource IDs and editable animation track groups. The prompt includes full selected node records, complete ancestor transforms, material colors, at most 16 spatial RGBA samples per texture, deduplicated selected UV regions and shared-use protection summaries. Animation tracks contain exact keyframes when small, or at most 12 evenly distributed samples plus the original key count. Unselected track values are omitted. An edited track must supply its complete replacement; omitted sampled keys never imply a deletion.

The provider receives **no complete texture pixel arrays**. Pixel samples and technical diagnostics do not establish artistic similarity to a reference; inspect the rendered result. Full source size is measured locally only and is not appended to the provider prompt.

Boundaries are fixed: 128 selection IDs, 512 selected nodes, 128 ancestor dependencies, 8,192 instruction UTF-8 bytes, 30,000 prompt bytes, 256 repair operations and 128,000 patch bytes. Oversized selections fail before any request. Select a smaller part rather than silently dropping dependencies. Each paint operation affects at most 4,096 texels.

## Patch format

Existing geometry operations remain available:

```json
[
  { "op": "translate", "id": "arm/hand", "offset": [0, -1, 0] },
  { "op": "rename", "id": "arm/hand", "name": "Wrist" }
]
```

`add`, `replace` and `remove` accept `kind: "cube" | "group" | "material" | "texture" | "animation"`. `kind` may be omitted for existing geometry. `add` and `replace` use a `node` containing the complete matching BBIR record, preserving the declared ID. Resources follow the same validated BBIR structures as an imported model.

```json
[
  { "op": "paint", "id": "atlas", "rect": [8, 16, 2, 2], "color": [154, 23, 34, 255] },
  {
    "op": "set-track",
    "id": "idle",
    "track": {
      "group": "arm",
      "channel": "rotation",
      "keyframes": [
        { "time": 0, "value": [0, 0, 0], "interpolation": "linear" },
        { "time": 1, "value": [-10, 0, 0], "interpolation": "linear" }
      ]
    }
  }
]
```

`paint` takes exactly one `color: [R,G,B,A]` or `pixels: [...]` field. A pixel array contains `width * height * 4` integer RGBA8 components in row order. `rect` is `[x,y,width,height]`, uses integer texels, and stays inside the referenced texture.

`set-track` replaces an existing group/channel pair or adds it. `remove-track` takes `{op,id,group,channel}`. Track channels are `rotation`, `position` and `scale`; times strictly increase within the clip and scale values stay positive. `mirror` continues to create a new cube with a unique `newId`. Materials have no name, so `rename` does not apply to them.

`PATCH_INSTRUCTIONS` exports the exact operation grammar for provider adapters. General `applyPatch()` permits up to 1,000 operations and 8,000,000 UTF-8 bytes; `applyRepair()` deliberately imposes the tighter provider limits above.

## Validation and atomicity

Every operation is plain JSON data. Unknown operations, unknown fields, accessor properties, functions, symbols, sparse arrays, cycles, excessive nesting and oversized payloads are rejected. Provider text is never evaluated. All changes apply to a clone, and the complete final model must pass BBIR validation: references exist, IDs remain unique in their namespace, hierarchy is acyclic, dimensions and RGBA bytes are bounded, and keyframes obey their timing and numeric rules. Resources may be added after their first reference within the same transaction.

`applyRepair()` also rejects newly introduced technical UV and duplicate-cuboid diagnostics and verifies that unselected geometry is unchanged. A final failure discards the candidate; no partially modified model is returned. Existing diagnostics may remain when they fall outside the requested repair. This is why constraints, preview inspection and targeted subsequent revisions remain part of a complete modeling workflow.

`tests/repair.test.mjs` covers resource creation and replacement, pixel painting, animation track changes, full-result reference failures, unknown/executable data, rollback, exact compact selected records, shared texture protection, explicit shared edits, track isolation, new-resource usage and UV regressions. It also compares scoped execution against the equivalent full-source patch result.

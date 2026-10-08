# BBScript / FXL version 1

BBScript is the language name; `.fxl` is the Formixel Language extension. Both `.fxl` and `.bbscript` are accepted. It is declarative text and never evaluated as code.

```fxl
model "stone_golem"
texture 64 64
group torso origin [0,12,0] rotate [0,0,0] {
  cube body [-6,0,-3] [12,16,6] color 2
  group head origin [0,20,0] {
    cube skull [-4,16,-4] [8,8,8] color 0
  }
}
```

Grammar, with optional brackets shown as EBNF rather than literal FXL:

```
document = "model" name, statement*;
statement = cube | group | texture | material | pattern | mirror | repeat | animation;
texture = "texture" number number;  // root only; default 64 64
cube = "cube" name vector vector ["origin" vector] ["rotate" vector] ["color" number] ["material" name] ["surface" name];
material = "material" name hex_string; // root only
pattern = "pattern" name width height hex_string hex_string; // root only
mirror = "mirror" ("x" | "y" | "z") "{" statement* "}";
repeat = "repeat" integer "offset" vector "{" statement* "}";
animation = "animation" name seconds ("loop" | "once") "{" keyframe* "}"; // root only
keyframe = ("rotate" | "move" | "scale") group_id seconds vector ["step"];
group = "group" name ["origin" vector] ["rotate" vector] "{" statement* "}";
vector = "[" number "," number "," number "]";
```

Names can be bare identifiers or JSON-quoted strings. Bare identifiers begin with a letter/underscore and contain letters, digits, underscore, dot or hyphen. Resulting node IDs must match the BBIR identifier rule (`A-Z`, `a-z`, digits, `_ . : / -`, maximum 128 characters). Use simple identifier names for cubes/groups; quoted human-readable names are useful for the model title. `#` starts a line comment outside strings. Whitespace is insignificant. Numbers support negative values, decimals and scientific notation. No semicolons. Unknown statements fail.

The second cube vector is **size**, not the opposite corner. Sizes must be positive on all axes. Coordinates are absolute project coordinates even inside groups. Rotation and origin default to zero. Optional clauses occur in the documented order. `color` selects 0..7 and defaults to 0. Colors are preview/editor indices, not texture materials.

Local budgets: input 2,000,000 UTF-8 bytes, 10,000 cubes, 1,000 groups, hierarchy depth 32, finite input coordinates with absolute value <=1,000,000; texture dimensions integer 1..8192; names up to 128 characters. IDs must be unique across cubes/groups. These are resource guards, not game format constraints.

## Patch documents

Patch is a JSON array of at most 1000 operations. Applied to a cloned BBIR model, validated, and committed only if all operations succeed. CLI output is separate by default; overwriting needs `--force`.

```json
[
  { "op": "translate", "id": "torso/body", "offset": [0, 1, 0] },
  { "op": "rename", "id": "torso/body", "name": "Torso" },
  { "op": "mirror", "id": "leg_left", "axis": "x", "newId": "leg_copy" }
]
```

`translate` supports cubes and moves from/to/origin together. `mirror` duplicates a cube with reflected bounds/origin/rotation, retains its parent and color, and requires a new unique ID. `rename` changes a display name for cube or group. `remove` removes a cube or empty group; nonempty group removal fails. Unsupported operations or invalid final models abort the entire patch.

## Assets and macros

See ASSETS.md and examples/forest_golem.fxl for full material, texture, mirror/repeat and animation examples. Patterns/materials must be declared before cubes reference them; mirror produces original/reflected copies and repeat produces 1..1000 bounded copies. Expanded geometry must fit the global budgets. FXL emits BBIR 2; old BBIR 1 remains readable.

Add patch: {op:"add",id:"new",kind:"cube" or "group",node:complete_BBIR_node}. Replace: {op:"replace",id:"existing",node:complete_BBIR_node}. The supplied node must preserve the requested ID and pass full-model validation. Referenced/nonempty groups cannot be removed. See the exported Patch union for exact types.

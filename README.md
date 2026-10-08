# Formixel

Formixel 1.1 is a CLI-first, local model compiler. A planner writes BBScript/FXL; Formixel validates the source, builds canonical BBIR, and produces editable Blockbench models. Codex CLI and Claude Code are the primary planners. OpenAI and Anthropic APIs are optional, explicitly selected providers.

The local pipeline works offline with no provider account. It supports cuboids, nested groups, rotations, materials, static RGBA textures, face UVs, symmetry/repetition, numeric bone animation, atomic patches, inspection and PNG previews. It includes a Blockbench bridge and a compact optional MCP adapter. Arbitrary meshes, Molang/effects and direct Minecraft game-pack export are outside the 1.0 compiler contract.

For a detailed textured example, see the [Elderwood Warden showcase](docs/ELDERWOOD_WARDEN.md): 246 cuboids, two custom pixel atlases, a grouped rig and three animations, tested in Blockbench web. Its trusted deterministic authoring script demonstrates the BBIR API beyond the compact FXL material subset.

New in 1.1: reusable FXL components, six local pixel surface recipes, reported provider usage, opt-in validated source cache, technical quality diagnostics and six PNG camera views. The [Ironroot Knight fixture](examples/ironroot_knight.fxl) compiles 85 cuboids from a 4212-byte source. See [efficiency and review](docs/EFFICIENCY.md) for the reproducible comparison and its limits.

## Run the release

Install Node.js 22 or newer, extract the release ZIP, then:

```sh
node formixel.mjs --help
node formixel.mjs build examples/forest_golem.fxl -o golem.bbmodel
node formixel.mjs inspect golem.bbmodel
node formixel.mjs quality golem.bbmodel
node formixel.mjs render examples/ironroot_knight.fxl --view front -o knight-front.png
node formixel.mjs render examples/forest_golem.fxl -o golem.png --animation idle --time 0.5
node formixel.mjs import golem.bbmodel -o golem.bbir.json
node formixel.mjs validate golem.bbir.json
node formixel.mjs doctor
```

The ZIP bundles runtime dependencies, the plugin, examples, schemas, docs and licenses. No npm install is needed to run it. Verify its SHA-256 file and internal checksums before distribution. Open the compiled project as a Generic Model in Blockbench 5.x. For game use, export it through the appropriate Blockbench format/plugin.

## Develop from source

```sh
npm ci --ignore-scripts
npm run check
npm run formixel -- build examples/golem.fxl -o golem.bbmodel
npm run formixel -- patch examples/golem.fxl --patch examples/golem.patch.json -o patched.bbir.json
npm run release
```

Source commands run after building. Tests also build and extract the release into an independent temporary directory and exercise the real CLI/MCP there. The CI matrix runs Windows/Linux with Node 22/24. Release output is `dist/release/formixel-1.1.0.zip`. `npm run benchmark` checks equivalent compact/expanded FXL and reports source bytes, not token estimates.

## Plan a model

Authenticate the separately installed native CLI yourself, then:

```sh
node formixel.mjs generate "A forest knight with a strong silhouette" --provider codex --cache .formixel/cache -o generated.fxl
node formixel.mjs generate "A small textured stone golem" --provider claude-code -o generated.fxl
node formixel.mjs build generated.fxl -o generated.bbmodel
```

Optional API: set OPENAI_API_KEY or ANTHROPIC_API_KEY in your environment and select `--provider openai --model YOUR_MODEL` or `--provider anthropic --model YOUR_MODEL`. Formixel makes one request and validates the response locally before saving. It never falls back to paid APIs, retries automatically, grants broad shell permissions or evaluates generated text. Windows providers must be native executables; command-shell wrappers are deliberately unsupported. `doctor` checks installation/auth status without generating or spending tokens.

Provider transports have subprocess and mocked HTTP tests. Check installation/account compatibility with doctor and a provider smoke test; see [validation](docs/VALIDATION.md).

Generation prints actual provider-reported usage when available. Matching cache hits make zero generation requests and still run local validation. Omit `--cache` for new variations. Texture recipes and geometry expansion run locally; no automatic critique or repair requests are made. Valid syntax and clean technical diagnostics do not guarantee visual quality.

Use `--force` to replace an existing output. CLI failures exit 1 and preserve existing output. Inputs are bounded; unsupported import features produce errors.

See [language](docs/FXL.md), [assets/animation](docs/ASSETS.md), [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [providers](docs/PROVIDERS.md), [Blockbench](docs/BLOCKBENCH.md), [MCP](docs/MCP.md), [release](docs/RELEASE.md) and [maintenance guide](docs/MAINTENANCE.md).

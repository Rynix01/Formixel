# Provider integration testing

Invalid provider output must fail local validation without replacing an existing model. Errors never select another provider, relax permissions, retry automatically or spend through API fallback. Keep transport tests, live account checks, model validation and artistic assessment separate.

## Offline coverage

Provider/reference/multireference tests cover:

- Literal stdin, fixed restricted argv, response/timeout bounds and process-tree termination.
- PNG integrity/pixel/byte/count bounds, semantic roles, normalized staging, attachment order and cleanup.
- Capability rejection before transport, JSON-only design/patch contracts and native/HTTP cancellation.
- Codex completion events, Claude success/error/tool-denial envelopes and reported usage, including Anthropic cache-read/write input totals.
- Claude subscription preflight and removal of environment API credentials/third-party billing toggles.
- Optional HTTP request/envelope behavior using mocks, without paid calls.

Process/fetch injection is a trusted test hook, not a task-file executable, URL or shell override. Run npm run check after integration; passing transport tests alone does not establish model/workflow correctness.

## Account evidence

Read-only doctor on 2026-10-26 found:

| Provider      | Local evidence                                   | Live generation gate                                                                                 |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Codex         | Native codex-cli 0.160.1, authenticated          | Earlier generation/build/import/render passed; record new workflow/pack checks with their artifacts. |
| Claude Code   | Native 2.1.91, subscription authentication false | Subscription login required; zero inference calls made without it.                                   |
| OpenAI API    | No OPENAI_API_KEY configured                     | Explicit API/key/model selection and intentional paid smoke test required.                           |
| Anthropic API | No ANTHROPIC_API_KEY configured                  | Explicit API/key/model selection and intentional paid smoke test required.                           |

A new native Codex smoke attached two 32x32 solid-color images with front/back roles and requested JSON-only design output. It correctly returned frontColor red and backColor green in one generation: 10,309 input tokens, 8,192 cached input tokens, 15 output tokens and 16,538 ms elapsed. This verifies actual multi-image ordering and JSON transport for the installed CLI; it is not a model-quality or token-saving benchmark. Native input includes CLI context beyond Formixel's instruction bytes. Private output: work/next-provider-smoke/summary.json (not bundled).

Flag review found that Claude bare mode disables subscription credentials and expects API authentication. The adapter now retains OAuth while disabling tools/settings/hooks/skills/MCP and removing API-billing environment values. Authentication absence is reported accurately. Offline fixtures do not prove an authenticated Claude session. Administrator-managed policy remains effective.

## Deliberate live smoke

Authenticate the separately installed native CLI outside Formixel, run doctor and choose unused private output filenames:

```sh
node packages/cli/dist/index.js doctor codex
node packages/cli/dist/index.js generate "A small moss guardian with nested torso/head groups and numeric idle animation" --provider codex -o guardian.fxl
node packages/cli/dist/index.js build guardian.fxl -o guardian.bbmodel
node packages/cli/dist/index.js validate guardian.bbmodel
node packages/cli/dist/index.js import guardian.bbmodel -o guardian.bbir.json
node packages/cli/dist/index.js render guardian.fxl --animation idle --time 0.5 -o guardian.png
```

Repeat only with an explicitly selected authenticated provider. For packs, use multiple role-labeled views and verify each role's distinguishing feature survives output/local compilation. Keep model/usage summaries separate from reference files, raw events and account bodies. Do not use an API because native login is unavailable.

For visual validation, open the compiled model in Blockbench and inspect front/side/back and animation extrema. Record the exact host version and saved/reimported artifact. Authentication plus valid FXL does not establish artistic quality.

## Current production-policy and scoped repair smoke (2026-10-26)

Native Codex 0.160.1 with the explicitly selected gpt-6-astra model and five normalized role references made one craft request. It reported 13,033 input / 8,567 output tokens (0 cached; 484 reasoning output), taking 234.4 seconds. Full texture coverage and all 13 provider-declared constraints passed; independent quadruped policy rejected four rotated shin cuboids crossing the trusted floor. Rejected output was not cached.

One separately requested refine call selected exactly those four cuboids. It reported 14,763 input / 927 output tokens and took 26.8 seconds. Only their local lower Y bounds changed from -0.2 to 0. Other geometry, pixels, animation, roles and constraints stayed identical. Fixed policy passed 52 sampled poses; full-model minimum Y was 0. A matched warm replay made zero provider calls, returned unknown/null token counters and matched canonical model, native artifact, six views and motion bytes. This is scoped-repair/cache evidence, not a general token-saving percentage.

Visual inspection still classifies the output as a blocky draft below the premium concept target. Neither a local pass nor this smoke certifies artistic quality. Private prompts, provider responses, account records and reference pixels are excluded from the repository.

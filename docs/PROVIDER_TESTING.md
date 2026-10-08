# Provider integration testing

Provider output is validated locally before saving. Invalid animation targets, malformed source and resource-budget violations must fail without replacing existing files. A failed request does not trigger another provider, relaxed permissions or a paid API fallback.

## Local smoke test

Authenticate the separately installed native CLI, run doctor, and choose unused output filenames:

```sh
node packages/cli/dist/index.js doctor codex
node packages/cli/dist/index.js generate "A small moss guardian with nested torso/head groups and numeric idle animation" --provider codex -o guardian.fxl
node packages/cli/dist/index.js build guardian.fxl -o guardian.bbmodel
node packages/cli/dist/index.js validate guardian.bbmodel
node packages/cli/dist/index.js import guardian.bbmodel -o guardian.bbir.json
node packages/cli/dist/index.js render guardian.fxl --animation idle --time 0.5 -o guardian.png
```

Generation is nondeterministic. Supply exact hierarchical group IDs when an animation references a nested group. Use examples/moss_guardian.fxl to exercise the local compiler without another provider request.

## Compatibility scope

Native Codex CLI 0.160.1 has completed the generation/build/import/render workflow. This does not establish compatibility with every version, account or prompt. Claude Code and paid API integrations require their own live-account smoke checks. Transport tests use fixed restrictive flags and mocked API endpoints; test coverage does not establish visual design quality.

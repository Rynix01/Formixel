# Workflow evaluation

Run the same explicit task once against its selected provider, then repeat it from a fresh validated local cache. The evaluator records reported tokens, workflow time, whole-command time, local texture/rig checks and exact model/render hashes. It does not assign an artistic score or claim that independent generations have equal quality.

```json
{
  "version": 1,
  "iterations": 2,
  "tasks": [
    {
      "id": "dragon",
      "provider": "codex",
      "model": "YOUR_EXPLICIT_MODEL",
      "prompt": "A quadrupedal obsidian dragon with crimson wings, ivory horns, green eyes and gold chest armor. Include a textured atlas, rig constraints and a readable idle animation.",
      "timeoutMs": 120000,
      "references": [
        { "role": "front", "path": "front.png" },
        { "role": "right", "path": "right.png" }
      ]
    }
  ]
}
```

Omit references for text-only tasks. Native CLI model names depend on account access; replace the placeholder deliberately. Models and providers are mandatory in evaluation manifests. A maximum of eight tasks and three iterations per task is accepted. Reference limits and provider capabilities apply before any call. Unknown fields cannot select executables, URLs, shell permissions or fallback providers.

```sh
npm run build
node scripts/evaluate-workflows.mjs /absolute/private/evaluation.json /absolute/private/new-results
```

The output directory must not exist; its parent must exist. This makes each task's first iteration a cold cache. Tasks run sequentially using the current Node executable and fixed Formixel craft arguments, without a shell. Each task's first iteration makes one generation request. Later iterations must hit that same task's cache and make zero requests. Failure stops the run, preserves evidence and writes failure.json; no inference retry or provider fallback is attempted. Selecting an optional API in this manifest is an intentional paid run with that API/model/key, never an automatic replacement for CLI authentication.

## Evidence

Each task produces cold.zip and optional warm-1.zip/warm-2.zip. They contain editable models, front/back/side/top/isometric PNGs, motion previews and review.json. Artifact checksums are verified before recording metrics. Records contain prompt/reference hashes, not prompt or raw provider event text. Reference pixels are normalized and staged locally to make their inputs immutable during the comparison; keep the evaluation directory private. It is not a release fixture folder.

Summary fields distinguish:

- Provider requests from cache hits. A cache hit's inference token count is known to be zero, even though its provider usage field is null.
- Actual reported total input, cache-read input, non-cache-read input and output. Anthropic/Claude totals include cache creation. Cache-write pricing is not modeled.
- Workflow elapsed time from total child-command time, which additionally includes rendering and packaging. Negative comparison time means the repeat was faster in this observation, not a latency guarantee.
- Model hashes from six rendered-view and motion hashes. A favorable token count cannot hide changed geometry, textures or animation.
- Local UV/rig/constraint pass results from artistic fidelity. Any local review failure or deterministic model/render mismatch makes the evaluation fail.

Unavailable counts propagate as null. Token-reduction percentages are emitted only when a reported positive cold-input denominator exists; they describe avoiding that exact repeated request, not a smaller prompt being equally capable. No estimated tokens from source bytes, bill amounts or guessed reasoning counts are inserted. Comparisons reject changed prompts, reference roles/order/pixels, provider/model or instruction fingerprints, duplicate iterations and stale usage attached to cache hits.

Use summarizeEvaluations from packages/cli/dist/metrics.js to evaluate previously captured bounded records. Inputs are validated and limited to 24 records. The evaluator's own tests use a mocked provider with the real authoring/cache/render/artifact pipeline and make no paid API request. Provider mock counters demonstrate accounting behavior, not measured live model savings. Record actual live evidence separately in PROVIDER_TESTING.md and VALIDATION.md.

For a broader quality study, evaluate a diverse corpus, inspect every saved view/motion against the corresponding references and record human acceptance separately. Cold-versus-warm caching alone cannot prove improvements in first-request design quality, generalization or artistic fidelity.

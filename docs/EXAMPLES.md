# Production authoring example

[`examples/armored-sentinel.design.json`](../examples/armored-sentinel.design.json) describes the **Copperback Sentinel**, a compact plated quadruped. Its complete source is editable FXL inside strict JSON; it needs no provider, external texture, script, or network connection.

The asset has 50 cuboids, 19 groups, and one two-second looping `alert` animation. Oxidized teal shell plates sit over a dark scaled body, with copper joint collars, amber eyes, and ivory teeth. The alert motion turns the head, opens its hinged jaw, flicks one ear, and swings the two-part tail while all four feet remain planted. It demonstrates an alert pose, not a walk cycle.

The authoring data declares:

- A deterministic 256 × 128 atlas at three texels per unit, six material recipes, complete coverage of all 300 faces, and an underside face override.
- Exact body/head roles and four distinct upper → shin → foot leg chains. Each bone owns visible geometry; each foot owns a real downward sole face.
- Four locked sole contacts, four sole orientation checks, four knee direction checks, whole-model floor clearance, and an attached jaw hinge. These 14 constraints inspect the rest pose and the animation.

## Run from the standalone release

Extract the release ZIP into a fresh directory and run these commands there with Node.js 22 or newer:

```sh
node formixel.mjs author examples/armored-sentinel.design.json --anatomy quadruped -o sentinel.zip
```

The caller supplies `--anatomy quadruped`. Anatomy selection and production tolerances are not accepted from the design document. The trusted production policy independently measures the real geometry, hierarchy, feet, limb lengths, support, and knee directions.

Extract `sentinel.zip` and inspect `preview.html`, its six PNG views, and `motion-0.gif`. The package also contains the editable native model, BBIR, original design, context, checksums, and review report. Review the exported forms using:

```sh
node formixel.mjs review model.bbmodel
node formixel.mjs review model.bbir.json --context model.context.json
```

Native `.bbmodel` embeds its bound context. BBIR uses `model.context.json` explicitly. Both preserve the caller's anatomy brief, exact semantic roles, and physical constraints; a changed model with an old context is rejected. The JSON review is written to standard output, and violations produce a nonzero exit status.

## Reproduce the regression

From the repository root:

```sh
npm run release
node --test tests/author-release.test.mjs
```

The regression extracts the actual standalone release outside the checkout, disables networking and provider subprocess execution, authors this design, verifies archive hashes and rendered animation, then reviews both native embedded context and BBIR with its sidecar. It also checks that selecting incompatible anatomy or reusing stale context returns a failure status.

The checks establish reproducible textured output and finite physical validation. Visual inspection is still needed for artistic decisions, game integration, and motion outside the sampled instants. See [DESIGN.md](DESIGN.md) for the authoring schema and physical review limits.

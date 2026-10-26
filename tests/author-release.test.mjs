import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { GifReader } from 'omggif';
import {
  authorDesign,
  validateProductionPolicy,
  validateModelContext,
  importBBModel,
  geometry,
  sampleAnimation,
} from '../packages/core/dist/index.js';

const example = 'examples/armored-sentinel.design.json';

test('Copperback Sentinel has painted surfaces, real anatomy and a moving hinged jaw', async () => {
  const design = JSON.parse(await readFile(example, 'utf8'));
  const { model, report } = authorDesign(design);
  assert.equal(model.cubes.length, 50);
  assert.equal(model.groups.length, 19);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
  assert.equal(report.atlas.coveredCubes, 50);
  assert.equal(report.atlas.faces, 300);
  assert.equal(design.authoring.roles.limbs.length, 4);
  assert.equal(design.authoring.constraints.length, 14);
  assert.equal(
    validateProductionPolicy(model, design.authoring.roles, { anatomy: 'quadruped' }).passed,
    true,
  );
  assert.equal(
    validateProductionPolicy(model, design.authoring.roles, { anatomy: 'biped' }).passed,
    false,
    'the caller-selected anatomy must not be inferred from provider role names',
  );
  const atlas = model.textures.find((texture) => texture.id === 'formixel_design_atlas');
  const rgba = new Set();
  for (let offset = 0; offset < atlas.pixels.length; offset += 4)
    if (atlas.pixels[offset + 3]) rgba.add(atlas.pixels.slice(offset, offset + 4).join(','));
  assert.ok(rgba.size > 100, 'recipes must paint actual varied RGBA texels');
  const rest = geometry(model);
  const animated = geometry(model, sampleAnimation(model, 'alert', 0.5));
  const cube = (cubes, id) => cubes.find((part) => part.id === id).vertices;
  const restJaw = cube(rest, 'body/head/jaw/mandible');
  const movingJaw = cube(animated, 'body/head/jaw/mandible');
  assert.ok(
    Math.hypot(...restJaw[0].map((value, axis) => value - movingJaw[0][axis])) > 0.5,
    'the alert clip must change rendered jaw geometry',
  );
  for (const limb of design.authoring.roles.limbs)
    assert.deepEqual(cube(animated, limb.sole.cube), cube(rest, limb.sole.cube));
});

test('installed standalone CLI authors and reviews textured anatomy offline with portable context', async () => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const release = unzipSync(await readFile(`dist/release/formixel-${version}.zip`));
  const root = await mkdtemp(join(tmpdir(), 'formixel-author-release-'));
  const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
  try {
    assert.ok(release[example], 'the standalone release must ship the declarative example');
    for (const [name, bytes] of Object.entries(release)) {
      assert.ok(!name.includes('..') && !name.startsWith('/') && !name.includes('\\'));
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), bytes);
    }
    // Run with networking and child-provider execution disabled in the installed process.
    await writeFile(
      join(root, 'offline.mjs'),
      `import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const blocked = () => { throw new Error('Offline author/review attempted network or provider execution'); };
globalThis.fetch = blocked;
globalThis.WebSocket = blocked;
for (const module of [http, https]) { module.request = blocked; module.get = blocked; }
net.connect = net.createConnection = tls.connect = blocked;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = blocked;
syncBuiltinESMExports();
`,
    );
    const run = (args, expectedStatus = 0) => {
      const result = spawnSync(
        process.execPath,
        ['--import', './offline.mjs', 'formixel.mjs', ...args],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      return result;
    };
    const authored = run(['author', example, '--anatomy', 'quadruped', '-o', 'sentinel.zip']);
    const summary = JSON.parse(authored.stdout);
    assert.equal(summary.review.policy.anatomy, 'quadruped');
    assert.equal(summary.review.policy.passed, true);
    assert.equal(summary.review.rig.passed, true);
    assert.deepEqual(summary.review.technical.issues, []);
    const files = unzipSync(await readFile(join(root, 'sentinel.zip')));
    for (const name of [
      'model.bbmodel',
      'model.bbir.json',
      'model.context.json',
      'model.design.json',
    ])
      assert.ok(files[name], `author output must include ${name}`);
    const checksums = json(files['checksums.json']);
    for (const [name, expected] of Object.entries(checksums.files))
      assert.equal(createHash('sha256').update(files[name]).digest('hex'), expected);
    const design = json(files['model.design.json']);
    assert.deepEqual(design, json(release[example]));
    const bbir = json(files['model.bbir.json']);
    const native = json(files['model.bbmodel']);
    const sidecar = json(files['model.context.json']);
    const nativeContext = validateModelContext(importBBModel(native), native.formixel_context);
    validateModelContext(bbir, sidecar);
    for (const context of [sidecar, nativeContext]) {
      assert.deepEqual(context.brief, { anatomy: 'quadruped' });
      assert.deepEqual(context.roles, design.authoring.roles);
      assert.deepEqual(context.constraints, design.authoring.constraints);
      assert.match(context.modelDigest, /^[a-f0-9]{64}$/);
    }
    const storedReview = json(files['review.json']).review;
    assert.deepEqual(storedReview, summary.review);
    assert.equal(storedReview.technical.textureCoverage, 1);
    assert.equal(storedReview.technical.texturedFaces, 300);
    assert.equal(PNG.sync.read(Buffer.from(files['isometric.png'])).width, 256);
    assert.deepEqual(json(files['motion.json']).clips, ['alert']);
    assert.equal(new GifReader(Buffer.from(files['motion-0.gif'])).numFrames(), 12);
    for (const name of ['model.bbmodel', 'model.bbir.json', 'model.context.json'])
      await writeFile(join(root, name), files[name]);
    const nativeReview = JSON.parse(run(['review', 'model.bbmodel']).stdout);
    const bbirReview = JSON.parse(
      run(['review', 'model.bbir.json', '--context', 'model.context.json']).stdout,
    );
    assert.deepEqual(nativeReview.context, nativeContext);
    assert.deepEqual(bbirReview.context, sidecar);
    const { atlas, motions, ...storedRig } = storedReview.rig;
    assert.equal(atlas.faces, 300);
    assert.deepEqual(motions, []);
    assert.deepEqual(bbirReview.review, { ...storedReview, rig: storedRig });
    for (const review of [nativeReview.review, bbirReview.review]) {
      assert.equal(review.policy.passed, true);
      assert.equal(review.policy.anatomy, 'quadruped');
      assert.equal(review.policy.issueCount, 0);
      assert.equal(review.rig.passed, true);
      assert.equal(review.rig.checks.length, 14);
      assert.deepEqual(review.technical, storedReview.technical);
    }
    assert.deepEqual(nativeReview.review.policy, bbirReview.review.policy);
    assert.deepEqual(nativeReview.review.rig, bbirReview.review.rig);
    const mismatch = run(['review', 'model.bbmodel', '--anatomy', 'biped'], 1);
    assert.equal(JSON.parse(mismatch.stdout).review.policy.passed, false);
    assert.match(mismatch.stderr, /Review found violations/);
    const stale = structuredClone(bbir);
    stale.cubes[0].from[1] += 0.01;
    await writeFile(join(root, 'stale.bbir.json'), JSON.stringify(stale));
    assert.match(
      run(['review', 'stale.bbir.json', '--context', 'model.context.json'], 1).stderr,
      /Stale model context/,
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

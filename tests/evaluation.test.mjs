import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, zipSync } from 'fflate';
import { summarizeEvaluations } from '../packages/cli/dist/metrics.js';
import { executeWorkflow } from '../packages/cli/dist/workflow.js';
import { workflowArtifact } from '../packages/cli/dist/artifact.js';
import {
  validateEvaluationManifest,
  runEvaluation,
  readEvaluationArtifact,
} from '../scripts/evaluate-workflows.mjs';

const h = (letter = 'a') => letter.repeat(64);
const views = Object.fromEntries(
  ['isometric', 'front', 'back', 'left', 'right', 'top'].map((v) => [v + '.png', h()]),
);
const record = (
  iteration = 0,
  counters = {
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 30,
    reasoningOutputTokens: null,
  },
) => ({
  task: {
    id: 'dragon',
    promptHash: h(),
    referenceHash: h('b'),
    provider: 'codex',
    model: 'test-model',
  },
  iteration,
  wallElapsedMs: iteration ? 25 : 300,
  metrics: {
    version: 1,
    kind: 'craft',
    provider: 'codex',
    model: 'test-model',
    requests: iteration ? 0 : 1,
    cacheHit: iteration > 0,
    usage: iteration ? null : counters,
    promptBytes: 100,
    instructionBytes: 1000,
    referenceBytes: 0,
    responseBytes: 500,
    elapsedMs: iteration ? 5 : 250,
    fingerprint: h('c'),
  },
  review: {
    policy: { passed: true, anatomy: 'prop', issueCount: 0, issues: [], samples: 1 },
    technical: { textureCoverage: 1, untexturedFaces: 0, issues: [] },
    rig: {
      passed: true,
      issueCount: 0,
      issues: [],
      checks: [{ constraint: 'floor', passed: true }],
    },
  },
  modelHash: h('d'),
  renderHashes: { ...views },
});

test('evaluation accounts actual cache savings and propagates unknown token counters without guessing', () => {
  const report = summarizeEvaluations([record(), record(1), record(2)]);
  assert.equal(report.passed, true);
  const task = report.tasks[0];
  assert.equal(task.requests, 1);
  assert.equal(task.totals.inputTokens, 100);
  assert.equal(task.totals.outputTokens, 20);
  assert.equal(task.totals.cachedInputTokens, 30);
  assert.equal(task.totals.reasoningOutputTokens, null);
  assert.equal(task.comparisons[0].inputTokenReductionPercent, 100);
  assert.equal(task.comparisons[0].inputTokensAvoided, 100);
  assert.equal(task.comparisons[0].requestsAvoided, 1);
  assert.equal(task.comparisons[0].sameRenders, true);
  const unknown = summarizeEvaluations([record(0, null), record(1)]).tasks[0];
  assert.equal(unknown.totals.inputTokens, null);
  assert.equal(unknown.comparisons[0].inputTokenReductionPercent, null);
  assert.equal(unknown.comparisons[0].inputTokensAvoided, null);
  assert.match(report.scope, /no aesthetic score/);
});

test('comparisons reject changed task/provider/model/reference/contract identities and false cache accounting', () => {
  for (const mutate of [
    (v) => {
      v.task.promptHash = h('e');
    },
    (v) => {
      v.task.referenceHash = h('e');
    },
    (v) => {
      v.task.provider = v.metrics.provider = 'claude-code';
    },
    (v) => {
      v.task.model = v.metrics.model = 'changed';
    },
    (v) => {
      v.metrics.fingerprint = h('e');
    },
    (v) => {
      v.metrics.usage = record().metrics.usage;
    },
    (v) => {
      v.iteration = 2;
    },
  ]) {
    const changed = record(1);
    mutate(changed);
    assert.throws(() => summarizeEvaluations([record(), changed]));
  }
  assert.throws(() => summarizeEvaluations([record(), record()]));
  assert.throws(() =>
    summarizeEvaluations([
      record(0, {
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 11,
        reasoningOutputTokens: null,
      }),
    ]),
  );
  assert.throws(() => summarizeEvaluations([{ ...record(), arbitrary: 'untrusted extra' }]));
});

test('model/render/constraint changes remain visible even when all token counters appear favorable', () => {
  const modelChanged = record(1);
  modelChanged.modelHash = h('e');
  assert.equal(summarizeEvaluations([record(), modelChanged]).passed, false);
  const imageChanged = record(1);
  imageChanged.renderHashes['front.png'] = h('e');
  assert.equal(summarizeEvaluations([record(), imageChanged]).passed, false);
  const fault = record();
  fault.review.rig.passed = false;
  fault.review.rig.issueCount = 1;
  fault.review.rig.issues = [{ value: -1 }];
  fault.review.rig.checks[0].passed = false;
  assert.equal(summarizeEvaluations([fault]).passed, false);
  const noMotionEvidence = record();
  delete noMotionEvidence.review.rig;
  assert.throws(() => summarizeEvaluations([noMotionEvidence]), /rig constraints/);
});

test('bounded evaluation manifests require explicit selection and reject executable/URL/permission overrides', () => {
  const base = {
    version: 1,
    iterations: 2,
    tasks: [{ id: 'plate', provider: 'codex', model: 'test-model', prompt: 'A plate' }],
  };
  assert.equal(validateEvaluationManifest(base), base);
  for (const value of [
    { ...base, iterations: 4 },
    { ...base, fallback: 'openai' },
    { ...base, tasks: new Array(9).fill(base.tasks[0]) },
    { ...base, tasks: [{ ...base.tasks[0], executable: 'powershell' }] },
    { ...base, tasks: [{ ...base.tasks[0], provider: 'unknown' }] },
    { ...base, tasks: [{ ...base.tasks[0], model: undefined }] },
    { ...base, tasks: [{ ...base.tasks[0], id: 'CON' }] },
    { ...base, tasks: [base.tasks[0], { ...base.tasks[0], id: 'PLATE' }] },
  ])
    assert.throws(() => validateEvaluationManifest(value));
});

test('evaluation runner uses actual workflow/cache/render artifacts with fixed argv and no inference retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formixel-evaluation-'));
  const manifest = join(directory, 'manifest.json'),
    output = join(directory, 'results');
  const prompt = 'A metal plate; $(never run a shell)';
  const cache = new Map();
  let calls = 0,
    processes = 0;
  const design = {
    version: 1,
    source: 'model eval_plate group body { cube plate [-2,0,-1] [4,4,2] }',
    authoring: {
      atlas: {
        size: [32, 32],
        texelsPerUnit: 1,
        recipes: [{ id: 'metal', kind: 'metal', base: '#303644', accent: '#cfaa62', detail: 0.6 }],
        parts: [{ cubes: ['body/plate'], recipe: 'metal' }],
        requireCoverage: true,
      },
      constraints: [
        { id: 'floor', type: 'ground', cubes: ['body/plate'], floor: 0, tolerance: 0.001 },
      ],
    },
  };
  try {
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        iterations: 2,
        tasks: [{ id: 'plate', provider: 'codex', model: 'test-model', prompt }],
      }),
    );
    const summary = await runEvaluation(manifest, output, {
      run: async (executable, args, stdin) => {
        processes++;
        assert.equal(executable, process.execPath);
        assert.equal(args[1], 'craft');
        assert.equal(args[2], prompt);
        assert.equal(stdin, '');
        const result = await executeWorkflow(
          { kind: 'craft', provider: 'codex', model: 'test-model', prompt },
          {
            provider: {
              name: 'codex',
              generate: async (request) => {
                calls++;
                request.onUsage({
                  inputTokens: 140,
                  outputTokens: 70,
                  cachedInputTokens: 40,
                  reasoningOutputTokens: null,
                });
                return JSON.stringify(design);
              },
            },
            cache: {
              read: async (key) => cache.get(key),
              write: async (key, value) => {
                cache.set(key, value);
              },
            },
          },
        );
        await writeFile(
          args[args.indexOf('-o') + 1],
          workflowArtifact(result.model, {
            metrics: result.metrics,
            review: result.review,
            design: result.design,
          }),
        );
        return '';
      },
    });
    assert.equal(calls, 1);
    assert.equal(processes, 2);
    assert.equal(summary.passed, true);
    assert.equal(summary.tasks[0].comparisons[0].sameModel, true);
    assert.equal(summary.tasks[0].comparisons[0].sameRenders, true);
    const saved = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'));
    assert.deepEqual(saved, summary);
    assert.ok(!(await readFile(join(output, 'records.json'), 'utf8')).includes(prompt));
    const archive = unzipSync(await readFile(join(output, 'plate', 'cold.zip')));
    archive['front.png'][20] ^= 1;
    const bad = join(directory, 'bad.zip');
    await writeFile(bad, zipSync(archive));
    await assert.rejects(readEvaluationArtifact(bad), /checksum/);
    await assert.rejects(runEvaluation(manifest, output), /EEXIST/);
    let failures = 0;
    const failed = join(directory, 'failed');
    await assert.rejects(
      runEvaluation(manifest, failed, {
        run: async () => {
          failures++;
          throw new Error('native login missing');
        },
      }),
      /login/,
    );
    assert.equal(failures, 1);
    assert.deepEqual(JSON.parse(await readFile(join(failed, 'failure.json'), 'utf8')), {
      message: 'native login missing',
      completedRuns: 0,
      retry: false,
      fallback: false,
    });
    await assert.rejects(access(join(failed, 'summary.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

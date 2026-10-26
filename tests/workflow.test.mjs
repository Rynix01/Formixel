import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';
import { executeWorkflow, WorkflowFailure } from '../packages/cli/dist/workflow.js';
import { main } from '../packages/cli/dist/index.js';
import { workflowArtifact } from '../packages/cli/dist/artifact.js';
import {
  compareReference,
  renderPNG,
  importBBModel,
  serialize,
  parseFXL,
} from '../packages/core/dist/index.js';

const design = () => ({
  version: 1,
  source: 'model plated group body { cube shell [-2,0,-1] [4,5,2] }',
  authoring: {
    atlas: {
      size: [64, 64],
      texelsPerUnit: 2,
      recipes: [{ id: 'plate', kind: 'metal', base: '#313642', accent: '#bfa468', detail: 0.8 }],
      parts: [{ cubes: ['body/shell'], recipe: 'plate' }],
      requireCoverage: true,
    },
    constraints: [
      { id: 'floor', type: 'ground', cubes: ['body/shell'], floor: 0, tolerance: 0.001 },
    ],
  },
});

test('production workflow authors provider data, caches only reviewed results and reports actual counters', async () => {
  const cache = new Map(),
    requests = [],
    phases = [];
  const provider = {
    name: 'codex',
    generate: async (request) => {
      requests.push(request);
      request.onUsage({
        inputTokens: 120,
        outputTokens: 60,
        cachedInputTokens: 10,
        reasoningOutputTokens: null,
      });
      return JSON.stringify(design());
    },
  };
  const options = {
    provider,
    cache: { read: async (k) => cache.get(k), write: async (k, v) => cache.set(k, v) },
    onProgress: (p) => phases.push(p),
  };
  const request = { kind: 'craft', provider: 'codex', prompt: 'An upright plated surface' };
  const a = await executeWorkflow(request, options),
    b = await executeWorkflow(request, options);
  assert.equal(requests.length, 1);
  assert.equal(a.metrics.requests, 1);
  assert.equal(b.metrics.requests, 0);
  assert.equal(a.metrics.usage.inputTokens, 120);
  assert.equal(b.metrics.usage, null);
  assert.equal(a.review.technical.textureCoverage, 1);
  assert.ok(a.review.rig.checks.length);
  assert.equal(serialize(a.model), serialize(b.model));
  assert.ok(phases.includes('authoring'));
  assert.match(requests[0].outputInstructions, /source JSON string/);
  assert.ok(a.metrics.instructionBytes > 1000);
  assert.equal(a.metrics.referenceBytes, 0);
  const contents = unzipSync(
    workflowArtifact(a.model, { review: a.review, metrics: a.metrics, design: a.design }),
  );
  const decoded = JSON.parse(new TextDecoder().decode(contents['model.bbmodel']));
  assert.equal(serialize(importBBModel(decoded)), serialize(a.model));
  assert.ok(contents['front.png'] && contents['checksums.json'] && contents['model.design.json']);
});

test('production gates reject missing plans, actual floor faults and corrupt cache before replacing output', async () => {
  for (const mutate of [
    (d) => delete d.authoring.atlas,
    (d) => (d.authoring.constraints = []),
    (d) => (d.authoring.atlas.requireCoverage = false),
    (d) => (d.source = d.source.replace('[-2,0,-1]', '[-2,-2,-1]')),
  ]) {
    const value = design();
    mutate(value);
    let writes = 0;
    await assert.rejects(
      executeWorkflow(
        { kind: 'craft', provider: 'codex', prompt: 'plate' },
        {
          provider: { name: 'codex', generate: async () => JSON.stringify(value) },
          cache: {
            read: async () => undefined,
            write: async () => {
              writes++;
            },
          },
        },
      ),
    );
    assert.equal(writes, 0);
  }
  let calls = 0;
  await assert.rejects(
    executeWorkflow(
      { kind: 'craft', provider: 'codex', prompt: 'plate' },
      {
        provider: {
          name: 'codex',
          generate: async () => {
            calls++;
            return '{}';
          },
        },
        cache: { read: async () => '{broken', write: async () => {} },
      },
    ),
  );
  assert.equal(calls, 0);
  const dir = await mkdtemp(join(tmpdir(), 'formixel-workflow-'));
  try {
    const input = join(dir, 'invalid.design.json'),
      output = join(dir, 'keep.bbmodel');
    const invalid = design();
    invalid.source = invalid.source.replace('[-2,0,-1]', '[-2,-2,-1]');
    await writeFile(input, JSON.stringify(invalid));
    await writeFile(output, 'original');
    await assert.rejects(main(['author', input, '-o', output, '--force']));
    assert.equal(await readFile(output, 'utf8'), 'original');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local review failures retain actual provider usage and completed call telemetry', async () => {
  const value = design();
  value.source = value.source.replace('[-2,0,-1]', '[-2,-2,-1]');
  const usage = {
    inputTokens: 137,
    outputTokens: 29,
    cachedInputTokens: 17,
    reasoningOutputTokens: 3,
  };
  let calls = 0;
  let cacheWrites = 0;
  const phases = [];
  await assert.rejects(
    executeWorkflow(
      { kind: 'craft', provider: 'codex', model: 'test-model', prompt: 'A grounded plate' },
      {
        provider: {
          name: 'codex',
          generate: async (request) => {
            calls++;
            request.onUsage(usage);
            return JSON.stringify(value);
          },
        },
        cache: {
          read: async () => undefined,
          write: async () => {
            cacheWrites++;
          },
        },
        onProgress: (phase) => phases.push(phase),
      },
    ),
    (error) => {
      assert.ok(error instanceof WorkflowFailure);
      assert.match(error.message, /Local production review failed/);
      assert.equal(error.metrics.failed, true);
      assert.equal(error.metrics.provider, 'codex');
      assert.equal(error.metrics.model, 'test-model');
      assert.equal(error.metrics.cacheHit, false);
      assert.equal(error.metrics.generationAttempts, 1);
      assert.equal(error.metrics.completedProviderRequests, 1);
      assert.deepEqual(error.metrics.usage, usage);
      assert.ok(error.metrics.promptBytes > 0);
      assert.ok(error.metrics.instructionBytes > 1000);
      assert.ok(Number.isInteger(error.metrics.elapsedMs) && error.metrics.elapsedMs >= 0);
      assert.match(error.metrics.fingerprint, /^[a-f0-9]{64}$/);
      for (const key of ['result', 'model', 'review'])
        assert.equal(Object.hasOwn(error, key), false);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(cacheWrites, 0);
  assert.ok(phases.includes('reviewing'));
  assert.equal(phases.includes('complete'), false);
});

test('scoped refine permits incremental existing faults but rejects unrelated changes and exposes compact context', async () => {
  const base = parseFXL(
    'model x group a { cube c [0,0,0] [1,2,1] } group b { cube d [3,0,0] [1,2,1] }',
  );
  const request = {
    kind: 'refine',
    provider: 'codex',
    prompt: 'Move the selected plate forward',
    base,
    selection: ['a'],
  };
  const result = await executeWorkflow(request, {
    provider: {
      name: 'codex',
      generate: async () => JSON.stringify([{ op: 'translate', id: 'a/c', offset: [0, 0, -1] }]),
    },
  });
  assert.equal(result.model.cubes.find((c) => c.id === 'a/c').from[2], -1);
  assert.deepEqual(
    result.model.cubes.find((c) => c.id === 'b/d'),
    base.cubes.find((c) => c.id === 'b/d'),
  );
  assert.ok(result.metrics.repairContextBytes < 32000);
  await assert.rejects(
    executeWorkflow(request, {
      provider: {
        name: 'codex',
        generate: async () => JSON.stringify([{ op: 'translate', id: 'b/d', offset: [0, 0, -1] }]),
      },
    }),
    /scope|selected|editable/i,
  );
});

test('reference review measures registered occupancy and records limits instead of an aesthetic certificate', () => {
  const model = parseFXL('model m cube c [-2,0,-1] [4,8,2]');
  const reference = renderPNG(model, {
    width: 256,
    height: 256,
    view: 'front',
    background: '#ffffffff',
  });
  const matching = compareReference(model, reference, 'front');
  assert.ok(matching.report.silhouetteIoU > 0.97);
  const wide = parseFXL('model m cube c [-5,0,-1] [10,8,2]');
  assert.ok(compareReference(wide, reference, 'front').report.silhouetteIoU < 0.6);
  assert.match(matching.report.scope, /not an aesthetic score/);
  assert.throws(() => compareReference(model, reference, 'isometric'));
});

test('production policy cannot be bypassed with provider-selected floor tolerances', async () => {
  const value = design();
  value.source = value.source.replace('[-2,0,-1]', '[-2,10,-1]');
  value.authoring.constraints = [
    {
      id: 'fake_floor',
      type: 'ground',
      cubes: ['body/shell'],
      floor: -1000000,
      tolerance: 1000000,
    },
  ];
  await assert.rejects(
    executeWorkflow(
      { kind: 'craft', provider: 'codex', prompt: 'grounded plate' },
      {
        provider: { name: 'codex', generate: async () => JSON.stringify(value) },
      },
    ),
    /production review failed/,
  );
  let calls = 0;
  await assert.rejects(
    executeWorkflow(
      { kind: 'craft', provider: 'codex', prompt: 'plate', brief: { anatomy: 'invalid' } },
      {
        provider: {
          name: 'codex',
          generate: async () => {
            calls++;
            return JSON.stringify(design());
          },
        },
      },
    ),
  );
  assert.equal(calls, 0);
});

test('CLI rejects unusable output targets before contacting a provider', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-preflight-')),
    oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Unexpected provider request');
  };
  try {
    for (const output of [
      join(dir, 'bad.txt'),
      join(dir, 'missing', 'model.bbmodel'),
      join(dir, 'wrong.design.json'),
    ]) {
      const command = output.endsWith('.design.json') ? 'refine' : 'craft';
      await assert.rejects(
        main([command, 'input', '--provider', 'openai', '--model', 'test', '-o', output]),
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

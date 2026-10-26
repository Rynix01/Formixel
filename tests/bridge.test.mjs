import test from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, parseBridgeJob } from '../packages/cli/dist/bridge.js';
import { executeWorkflow } from '../packages/cli/dist/workflow.js';
import { importBBModel } from '../packages/core/dist/index.js';
import { request as httpRequest } from 'node:http';

const job = { kind: 'craft', prompt: 'A silver plate', provider: 'codex' };
const design = {
  version: 1,
  source: 'model plate group base { cube p [-1,0,-1] [2,3,2] }',
  authoring: {
    atlas: {
      size: [32, 32],
      texelsPerUnit: 1,
      recipes: [{ id: 'silver', kind: 'metal', base: '#687386', accent: '#d7deed', detail: 0.5 }],
      parts: [{ cubes: ['base/p'], recipe: 'silver' }],
    },
    constraints: [{ id: 'floor', type: 'ground', cubes: ['base/p'], floor: 0, tolerance: 0 }],
  },
};
const poll = async (bridge, id) => {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(bridge.url + '/jobs/' + id, {
        headers: { Authorization: 'Bearer ' + bridge.token },
      }),
      data = await r.json();
    if (data.status !== 'running') return data;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Live job did not finish');
};

test('loopback bridge pairs explicitly, rejects cross-origin/host and serves real validated workflow results', async () => {
  let calls = 0;
  const bridge = await startBridge({
    execute: (request, options) =>
      executeWorkflow(request, {
        ...options,
        provider: {
          name: 'codex',
          generate: async () => {
            calls++;
            return JSON.stringify(design);
          },
        },
      }),
  });
  const headers = {
    Authorization: 'Bearer ' + bridge.token,
    'Content-Type': 'application/json',
    Origin: 'https://web.blockbench.net',
  };
  try {
    assert.match(bridge.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(bridge.url + '/health')).status, 401);
    assert.equal(
      (
        await fetch(bridge.url + '/health', {
          headers: { ...headers, Origin: 'https://attacker.example' },
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      const r = httpRequest(
        bridge.url + '/health',
        { headers: { ...headers, Host: 'rebound.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      r.on('error', reject);
      r.end();
    });
    assert.equal(hostStatus, 403);
    const preflight = await fetch(bridge.url + '/jobs', {
      method: 'OPTIONS',
      headers: { Origin: 'https://web.blockbench.net' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      'https://web.blockbench.net',
    );
    const created = await fetch(bridge.url + '/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(job),
    });
    assert.equal(created.status, 202);
    const { id } = await created.json();
    assert.equal((await poll(bridge, id)).status, 'completed');
    const result = await (await fetch(bridge.url + '/jobs/' + id + '/result', { headers })).json();
    assert.equal(importBBModel(result.model).cubes.length, 1);
    assert.equal(result.review.rig.passed, true);
    assert.equal(result.metrics.requests, 1);
    assert.equal(calls, 1);
    assert.equal((await fetch(bridge.url + '/anything', { headers })).status, 404);
  } finally {
    await bridge.close();
  }
});

test('bridge cancellation aborts the single active transport and never exposes cancelled output', async () => {
  let calls = 0,
    aborted = false;
  const bridge = await startBridge({
    execute: async (request, options) => {
      calls++;
      options.onProgress('planning');
      return new Promise((resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(options.signal.reason);
          },
          { once: true },
        ),
      );
    },
  });
  const headers = { Authorization: 'Bearer ' + bridge.token, 'Content-Type': 'application/json' };
  try {
    const response = await fetch(bridge.url + '/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify(job),
      }),
      { id } = await response.json();
    assert.equal(
      (await fetch(bridge.url + '/jobs', { method: 'POST', headers, body: JSON.stringify(job) }))
        .status,
      409,
    );
    assert.equal((await fetch(bridge.url + '/jobs/' + id + '/result', { headers })).status, 409);
    await fetch(bridge.url + '/jobs/' + id + '/cancel', { method: 'POST', headers });
    assert.equal((await poll(bridge, id)).status, 'cancelled');
    assert.equal(aborted, true);
    assert.equal(calls, 1);
    assert.equal((await fetch(bridge.url + '/jobs/' + id + '/result', { headers })).status, 409);
  } finally {
    await bridge.close();
  }
});

test('bridge rejects file/shell requests, malformed references and unbounded jobs before execution', () => {
  for (const extra of [
    { cwd: 'C:/' },
    { executable: 'cmd' },
    { output: 'file' },
    { shell: true },
    { references: [{ role: 'front', path: 'secret.png' }] },
    { references: [{ role: 'front', pngBase64: '@@' }] },
    { timeoutMs: 600001 },
    { base: {} },
  ])
    assert.throws(() => parseBridgeJob({ ...job, ...extra }));
  assert.throws(() => parseBridgeJob({ ...job, kind: 'refine', selection: [] }));
  assert.throws(() => parseBridgeJob({ ...job, prompt: 'x'.repeat(8193) }));
});

test('concurrent streaming submissions cannot start two provider jobs', async () => {
  let calls = 0,
    cleaned = false;
  const bridge = await startBridge({
    execute: async (request, options) => {
      calls++;
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) {
          cleaned = true;
          reject(options.signal.reason);
          return;
        }
        options.signal.addEventListener(
          'abort',
          () => {
            cleaned = true;
            reject(options.signal.reason);
          },
          { once: true },
        );
      });
    },
  });
  const payload = JSON.stringify(job),
    headers = {
      Authorization: 'Bearer ' + bridge.token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
  const pending = [];
  const requests = [];
  try {
    for (let i = 0; i < 2; i++)
      pending.push(
        new Promise((resolve, reject) => {
          const r = httpRequest(bridge.url + '/jobs', { method: 'POST', headers }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          });
          r.on('error', reject);
          r.write(payload.slice(0, 4));
          requests.push(r);
        }),
      );
    for (const r of requests) r.end(payload.slice(4));
    assert.deepEqual((await Promise.all(pending)).sort(), [202, 409]);
    assert.equal(calls, 1);
  } finally {
    await bridge.close();
  }
  assert.equal(cleaned, true, 'shutdown waits until active executor cleanup has finished');
});

test(
  'bridge shutdown terminates an incomplete streaming submission without starting a provider',
  { timeout: 8000 },
  async () => {
    let calls = 0;
    const bridge = await startBridge({
      execute: async () => {
        calls++;
        throw new Error('An incomplete request must never execute');
      },
    });
    const payload = JSON.stringify(job);
    const request = httpRequest(bridge.url + '/jobs', {
      method: 'POST',
      agent: false,
      headers: {
        Authorization: 'Bearer ' + bridge.token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Expect: '100-continue',
      },
    });
    const outcome = new Promise((resolve) => {
      request.once('error', (error) => resolve({ error }));
      request.once('response', (response) => {
        response.resume();
        response.once('end', () => resolve({ status: response.statusCode }));
        response.once('error', (error) => resolve({ error }));
      });
    });
    const disconnected = new Promise((resolve) => request.once('close', resolve));
    const bounded = async (pending, message) => {
      let timer;
      try {
        return await Promise.race([
          pending,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), 1500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      // The interim response proves the server accepted these headers before shutdown.
      const accepted = new Promise((resolve, reject) => {
        request.once('continue', resolve);
        request.once('error', reject);
      });
      request.flushHeaders();
      await bounded(accepted, 'Server did not accept streaming request headers');
      await new Promise((resolve, reject) => {
        request.write(payload.slice(0, 5), (error) => (error ? reject(error) : resolve()));
      });
      assert.equal(request.writableEnded, false);
      const closing = bridge.close();
      assert.equal(bridge.close(), closing, 'Repeated close calls share the same shutdown');
      await bounded(closing, 'Shutdown waited for the unfinished request body');
      const termination = await bounded(outcome, 'Streaming client was left waiting');
      await bounded(disconnected, 'Streaming client socket was leaked');
      assert.ok(termination.error || termination.status >= 400, 'Incomplete jobs must be rejected');
      assert.equal(request.socket.destroyed, true);
      assert.equal(calls, 0);
      await assert.rejects(
        new Promise((resolve, reject) => {
          const probe = httpRequest(bridge.url + '/health', { agent: false }, (response) => {
            response.resume();
            resolve(response.statusCode);
          });
          probe.once('error', reject);
          probe.end();
        }),
        { code: 'ECONNREFUSED' },
        'Shutdown must release the listening socket',
      );
    } finally {
      request.destroy();
      await bridge.close();
    }
  },
);

test('failed bridge workflows expose observed usage without making a result available', async () => {
  const usage = {
    inputTokens: 137,
    outputTokens: 29,
    cachedInputTokens: 17,
    reasoningOutputTokens: 3,
  };
  const invalid = structuredClone(design);
  invalid.source = invalid.source.replace('[-1,0,-1]', '[-1,-2,-1]');
  let calls = 0;
  const bridge = await startBridge({
    execute: (request, options) =>
      executeWorkflow(request, {
        ...options,
        provider: {
          name: 'codex',
          generate: async (generation) => {
            calls++;
            generation.onUsage(usage);
            return JSON.stringify(invalid);
          },
        },
      }),
  });
  const headers = { Authorization: 'Bearer ' + bridge.token, 'Content-Type': 'application/json' };
  try {
    const created = await fetch(bridge.url + '/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(job),
    });
    assert.equal(created.status, 202);
    const { id } = await created.json();
    const failed = await poll(bridge, id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.phase, 'failed');
    assert.match(failed.error, /Local production review failed/);
    assert.equal(failed.metrics.failed, true);
    assert.equal(failed.metrics.cacheHit, false);
    assert.equal(failed.metrics.generationAttempts, 1);
    assert.equal(failed.metrics.completedProviderRequests, 1);
    assert.deepEqual(failed.metrics.usage, usage);
    for (const key of ['result', 'model', 'review'])
      assert.equal(Object.hasOwn(failed, key), false);
    const result = await fetch(bridge.url + '/jobs/' + id + '/result', { headers });
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { error: 'Result is not ready', status: 'failed' });
    assert.equal(calls, 1);
    const health = await (await fetch(bridge.url + '/health', { headers })).json();
    assert.equal(health.active, false);
  } finally {
    await bridge.close();
  }
});

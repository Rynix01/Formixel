import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { exportBBModelWithContext, assertModel } from '@formixel/core';
import {
  executeWorkflow,
  WorkflowFailure,
  type WorkflowRequest,
  type WorkflowOptions,
} from './workflow.js';

const ORIGINS = new Set(['https://web.blockbench.net', 'null']);
type Job = {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  controller: AbortController;
  result?: unknown;
  error?: string;
  failureMetrics?: Record<string, unknown>;
  pending?: Promise<void>;
};
type Executor = (
  request: WorkflowRequest,
  options: WorkflowOptions,
) => ReturnType<typeof executeWorkflow>;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const length = Number(req.headers['content-length'] ?? 0);
  if (!Number.isSafeInteger(length) || length < 0 || length > 16_000_000)
    throw new Error('Job exceeds 16 MB');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_000_000) throw new Error('Job exceeds 16 MB');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function parseBridgeJob(value: unknown): WorkflowRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid job');
  const j = value as Record<string, any>;
  if (
    Object.keys(j).some(
      (k) =>
        ![
          'kind',
          'prompt',
          'provider',
          'model',
          'timeoutMs',
          'base',
          'selection',
          'references',
          'constraints',
          'brief',
          'roles',
        ].includes(k),
    ) ||
    !['craft', 'refine'].includes(j.kind) ||
    !['codex', 'claude-code', 'openai', 'anthropic'].includes(j.provider) ||
    typeof j.prompt !== 'string' ||
    !j.prompt.trim() ||
    Buffer.byteLength(j.prompt) > 8192 ||
    (j.model !== undefined && typeof j.model !== 'string') ||
    (j.timeoutMs !== undefined &&
      (!Number.isInteger(j.timeoutMs) || j.timeoutMs < 100 || j.timeoutMs > 600000))
  )
    throw new Error('Invalid bounded workflow job');
  if (j.kind === 'refine') {
    assertModel(j.base);
    if (
      !Array.isArray(j.selection) ||
      !j.selection.length ||
      j.selection.length > 128 ||
      !j.selection.every((s: unknown) => typeof s === 'string' && s.length <= 140)
    )
      throw new Error('Refine requires explicit semantic selections');
  } else if (j.base !== undefined || j.selection !== undefined)
    throw new Error('Craft cannot access an existing model');
  let references: WorkflowRequest['references'];
  if (j.references !== undefined) {
    if (!Array.isArray(j.references) || !j.references.length || j.references.length > 8)
      throw new Error('Invalid reference array');
    references = j.references.map((r: any) => {
      if (
        !r ||
        Object.keys(r).some((k) => !['role', 'pngBase64'].includes(k)) ||
        !['front', 'back', 'left', 'right', 'top', 'detail', 'texture', 'storyboard'].includes(
          r.role,
        ) ||
        typeof r.pngBase64 !== 'string' ||
        r.pngBase64.length > 1333336 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(r.pngBase64)
      )
        throw new Error('Invalid reference image');
      const png = Buffer.from(r.pngBase64, 'base64');
      if (png.toString('base64') !== r.pngBase64)
        throw new Error('Noncanonical reference encoding');
      return { role: r.role, png: Uint8Array.from(png) };
    });
  }
  return {
    kind: j.kind,
    prompt: j.prompt,
    provider: j.provider,
    ...(j.model !== undefined ? { model: j.model } : {}),
    ...(j.timeoutMs !== undefined ? { timeoutMs: j.timeoutMs } : {}),
    ...(references ? { references } : {}),
    ...(j.constraints !== undefined ? { constraints: j.constraints } : {}),
    ...(j.brief !== undefined ? { brief: j.brief } : {}),
    ...(j.roles !== undefined ? { roles: j.roles } : {}),
    ...(j.kind === 'refine' ? { base: j.base, selection: j.selection } : {}),
  };
}

/** Starts only on explicit CLI invocation; no filesystem routes, arbitrary argv, or remote binding. */
export async function startBridge(options: { port?: number; execute?: Executor } = {}) {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const token = randomBytes(32).toString('hex');
  const jobs = new Map<string, Job>();
  const execute = options.execute ?? executeWorkflow;
  let address = '';
  let closing = false;
  let shutdown: Promise<void> | undefined;
  const submissions = new Set<IncomingMessage>();
  const server = createServer(async (req, res) => {
    const reply = (status: number, data: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    const origin = req.headers.origin;
    if (closing) {
      reply(503, { error: 'Bridge is closing' });
      return;
    }
    if (req.headers.host !== address || (origin !== undefined && !ORIGINS.has(origin))) {
      reply(403, { error: 'Origin or host rejected' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204);
      res.end();
      return;
    }
    const authorization = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from('Bearer ' + token);
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      reply(401, { error: 'Pairing token required' });
      return;
    }
    try {
      if (req.url === '/health' && req.method === 'GET') {
        reply(200, {
          service: 'Formixel',
          protocol: 1,
          active: [...jobs.values()].some((j) => j.status === 'running'),
        });
        return;
      }
      if (req.url === '/jobs' && req.method === 'POST') {
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
          reply(415, { error: 'JSON required' });
          return;
        }
        if ([...jobs.values()].some((j) => j.status === 'running')) {
          reply(409, { error: 'A job is already running' });
          return;
        }
        submissions.add(req);
        req.once('close', () => submissions.delete(req));
        const request = parseBridgeJob(await readBody(req));
        if (closing) {
          reply(503, { error: 'Bridge is closing' });
          return;
        }
        // Another request may have completed its body while this one was streaming.
        if ([...jobs.values()].some((j) => j.status === 'running')) {
          reply(409, { error: 'A job is already running' });
          return;
        }
        for (const [id, j] of jobs) if (jobs.size >= 8 && j.status !== 'running') jobs.delete(id);
        const job: Job = {
          id: randomUUID(),
          status: 'running',
          phase: 'validating',
          controller: new AbortController(),
        };
        jobs.set(job.id, job);
        reply(202, { id: job.id, status: job.status });
        job.pending = Promise.resolve()
          .then(() =>
            execute(request, {
              signal: job.controller.signal,
              onProgress: (phase) => {
                job.phase = phase;
              },
            }),
          )
          .then((result) => {
            if (job.controller.signal.aborted) {
              job.status = 'cancelled';
              return;
            }
            const payload = {
              model: exportBBModelWithContext(result.model, result.context),
              context: result.context,
              review: result.review,
              metrics: result.metrics,
              ...('design' in result && result.design ? { design: result.design } : {}),
            };
            if (Buffer.byteLength(JSON.stringify(payload)) > 16_000_000)
              throw new Error('Result exceeds bridge response limit');
            job.result = payload;
            job.status = 'completed';
            job.phase = 'ready';
          })
          .catch((error: unknown) => {
            job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
            job.error = (error as Error).message.slice(0, 2048);
            if (error instanceof WorkflowFailure) job.failureMetrics = error.metrics;
            job.phase = job.status;
          });
        return;
      }
      const route = /^\/jobs\/([a-f0-9-]{36})(\/result|\/cancel)?$/.exec(req.url ?? '');
      const job = route ? jobs.get(route[1]!) : undefined;
      if (!job) {
        reply(404, { error: 'Unknown route or job' });
        return;
      }
      if (route![2] === '/cancel' && req.method === 'POST') {
        if (job.status === 'running') {
          job.controller.abort(new Error('Cancelled by user'));
          job.phase = 'cancelling';
        }
        reply(200, { id: job.id, status: job.status, phase: job.phase });
        return;
      }
      if (route![2] === '/result' && req.method === 'GET') {
        if (job.status !== 'completed') {
          reply(409, { error: 'Result is not ready', status: job.status });
          return;
        }
        reply(200, job.result);
        return;
      }
      if (!route![2] && req.method === 'GET') {
        reply(200, {
          id: job.id,
          status: job.status,
          phase: job.phase,
          ...(job.error ? { error: job.error } : {}),
          ...(job.failureMetrics ? { metrics: job.failureMetrics } : {}),
        });
        return;
      }
      reply(405, { error: 'Method not allowed' });
    } catch (error) {
      reply(400, { error: (error as Error).message.slice(0, 2048) });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 12;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('Bridge failed to bind');
  address = `127.0.0.1:${bound.port}`;
  return {
    url: 'http://' + address,
    token,
    close: () =>
      (shutdown ??= (async () => {
        closing = true;
        for (const req of submissions) req.destroy();
        for (const job of jobs.values())
          if (job.status === 'running') job.controller.abort(new Error('Bridge closed'));
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await Promise.allSettled([...jobs.values()].map((job) => job.pending));
      })()),
  };
}

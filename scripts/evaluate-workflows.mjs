import { createHash } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { unzipSync } from 'fflate';
import {
  runProcess,
  normalizeReferences,
  validateGenerationRequest,
} from '../packages/providers/dist/index.js';
import { summarizeEvaluations } from '../packages/cli/dist/metrics.js';
import { parseProductionBrief } from '../packages/core/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fields = (v, names) =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => names.includes(k));
export function validateEvaluationManifest(value) {
  if (
    !fields(value, ['version', 'iterations', 'tasks']) ||
    value.version !== 1 ||
    !Number.isInteger(value.iterations) ||
    value.iterations < 1 ||
    value.iterations > 3 ||
    !Array.isArray(value.tasks) ||
    !value.tasks.length ||
    value.tasks.length > 8
  )
    throw new Error('Evaluation manifest requires version:1, iterations:1..3, tasks:1..8');
  const ids = new Set();
  for (const task of value.tasks) {
    if (
      !fields(task, ['id', 'prompt', 'provider', 'model', 'timeoutMs', 'references', 'brief']) ||
      typeof task.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(task.id) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(task.id) ||
      ids.has(task.id.toLowerCase()) ||
      typeof task.model !== 'string' ||
      !task.model.trim() ||
      (task.references !== undefined &&
        (!Array.isArray(task.references) ||
          !task.references.length ||
          task.references.length > 8 ||
          task.references.some(
            (r) => !fields(r, ['role', 'path']) || typeof r.path !== 'string' || !r.path.trim(),
          )))
    )
      throw new Error(
        'Invalid evaluation task or duplicate identifier; choose an explicit provider/model',
      );
    ids.add(task.id.toLowerCase());
    if (task.brief !== undefined) parseProductionBrief(task.brief);
    validateGenerationRequest(task.provider, {
      prompt: task.prompt,
      model: task.model,
      ...(task.timeoutMs !== undefined ? { timeoutMs: task.timeoutMs } : {}),
    });
  }
  return value;
}
async function readBytes(path, limit) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit)
      throw new Error('Evaluation input exceeds file budget');
    const chunks = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw new Error('Evaluation input changed beyond budget');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}
async function prepareTasks(manifest, base) {
  const tasks = [];
  for (const task of manifest.tasks) {
    const references = [];
    for (const reference of task.references ?? [])
      references.push({
        role: reference.role,
        png: new Uint8Array(await readBytes(resolve(base, reference.path), 1_000_000)),
      });
    const normalized = references.length ? normalizeReferences({ references }) : [];
    validateGenerationRequest(task.provider, {
      prompt: task.prompt,
      model: task.model,
      ...(normalized.length ? { references: normalized } : {}),
    });
    tasks.push({
      task,
      references: normalized,
      identity: {
        id: task.id,
        promptHash: digest(
          task.brief === undefined ? task.prompt : JSON.stringify([task.prompt, task.brief]),
        ),
        referenceHash: digest(JSON.stringify(normalized.map((r) => [r.role, digest(r.png)]))),
        provider: task.provider,
        model: task.model,
      },
    });
  }
  return tasks;
}
export async function readEvaluationArtifact(path) {
  const bytes = await readBytes(path, 32_000_000);
  let inflated = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      inflated += entry.originalSize;
      if (inflated > 64_000_000) throw new Error('Evaluation artifact inflated budget exceeded');
      return /^(model\.bbir\.json|review\.json|checksums\.json|(?:isometric|front|back|left|right|top)\.png|motion-[0-7]\.gif)$/.test(
        entry.name,
      );
    },
  });
  if (!files['review.json'] || !files['model.bbir.json'] || !files['checksums.json'])
    throw new Error('Incomplete workflow artifact');
  const checksums = JSON.parse(new TextDecoder().decode(files['checksums.json']));
  if (
    checksums.version !== 1 ||
    checksums.algorithm !== 'sha256' ||
    !fields(checksums.files, Object.keys(checksums.files ?? {}))
  )
    throw new Error('Invalid artifact checksums');
  for (const [name, content] of Object.entries(files))
    if (name !== 'checksums.json' && checksums.files[name] !== digest(content))
      throw new Error('Evaluation artifact checksum mismatch: ' + name);
  const details = JSON.parse(new TextDecoder().decode(files['review.json']));
  return {
    metrics: details.metrics,
    review: details.review,
    modelHash: digest(files['model.bbir.json']),
    renderHashes: Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name.endsWith('.png') || name.endsWith('.gif'))
        .map(([name, content]) => [name, digest(content)]),
    ),
  };
}
/** Trusted transport injection is only for tests; manifests cannot override the executable or arguments. */
export async function runEvaluation(manifestPath, destination, transport = {}) {
  const manifest = validateEvaluationManifest(
    JSON.parse(await readBytes(resolve(manifestPath), 1_000_000)),
  );
  const prepared = await prepareTasks(manifest, dirname(resolve(manifestPath)));
  const output = resolve(destination);
  // A fresh exclusive directory guarantees the first request cannot hit a previous evaluation cache.
  await mkdir(output);
  const records = [];
  try {
    for (const { task, references, identity } of prepared) {
      const directory = join(output, task.id);
      await mkdir(directory);
      const cache = join(directory, 'cache');
      const staged = [];
      for (const [index, reference] of references.entries()) {
        const path = join(directory, `reference-${index}-${reference.role}.png`);
        await writeFile(path, reference.png, { flag: 'wx' });
        staged.push({ role: reference.role, path });
      }
      const referenceManifest = join(directory, 'references.json');
      if (staged.length) await writeFile(referenceManifest, JSON.stringify(staged), { flag: 'wx' });
      for (let iteration = 0; iteration < manifest.iterations; iteration++) {
        const artifact = join(directory, iteration === 0 ? 'cold.zip' : `warm-${iteration}.zip`);
        const args = [
          join(root, 'packages/cli/dist/index.js'),
          'craft',
          task.prompt,
          '--provider',
          task.provider,
          '--model',
          task.model,
          '--cache',
          cache,
          '-o',
          artifact,
          ...(task.timeoutMs !== undefined ? ['--timeout', String(task.timeoutMs)] : []),
          ...(staged.length ? ['--references', referenceManifest] : []),
          ...(task.brief ? ['--anatomy', task.brief.anatomy] : []),
          ...(task.brief?.floor !== undefined ? ['--floor', String(task.brief.floor)] : []),
          ...(task.brief?.forward ? ['--forward', task.brief.forward.join(',')] : []),
          ...(task.brief?.airborneAnimations?.length
            ? ['--airborne', task.brief.airborneAnimations.join(',')]
            : []),
          ...(task.brief?.weaponHands !== undefined
            ? ['--weapon-hands', String(task.brief.weaponHands)]
            : []),
        ];
        const before = performance.now();
        await (transport.run ?? runProcess)(
          process.execPath,
          args,
          '',
          root,
          (task.timeoutMs ?? 120_000) + 180_000,
        );
        const record = {
          task: identity,
          iteration,
          wallElapsedMs: Math.round(performance.now() - before),
          ...(await readEvaluationArtifact(artifact)),
        };
        records.push(record);
        // Validate every iteration immediately. Changed fingerprint/model/render or invalid counters fail before another task.
        const partial = summarizeEvaluations(records);
        await writeFile(join(output, 'records.json'), JSON.stringify(records, null, 2) + '\n');
        await writeFile(join(output, 'summary.json'), JSON.stringify(partial, null, 2) + '\n');
        if (!partial.passed)
          throw new Error('Evaluation found local review or deterministic artifact mismatch');
      }
    }
    return summarizeEvaluations(records);
  } catch (error) {
    await writeFile(
      join(output, 'failure.json'),
      JSON.stringify(
        {
          message: error instanceof Error ? error.message : 'Evaluation failed',
          completedRuns: records.length,
          retry: false,
          fallback: false,
        },
        null,
        2,
      ) + '\n',
    );
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw new Error(
      'Usage: node scripts/evaluate-workflows.mjs manifest.json NEW_OUTPUT_DIRECTORY',
    );
  const result = await runEvaluation(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(result, null, 2));
}

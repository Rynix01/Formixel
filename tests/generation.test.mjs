import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../packages/cli/dist/index.js';
test('task bridge writes only locally validated planner output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-generation-'));
  const task = join(dir, 'task.json'),
    out = join(dir, 'result.fxl');
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const response = (text) =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text }] }],
      }),
    );
  try {
    await writeFile(
      task,
      JSON.stringify({ version: 1, prompt: 'golem', provider: 'openai', model: 'test-model' }),
    );
    globalThis.fetch = async () => response('model golem cube body [0,0,0] [-1,1,1]');
    await assert.rejects(main(['run', task, '-o', out]), /positive/);
    await assert.rejects(stat(out), (e) => e.code === 'ENOENT');
    globalThis.fetch = async () => response('model golem cube body [0,0,0] [1,1,1]');
    await main(['run', task, '-o', out]);
    assert.equal(await readFile(out, 'utf8'), 'model golem cube body [0,0,0] [1,1,1]\n');
    await writeFile(
      task,
      JSON.stringify({
        version: 1,
        prompt: 'golem',
        provider: 'openai',
        model: 'test-model',
        executable: 'unsafe',
      }),
    );
    await assert.rejects(main(['run', task, '-o', out, '--force']), /Invalid Formixel task/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

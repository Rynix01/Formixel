import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliArguments, createProvider, runProcess } from '../packages/providers/dist/index.js';
test('CLI providers have fixed argv and restricted tool policies', () => {
  const codex = cliArguments('codex');
  assert.ok(codex.includes('read-only'));
  assert.ok(codex.includes('shell_tool'));
  assert.ok(codex.includes('--ignore-user-config'));
  const claude = cliArguments('claude-code');
  assert.equal(claude[claude.indexOf('--tools') + 1], '');
  assert.ok(claude.includes('dontAsk'));
  assert.ok(claude.includes('--strict-mcp-config'));
  assert.throws(() => cliArguments('codex', '--dangerously-bypass-approvals-and-sandbox'));
  assert.throws(() => createProvider('unknown'));
});
test('process transport streams stdin literally and fails closed on timeouts/nonzero exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-test-'));
  try {
    const output = await runProcess(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      '$(echo unsafe); literal',
      dir,
      5000,
    );
    assert.equal(output, '$(echo unsafe); literal');
    await assert.rejects(
      runProcess(process.execPath, ['-e', 'process.exit(2)'], '', dir, 5000),
      /unsuccessfully/,
    );
    await assert.rejects(
      runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], '', dir, 100),
      /timed out/,
    );
    await assert.rejects(
      runProcess(
        process.execPath,
        ['-e', "process.stdout.write('x'.repeat(2000001))"],
        '',
        dir,
        5000,
      ),
      /budget/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('API providers are explicit and validate response envelopes using mocked HTTP', async () => {
  const old = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    await assert.rejects(createProvider('openai').generate({ prompt: 'golem' }), /explicit model/);
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(JSON.parse(init.body).store, false);
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: 'model golem' }] }],
        }),
      );
    };
    assert.equal(
      await createProvider('openai').generate({ prompt: 'golem', model: 'test-model' }),
      'model golem',
    );
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'incomplete' }));
    await assert.rejects(
      createProvider('openai').generate({ prompt: 'golem', model: 'test-model' }),
      /did not complete/,
    );
  } finally {
    globalThis.fetch = old;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('timeout terminates a spawned provider descendant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-tree-'));
  try {
    const descendant =
      'const fs=require("node:fs");fs.writeFileSync("ready","");setTimeout(()=>fs.writeFileSync("escaped",""),3000)';
    const parent =
      'require("node:child_process").spawn(process.execPath,["-e",' +
      JSON.stringify(descendant) +
      '],{stdio:"ignore"});setTimeout(()=>{},10000)';
    await assert.rejects(runProcess(process.execPath, ['-e', parent], '', dir, 2000), /timed out/);
    await access(join(dir, 'ready'));
    await new Promise((resolve) => setTimeout(resolve, 3200));
    await assert.rejects(access(join(dir, 'escaped')));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

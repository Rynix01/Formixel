import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, isAbsolute } from 'node:path';
import { PNG } from 'pngjs';
import { encodePNG, decodePNG } from '../packages/core/dist/index.js';
import {
  createProvider,
  providerCapabilities,
  validateGenerationRequest,
  generationInstructions,
  normalizeReferences,
  cliArguments,
  PLANNER_INSTRUCTIONS,
  REFERENCE_INSTRUCTIONS,
  parseClaudeResult,
  anthropicTokenUsage,
  runProcess,
} from '../packages/providers/dist/index.js';

const image = (red = 100) =>
  encodePNG({ width: 1, height: 1, pixels: Uint8Array.from([red, 20, 30, 255]) });
const codexResult = (source = '{"version":1}') =>
  [
    { type: 'item.completed', item: { type: 'agent_message', text: source } },
    {
      type: 'turn.completed',
      usage: { input_tokens: 120, output_tokens: 30, cached_input_tokens: 90 },
    },
  ]
    .map(JSON.stringify)
    .join('\n');
const claudeResult = (changes = {}) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    permission_denials: [],
    stop_reason: 'end_turn',
    result: 'model sentinel',
    usage: {
      input_tokens: 100,
      output_tokens: 12,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 25,
    },
    ...changes,
  });

test('reference packs validate role uniqueness, PNG integrity and byte/pixel/count bounds', () => {
  const png = image();
  const refs = ['front', 'back', 'left', 'right', 'top', 'texture', 'detail', 'storyboard'].map(
    (role) => ({ role, png }),
  );
  assert.deepEqual(
    normalizeReferences({ references: refs }).map((r) => r.role),
    refs.map((r) => r.role),
  );
  assert.equal(normalizeReferences({ referencePNG: png })[0].role, 'detail');
  assert.equal(
    normalizeReferences({
      references: [
        { role: 'detail', png },
        { role: 'detail', png },
      ],
    }).length,
    2,
  );
  assert.equal(
    normalizeReferences({
      references: [
        { role: 'storyboard', png },
        { role: 'storyboard', png },
      ],
    }).length,
    2,
  );
  for (const references of [
    [],
    [...refs, { role: 'detail', png }],
    'front',
    [{ role: 'camera', png }],
    [{ role: 'front', png, path: 'secret' }],
    [
      { role: 'front', png },
      { role: 'front', png },
    ],
    [
      { role: 'texture', png },
      { role: 'texture', png },
    ],
    [{ role: 'detail', png: new Uint8Array(1_000_001) }],
    [{ role: 'front', png: png.slice(0, -1) }],
  ]) {
    assert.throws(() => normalizeReferences({ references }));
  }
  assert.throws(() => normalizeReferences({ references: refs, referencePNG: png }), /not both/);
  const tooManyPixels = new PNG({ width: 513, height: 512 });
  tooManyPixels.data.fill(255);
  assert.throws(
    () =>
      normalizeReferences({ references: [{ role: 'detail', png: PNG.sync.write(tooManyPixels) }] }),
    /bounded|pixels/,
  );
  const maxPixels = encodePNG({ width: 512, height: 512, pixels: new Uint8Array(512 * 512 * 4) });
  assert.equal(
    normalizeReferences({ references: refs.map((r) => ({ ...r, png: maxPixels })) }).length,
    8,
  );
  for (const name of ['claude-code', 'openai', 'anthropic']) {
    assert.equal(providerCapabilities(name).references, false);
    assert.throws(
      () =>
        validateGenerationRequest(name, { prompt: 'dragon', model: 'selected', references: refs }),
      /require the Codex/,
    );
  }
  assert.equal(providerCapabilities('codex').maxReferences, 8);
  assert.throws(() => providerCapabilities('unsafe'));
});

test('JSON contracts have no FXL-only contradiction, image roles preserve order and legacy instructions stay stable', () => {
  assert.equal(generationInstructions({}), PLANNER_INSTRUCTIONS);
  assert.equal(
    generationInstructions({ referencePNG: image() }),
    PLANNER_INSTRUCTIONS + '\n' + REFERENCE_INSTRUCTIONS,
  );
  for (const outputFormat of ['design', 'patch']) {
    const instructions = generationInstructions({
      outputFormat,
      outputInstructions: 'Contract: {"version":1}',
      references: [
        { role: 'back', png: image() },
        { role: 'front', png: image(200) },
      ],
    });
    assert.ok(
      instructions.includes(`ONLY a JSON ${outputFormat === 'patch' ? 'array' : 'object'}`),
    );
    assert.doesNotMatch(instructions, /ONLY valid compact FXL/);
    assert.ok(instructions.indexOf('Image 1: back') < instructions.indexOf('Image 2: front'));
    assert.match(instructions, /untrusted data/);
  }
  for (const request of [
    { outputFormat: 'script' },
    { outputFormat: 'design' },
    { outputInstructions: '' },
    { outputInstructions: 'x'.repeat(32001) },
  ])
    assert.throws(() => generationInstructions(request));
  const paths = [join(tmpdir(), 'front view.png'), join(tmpdir(), 'back.png')];
  const args = cliArguments('codex', 'selected', paths);
  assert.deepEqual(
    args.flatMap((s, i) => (s === '--image' ? [args[i + 1]] : [])),
    paths,
  );
  assert.equal(args.at(-1), '-');
  assert.throws(() => cliArguments('codex', undefined, ['relative.png']));
  assert.throws(() => cliArguments('codex', undefined, new Array(9).fill(paths[0])));
  assert.throws(() => cliArguments('claude-code', undefined, paths));
});

test('Codex transport stages only normalized role-labeled pixels, cleans files and reports one real usage event', async () => {
  let calls = 0,
    directory,
    usage;
  const original = new PNG({ width: 1, height: 1 });
  original.data.set([100, 20, 30, 255]);
  const request = {
    prompt: 'Use these views; $(echo do not execute)',
    outputFormat: 'design',
    outputInstructions: 'Contract: {"version":1}',
    references: [
      { role: 'front', png: PNG.sync.write(original, { colorType: 2 }) },
      { role: 'right', png: image(200) },
    ],
    onUsage: (v) => {
      usage = v;
    },
  };
  const provider = createProvider('codex', {
    process: async (executable, args, input, cwd) => {
      calls++;
      directory = cwd;
      assert.equal(executable, 'codex');
      assert.ok(args.includes('read-only'));
      const paths = args.flatMap((s, i) => (s === '--image' ? [args[i + 1]] : []));
      assert.deepEqual(
        paths.map((path) => basename(path)),
        ['reference-1-front.png', 'reference-2-right.png'],
      );
      for (const path of paths) assert.ok(isAbsolute(path));
      assert.deepEqual(decodePNG(await readFile(paths[0])).pixels, decodePNG(image()).pixels);
      assert.deepEqual(
        new Uint8Array(await readFile(paths[0])),
        normalizeReferences(request)[0].png,
      );
      assert.match(input, /Image 1: front\nImage 2: right/);
      assert.match(input, /\$\(echo do not execute\)/);
      assert.doesNotMatch(input, /ONLY valid compact FXL/);
      return codexResult();
    },
  });
  assert.equal(await provider.generate(request), '{"version":1}');
  assert.equal(calls, 1);
  assert.deepEqual(usage, {
    inputTokens: 120,
    outputTokens: 30,
    cachedInputTokens: 90,
    reasoningOutputTokens: null,
  });
  await assert.rejects(access(directory));
  await assert.rejects(
    provider.generate({ ...request, references: new Array(9).fill(request.references[0]) }),
  );
  assert.equal(calls, 1, 'invalid pack must fail before any transport');
});

test('Claude JSON result extracts cache-inclusive reported usage and rejects tool/error/incomplete envelopes', () => {
  assert.deepEqual(parseClaudeResult(claudeResult()), {
    source: 'model sentinel',
    usage: {
      inputTokens: 165,
      outputTokens: 12,
      cachedInputTokens: 40,
      reasoningOutputTokens: null,
    },
  });
  assert.equal(parseClaudeResult(claudeResult({ usage: undefined })).usage, null);
  for (const changes of [
    { is_error: true },
    { subtype: 'error_max_turns' },
    { result: '' },
    { num_turns: 2 },
    { permission_denials: [{}] },
    { stop_reason: 'max_tokens' },
    { usage: { server_tool_use: { web_search_requests: 1 } } },
  ])
    assert.throws(() => parseClaudeResult(claudeResult(changes)));
  assert.throws(() => parseClaudeResult('model sentinel'), /JSON/);
  assert.equal(
    anthropicTokenUsage({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: -1 }),
    null,
  );
  assert.equal(
    anthropicTokenUsage({
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: 1,
      cache_creation_input_tokens: 1,
    }),
    null,
  );
});

test('Claude native transport preserves subscription login and never silently uses environment API billing', async () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'must-not-use';
  let generations = 0,
    auth = 0,
    usage;
  try {
    const provider = createProvider('claude-code', {
      process: async (executable, args, input, cwd, duration, signal, environment) => {
        assert.equal(executable, 'claude');
        assert.equal(environment.ANTHROPIC_API_KEY, undefined);
        assert.equal(environment.CLAUDE_CODE_SIMPLE, undefined);
        if (args.includes('auth')) {
          auth++;
          return JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' });
        }
        generations++;
        assert.ok(!args.includes('--bare'));
        assert.ok(args.includes('--disable-slash-commands'));
        assert.equal(args[args.indexOf('--tools') + 1], '');
        assert.equal(args[args.indexOf('--output-format') + 1], 'json');
        assert.equal(JSON.parse(args[args.indexOf('--settings') + 1]).disableAllHooks, true);
        return claudeResult();
      },
    });
    assert.equal(
      await provider.generate({
        prompt: 'sentinel',
        onUsage: (v) => {
          usage = v;
        },
      }),
      'model sentinel',
    );
    assert.equal(auth, 1);
    assert.equal(generations, 1);
    assert.equal(usage.inputTokens, 165);
    const apiOnly = createProvider('claude-code', {
      process: async () => JSON.stringify({ loggedIn: true, authMethod: 'api_key' }),
    });
    await assert.rejects(apiOnly.generate({ prompt: 'sentinel' }), /subscription authentication/);
  } finally {
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});

test('API design/repair prompts and cancellation are carried by injected HTTP without a live charge', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-test';
  let calls = 0;
  try {
    for (const outputFormat of ['design', 'patch']) {
      const provider = createProvider('openai', {
        fetch: async (url, init) => {
          calls++;
          const body = JSON.parse(init.body);
          assert.ok(
            body.instructions.includes(
              `ONLY a JSON ${outputFormat === 'patch' ? 'array' : 'object'}`,
            ),
          );
          assert.doesNotMatch(body.instructions, /ONLY valid compact FXL/);
          assert.equal(body.store, false);
          assert.ok(init.signal instanceof AbortSignal);
          return new Response(
            JSON.stringify({
              status: 'completed',
              output: [{ content: [{ type: 'output_text', text: '{"version":1}' }] }],
            }),
          );
        },
      });
      assert.equal(
        await provider.generate({
          prompt: 'dragon',
          model: 'explicit',
          outputFormat,
          outputInstructions: 'Contract: {"version":1}',
        }),
        '{"version":1}',
      );
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        provider.generate({ prompt: 'dragon', model: 'explicit', signal: controller.signal }),
      );
    }
    assert.equal(calls, 2, 'cancelled requests make no HTTP call');
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('native cancellation terminates the active process and pre-cancellation never starts transport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-cancel-'));
  try {
    const already = new AbortController();
    already.abort();
    await assert.rejects(
      runProcess('never-run-me', [], '', dir, 5000, already.signal),
      /cancelled/,
    );
    const controller = new AbortController();
    const process = runProcess(
      globalThis.process.execPath,
      ['-e', 'setTimeout(()=>{},10000)'],
      '',
      dir,
      5000,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(process, /cancelled/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  parseFXL,
  skinTexture,
  SKIN_KINDS,
  analyzeQuality,
  exportBBModel,
  importBBModel,
  serialize,
  geometry,
  renderPixels,
  renderPNG,
  RENDER_VIEWS,
  encodePNG,
} from '../packages/core/dist/index.js';
import {
  parseCodexEvents,
  tokenUsage,
  cliArguments,
  createProvider,
} from '../packages/providers/dist/index.js';
import { main } from '../packages/cli/dist/index.js';
import { benchmark } from '../scripts/benchmark.mjs';

test('compact fixture remains equivalent to expanded source and retains measured reduction', async () => {
  const result = benchmark(await readFile('examples/ironroot_knight.fxl', 'utf8'));
  assert.equal(result.cubes, 85);
  assert.equal(result.groups, 22);
  assert.ok(result.sourceByteReduction > 0.25);
  assert.equal(result.tokenSavingsMeasured, false);
});

test('ordered components preserve geometry, pivots, hierarchical IDs and animation through export', () => {
  const source = `model assembly
skin rock stone "#556677" "#889999" seed 7
component joint { group hinge origin [0,1,0] rotate [0,0,90] { cube block [0,0,0] [1,2,1] surface rock } }
component pair { use joint a at [0,0,0] use joint b at [4,0,0] }
group rig { use pair left at [10,0,0] scale [2,2,2] }
animation idle 1 loop { rotate "rig/left/a/hinge" 0 [0,0,0] rotate "rig/left/a/hinge" 1 [0,0,10] }`;
  const m = parseFXL(source);
  assert.equal(m.cubes.length, 2);
  const left = m.cubes.find((c) => c.id === 'rig/left/a/hinge/block');
  assert.deepEqual(left.from, [10, 0, 0]);
  assert.deepEqual(left.to, [12, 4, 2]);
  assert.deepEqual(m.groups.find((g) => g.id === 'rig/left/a/hinge').origin, [10, 2, 0]);
  assert.ok(geometry(m).every((c) => c.vertices.every((v) => v.every(Number.isFinite))));
  assert.equal(serialize(importBBModel(exportBBModel(m))), serialize(m));
  assert.equal(analyzeQuality(m).textureCoverage, 1);
  const reused = parseFXL(
    'model m component p { cube c [1,0,0] [1,1,1] } mirror x { use p a at [2,0,0] }',
  );
  assert.equal(reused.cubes.length, 2);
  assert.equal(new Set(reused.cubes.map((c) => c.id)).size, 2);
  assert.deepEqual(
    reused.cubes.map((c) => c.from[0]).sort((a, b) => a - b),
    [-4, 3],
  );
});

test('components reject unsafe expansion, invalid unused prototypes and ambiguous transforms', () => {
  for (const source of [
    'model m component a { use a x at [0,0,0] }',
    'model m use missing x at [0,0,0]',
    'model m component a { cube c [0,0,0] [0,1,1] }',
    'model m component a { cube c [0,0,0] [1,1,1] } use a x at [0,0,0] use a x at [1,0,0]',
    'model m component a {} component a {}',
    'model m component a { cube c [0,0,0] [1,1,1] } use a x at [0,0,0] scale [1,2,1]',
    'model m component a { cube c [0,0,0] [1,1,1] } use a x at [0,0,0] scale [0,0,0]',
    'model m component a { repeat 1000 offset [1,0,0] { cube c [0,0,0] [1,1,1] } } repeat 20 offset [0,1,0] { use a x at [0,0,0] }',
    'model m component a {} ' +
      Array.from({ length: 33 }, (_, i) => `skin t${i} stone "#556677" "#889999"`).join('\n'),
  ])
    assert.throws(() => parseFXL(source));
});

test('all local skins are deterministic RGBA textures with bounded nondegenerate UVs', () => {
  for (const kind of SKIN_KINDS) {
    const t = skinTexture('s', kind, '#445566', '#aaa999', 12);
    assert.deepEqual(t, skinTexture('s', kind, '#445566', '#aaa999', 12));
    const decoded = PNG.sync.read(
      Buffer.from(encodePNG({ ...t, pixels: Uint8Array.from(t.pixels) })),
    );
    assert.equal(decoded.width, 32);
    assert.deepEqual([...decoded.data], t.pixels);
    const m = parseFXL(
      `model m skin s ${kind} "#445566" "#aaa999" seed 12 cube c [0,0,0] [.1,60,4] surface s`,
    );
    assert.deepEqual(analyzeQuality(m).issues, []);
    assert.equal(serialize(importBBModel(exportBBModel(m))), serialize(m));
  }
  assert.notDeepEqual(
    skinTexture('s', 'stone', '#445566', '#aaa999', 1),
    skinTexture('s', 'stone', '#445566', '#aaa999', 2),
  );
  for (const seed of [-1, 0.5, 4294967296])
    assert.throws(() => skinTexture('s', 'stone', '#445566', '#aaa999', seed));
  assert.throws(() => skinTexture('s', 'unknown', '#445566', '#aaa999'));
});

test('quality reports actual authoring faults without treating intentional swatches as faults', () => {
  const m = parseFXL(
    'model m material gold "#ffaa44" cube a [0,0,0] [1,1,1] material gold cube b [0,0,0] [1,1,1] material gold',
  );
  assert.equal(analyzeQuality(m).issues[0].code, 'duplicate-cuboid');
  m.cubes.pop();
  assert.deepEqual(analyzeQuality(m).issues, []);
  m.cubes[0].faces.north.uv = [0, 0, 0, 1];
  m.cubes[0].faces.south.uv = [-1, 0, 999, 1];
  const q = analyzeQuality(m);
  assert.equal(q.zeroAreaUVs, 1);
  assert.equal(q.outsideTextureUVs, 1);
});

test('orthographic views show the expected colored face with correct occlusion', () => {
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
  const faces = ['north', 'south', 'west', 'east', 'up', 'down'];
  const m = parseFXL(
    'model m ' +
      colors.map((c, i) => `material m${i} "${c}"`).join(' ') +
      ' cube c [0,0,0] [2,3,4]',
  );
  // bakeMaterials only creates used swatches; supply each face its own 1px texture.
  m.textures = colors.map((color, i) => ({
    id: `t${i}`,
    name: `t${i}.png`,
    width: 1,
    height: 1,
    pixels: [
      ...color
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16)),
      255,
    ],
  }));
  m.cubes[0].faces = Object.fromEntries(
    faces.map((face, i) => [face, { uv: [0, 0, 1, 1], texture: `t${i}` }]),
  );
  for (const [view, i] of [
    ['front', 0],
    ['back', 1],
    ['left', 2],
    ['right', 3],
    ['top', 4],
  ]) {
    const image = renderPixels(m, { width: 64, height: 64, view });
    const center = [...image.pixels.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 3)];
    const expected = m.textures[i].pixels.slice(0, 3).map((v) => v > 0);
    assert.deepEqual(
      center.map((v) => v > 0),
      expected,
      view,
    );
  }
  assert.deepEqual(renderPNG(m), renderPNG(m, { view: 'isometric' }));
  assert.throws(() => renderPNG(m, { view: 'unknown' }), /view/);
  assert.equal(RENDER_VIEWS.length, 6);
});

test('Codex JSON events yield only final source and reported usage; tool attempts fail closed', () => {
  const events = (...items) => items.map((i) => JSON.stringify(i)).join('\n');
  const message = {
    type: 'item.completed',
    item: { type: 'agent_message', text: 'model m cube a [0,0,0] [1,1,1]' },
  };
  const complete = {
    type: 'turn.completed',
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cached_input_tokens: 500,
      reasoning_output_tokens: 30,
    },
  };
  assert.deepEqual(
    parseCodexEvents(
      events(
        { type: 'thread.started' },
        { type: 'item.completed', item: { type: 'reasoning', text: 'private' } },
        message,
        complete,
      ),
    ),
    {
      source: message.item.text,
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cachedInputTokens: 500,
        reasoningOutputTokens: 30,
      },
    },
  );
  assert.equal(parseCodexEvents(events(message, { type: 'turn.completed' })).usage, null);
  for (const text of [
    'oops',
    events(message),
    events(message, complete, complete),
    events(message, { type: 'turn.failed' }),
    events(message, complete, message),
    ...['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].map((type) =>
      events({ type: 'item.started', item: { type } }, message, complete),
    ),
  ])
    assert.throws(() => parseCodexEvents(text));
  assert.equal(tokenUsage(-1, 2, 0, 0), null);
  assert.equal(tokenUsage(1, 2, undefined, undefined).cachedInputTokens, null);
  assert.ok(cliArguments('codex').includes('--json'));
});

test('CLI opt-in cache saves one validated source, skips repeat calls, and fails closed on corruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'formixel-cache-'));
  const oldFetch = globalThis.fetch,
    oldLog = console.log,
    oldKey = process.env.OPENAI_API_KEY;
  const logs = [];
  let calls = 0;
  process.env.OPENAI_API_KEY = 'test-only';
  console.log = (value) => logs.push(value);
  const source = 'model m material a "#ffee44" cube c [0,0,0] [2,3,4] material a';
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: source }] }],
        usage: {
          input_tokens: 321,
          output_tokens: 32,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    );
  };
  const args = (name) => [
    'generate',
    'boss',
    '--provider',
    'openai',
    '--model',
    'test-model',
    '--cache',
    join(dir, 'cache'),
    '-o',
    join(dir, name),
  ];
  try {
    await main(args('first.fxl'));
    assert.equal(JSON.parse(logs.at(-1)).generation.usage.inputTokens, 321);
    delete process.env.OPENAI_API_KEY;
    await main(args('second.fxl'));
    assert.equal(calls, 1);
    assert.equal(JSON.parse(logs.at(-1)).generation.requests, 0);
    assert.equal(JSON.parse(logs.at(-1)).generation.cacheHit, true);
    assert.equal(JSON.parse(logs.at(-1)).generation.usage, null);
    assert.equal((await readFile(join(dir, 'second.fxl'), 'utf8')).trim(), source);
    const [file] = await readdir(join(dir, 'cache'));
    const entry = await readFile(join(dir, 'cache', file), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(entry)).sort(), ['source', 'version']);
    await writeFile(join(dir, 'cache', file), '{"version":1,"source":"eval bad"}');
    await assert.rejects(main(args('third.fxl')));
    assert.equal(calls, 1);
    await assert.rejects(access(join(dir, 'third.fxl')));
    await assert.rejects(main([...args('fourth.fxl'), '--timeout', 'NaN']), /Timeout/);
    process.env.OPENAI_API_KEY = 'test-only';
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: 'model empty' }] }],
        }),
      );
    };
    await assert.rejects(
      main([
        'generate',
        'empty',
        '--provider',
        'openai',
        '--model',
        'test-model',
        '--cache',
        join(dir, 'invalid'),
        '-o',
        join(dir, 'empty.fxl'),
      ]),
      /no geometry/,
    );
    await assert.rejects(access(join(dir, 'invalid')));
    await assert.rejects(access(join(dir, 'empty.fxl')));
  } finally {
    globalThis.fetch = oldFetch;
    console.log = oldLog;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test('optional Anthropic API reports nullable counters without fabricating usage', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-only';
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'model m' }],
          usage: { input_tokens: 40, output_tokens: 5, cache_read_input_tokens: 10 },
        }),
      );
    let usage;
    await createProvider('anthropic').generate({
      prompt: 'boss',
      model: 'test-model',
      onUsage: (u) => (usage = u),
    });
    assert.deepEqual(usage, {
      inputTokens: 40,
      outputTokens: 5,
      cachedInputTokens: 10,
      reasoningOutputTokens: null,
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  parseFXL,
  exportBBModel,
  importBBModel,
  encodePNG,
  createModelContext,
  exportBBModelWithContext,
  validateModelContext,
} from '../packages/core/dist/index.js';

test('native context follows editor UUIDs and remains exportable for subsequent refinements', async () => {
  const h = harness(),
    w = h.workspace;
  h.server.stripIDs = true;
  const model = importBBModel(h.server.output);
  model.cubes[0].to[1] = 3.0000000000000004;
  const context = createModelContext(model, {
    brief: { anatomy: 'prop', floor: 0, forward: [1, 0, 0] },
    roles: { body: 'body' },
    constraints: [{ id: 'planted', type: 'ground', cubes: ['body/chest'], floor: 0, tolerance: 0 }],
  });
  h.server.output = exportBBModelWithContext(model, context);
  await h.connect();
  w.setFormValues({ prompt: 'A textured prop', provider: 'codex' });
  w.options.onButton(0);
  await settle();
  h.server.status = 'completed';
  w.options.onButton(1);
  await settle();
  w.options.onButton(3);
  w.options.onButton(4);
  assert.equal(h.loads.length, 1);
  assert.equal(h.getCurrent().elements[0].formixel_id, undefined);
  assert.match(w.values.rigStatus, /context checked/);
  assert.equal(w.values.forward, '1,0,0');
  w.options.form.rigActions.click(2);
  assert.equal(h.exports.length, 1);
  const exported = JSON.parse(h.exports[0].content),
    current = importBBModel(h.getSaved());
  assert.deepEqual(validateModelContext(current, exported), exported);
  assert.equal(exported.roles.body, current.groups[0].id);
  assert.equal(exported.constraints[0].cubes[0], current.cubes[0].id);
  h.context.Outliner.selected = [{ uuid: h.getCurrent().elements[0].uuid }];
  w.options.form.useSelection.click();
  w.setFormValues({ prompt: 'Improve only the chest texture', kind: 'refine' });
  w.options.onButton(0);
  await settle();
  const posts = h.requests.filter((r) => new URL(r.url).pathname === '/jobs');
  assert.equal(posts.length, 2, JSON.stringify(h.errors));
  const body = JSON.parse(posts.at(-1).options.body);
  assert.equal(body.roles.body, current.groups[0].id);
  assert.deepEqual(body.brief.forward, [1, 0, 0]);
  assert.equal(body.constraints[0].cubes[0], current.cubes[0].id);
  h.plugin.onunload();
});

const TOKEN = 'a'.repeat(64),
  JOB = '12345678-1234-1234-1234-123456789abc';
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};
function harness() {
  let plugin,
    action,
    sequence = 0,
    currentImport;
  const dialogs = new Map(),
    timers = new Map(),
    requests = [],
    loads = [],
    errors = [],
    exports = [],
    messages = [];
  const base = exportBBModel(
    parseFXL(
      'model Original skin s stone "#34363c" "#56585d" seed 7 group arm { cube hand [0,0,0] [1,2,1] surface s } group other { cube foot [2,0,0] [1,1,1] surface s }',
    ),
  );
  const output = exportBBModel(
    parseFXL(
      'model Improved skin s metal "#592a26" "#a34b39" seed 2 group body { cube chest [0,0,0] [2,3,1] surface s }',
    ),
  );
  let currentNative = structuredClone(base);
  const server = {
    status: 'running',
    phase: 'planning',
    output,
    delayPost: false,
    resolvePost: undefined,
  };
  const response = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const context = {
    TextEncoder,
    TextDecoder,
    ArrayBuffer,
    Uint8Array,
    DataView,
    AbortController,
    structuredClone,
    btoa,
    atob,
    setTimeout(fn, ms) {
      const id = ++sequence;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    Plugin: {
      register(id, p) {
        assert.equal(id, 'formixel');
        plugin = p;
      },
    },
    Action: class {
      constructor(id, options) {
        action = options;
      }
      delete() {}
    },
    Dialog: class {
      constructor(options) {
        this.options = options;
        this.values = Object.fromEntries(
          Object.entries(options.form ?? {}).map(([key, field]) => [key, field.value ?? '']),
        );
        dialogs.set(options.id, this);
      }
      getFormResult() {
        return this.values;
      }
      setFormValues(values) {
        Object.assign(this.values, values);
      }
      show() {}
      hide() {}
    },
    MenuBar: { addAction() {} },
    Blockbench: {
      showQuickMessage(message) {
        messages.push(message);
      },
      showMessageBox(options) {
        errors.push(options);
      },
      export(options) {
        exports.push(options);
      },
      import(options, callback) {
        currentImport = { options, callback };
      },
    },
    Codecs: {
      project: {
        compile(options) {
          assert.equal(options.raw, false);
          assert.equal(options.bitmaps, true);
          return JSON.stringify(currentNative, (_, value) =>
            typeof value === 'number' ? Number(value.toFixed(6)) : value,
          );
        },
        load(model, file) {
          loads.push({ model, file });
          currentNative = structuredClone(model);
          if (server.stripIDs) {
            const strip = (value) => {
              if (!value || typeof value !== 'object') return;
              delete value.formixel_id;
              delete value.formixel_context;
              Object.values(value).forEach((child) =>
                Array.isArray(child) ? child.forEach(strip) : strip(child),
              );
            };
            strip(currentNative);
          }
        },
      },
    },
    Project: { name: 'Original' },
    Outliner: {
      selected: [{ uuid: base.elements.find((e) => e.formixel_id === 'arm/hand').uuid }],
    },
    Group: { multi_selected: [] },
    async fetch(url, options) {
      requests.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      const path = new URL(url).pathname;
      if (path === '/health') return response({ service: 'Formixel', protocol: 1, active: false });
      if (path === '/jobs' && options.method === 'POST') {
        if (server.delayPost)
          await new Promise((resolve) => {
            server.resolvePost = resolve;
          });
        return response({ id: JOB, status: 'running' }, 202);
      }
      if (path === `/jobs/${JOB}/cancel`) {
        server.status = 'cancelled';
        server.phase = 'cancelled';
        return response({ id: JOB, status: 'cancelled' });
      }
      if (path === `/jobs/${JOB}/result`)
        return response({
          model: server.output,
          review: { technical: { issues: [] } },
          metrics: { requests: 1, usage: { inputTokens: 32, outputTokens: 54 } },
          ...(server.design ? { design: server.design } : {}),
        });
      if (path === `/jobs/${JOB}`)
        return response({ id: JOB, status: server.status, phase: server.phase });
      return response({ error: 'Unknown' }, 404);
    },
  };
  vm.runInNewContext(readFileSync('packages/blockbench/dist/formixel.js', 'utf8'), context);
  plugin.onload();
  action.click();
  const main = dialogs.get('formixel_panel');
  assert.deepEqual(Array.from(main.options.buttons.slice(0, 4)), [
    'Build FXL',
    'Load FXL',
    'Export task',
    'Close',
  ]);
  main.options.onButton(4);
  const workspace = dialogs.get('formixel_workspace');
  const connect = async () => {
    workspace.setFormValues({ endpoint: 'http://127.0.0.1:9187', token: TOKEN });
    workspace.options.form.connection.click(0);
    await settle();
  };
  return {
    plugin,
    dialogs,
    timers,
    requests,
    loads,
    errors,
    messages,
    exports,
    server,
    context,
    workspace,
    connect,
    base,
    getImport: () => currentImport,
    getCurrent: () => currentNative,
    getSaved: () =>
      JSON.parse(
        JSON.stringify(currentNative, (_, value) =>
          typeof value === 'number' ? Number(value.toFixed(6)) : value,
        ),
      ),
  };
}

test('paired workspace connects, submits once, polls progress, validates, reviews and applies a new project', async () => {
  const h = harness(),
    w = h.workspace;
  assert.equal(h.requests.length, 0, 'opening the panel never contacts a bridge');
  await h.connect();
  assert.match(w.values.status, /Connected/);
  w.setFormValues({ prompt: 'Create a crimson dragon', provider: 'codex', kind: 'craft' });
  h.server.delayPost = true;
  w.options.onButton(0);
  w.options.onButton(0);
  await settle();
  assert.equal(h.requests.filter((r) => new URL(r.url).pathname === '/jobs').length, 1);
  assert.ok(h.errors.some((e) => /already running/.test(e.message)));
  h.server.resolvePost();
  await settle();
  const timer = [...h.timers.entries()].find(([, t]) => t.ms === 1500);
  assert.ok(timer);
  h.timers.delete(timer[0]);
  timer[1].fn();
  await settle();
  assert.match(w.values.status, /running: planning/);
  h.server.status = 'completed';
  h.server.phase = 'ready';
  w.options.onButton(1);
  await settle();
  assert.match(w.values.status, /Ready for review/);
  assert.equal(h.loads.length, 0);
  w.options.onButton(4);
  assert.equal(h.loads.length, 0, 'apply requires an explicit review step');
  w.options.onButton(3);
  assert.ok(h.dialogs.has('formixel_review'));
  w.options.onButton(4);
  assert.equal(h.loads.length, 1);
  assert.equal(importBBModel(h.loads[0].model).name, 'Improved');
  assert.equal(h.loads[0].file.no_file, true);
  assert.equal([...h.timers.values()].filter((t) => t.ms === 1500).length, 0);
  h.plugin.onunload();
  assert.equal(w.values.token, '');
  assert.equal(h.timers.size, 0);
});

test('refine uses a validated embedded snapshot and explicit actual outliner selection', async () => {
  const h = harness(),
    w = h.workspace;
  await h.connect();
  w.setFormValues({
    kind: 'refine',
    prompt: 'Lower only the selected wrist',
    provider: 'codex',
    selection: '',
  });
  w.options.onButton(0);
  await settle();
  assert.ok(h.errors.some((e) => /Choose parts/.test(e.message)));
  assert.equal(h.requests.filter((r) => new URL(r.url).pathname === '/jobs').length, 0);
  w.options.form.useSelection.click();
  assert.equal(w.values.selection, 'node:arm/hand');
  w.options.onButton(0);
  await settle();
  const body = JSON.parse(h.requests.find((r) => new URL(r.url).pathname === '/jobs').options.body);
  assert.equal(body.kind, 'refine');
  assert.deepEqual(body.selection, ['node:arm/hand']);
  assert.equal(body.base.cubes.length, 2);
  assert.ok(body.base.textures[0].pixels.length > 0);
  assert.equal(body.base.cubes.find((c) => c.id === 'arm/hand').name, 'hand');
  h.plugin.onunload();
  assert.equal(h.timers.size, 0);
});

test('cancel reaches the paired bridge and terminal jobs stop polling', async () => {
  const h = harness(),
    w = h.workspace;
  await h.connect();
  w.setFormValues({ kind: 'craft', prompt: 'A model', provider: 'codex' });
  w.options.onButton(0);
  await settle();
  w.options.onButton(2);
  await settle();
  assert.ok(h.requests.some((r) => r.url.endsWith('/cancel') && r.options.method === 'POST'));
  w.options.onButton(1);
  await settle();
  assert.match(w.values.status, /cancelled/);
  assert.equal([...h.timers.values()].filter((t) => t.ms === 1500).length, 0);
  w.options.onButton(5);
  assert.equal(w.values.token, '');
  assert.equal(h.timers.size, 0);
});

test('unsafe addresses, missing API models and malformed result models never reach editor mutation', async () => {
  const h = harness(),
    w = h.workspace;
  for (const endpoint of [
    'https://example.com',
    'http://localhost:9187',
    'http://127.0.0.1:9187/evil',
    'http://127.0.0.1:99999',
    'http://user@127.0.0.1:9187',
  ]) {
    w.setFormValues({ endpoint, token: TOKEN });
    w.options.form.connection.click(0);
    await settle();
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.errors.length, 5);
  await h.connect();
  w.setFormValues({ prompt: 'An API model', provider: 'openai', kind: 'craft', model: '' });
  w.options.onButton(0);
  await settle();
  assert.ok(h.errors.some((e) => /explicit API model/.test(e.message)));
  w.setFormValues({ provider: 'codex' });
  w.options.onButton(0);
  await settle();
  h.server.output.elements[0].type = 'mesh';
  h.server.status = 'completed';
  w.options.onButton(1);
  await settle();
  w.options.onButton(3);
  w.options.onButton(4);
  assert.equal(h.loads.length, 0);
  assert.ok(h.errors.some((e) => /unsupported|Unsupported|cuboid/i.test(e.message)));
  h.plugin.onunload();
});

test('PNG reference import records roles, strips metadata and uses only an explicitly selected Codex provider', async () => {
  const h = harness(),
    w = h.workspace;
  await h.connect();
  w.setFormValues({ referenceRole: 'front' });
  w.options.form.referenceActions.click(0);
  const file = h.getImport();
  assert.equal(file.options.readtype, 'buffer');
  const png = encodePNG({ width: 1, height: 1, pixels: new Uint8Array([200, 10, 0, 255]) });
  file.callback([
    {
      name: 'front.png',
      content: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    },
  ]);
  await settle();
  assert.match(w.values.references, /Front — front.png/);
  w.setFormValues({ prompt: 'Use the reference', provider: 'claude-code' });
  w.options.onButton(0);
  await settle();
  assert.ok(h.errors.some((e) => /require Codex/.test(e.message)));
  w.setFormValues({ provider: 'codex' });
  w.options.onButton(0);
  await settle();
  const body = JSON.parse(h.requests.find((r) => new URL(r.url).pathname === '/jobs').options.body);
  assert.equal(body.references.length, 1);
  assert.equal(body.references[0].role, 'front');
  assert.deepEqual(Buffer.from(body.references[0].pngBase64, 'base64'), Buffer.from(png));
  h.plugin.onunload();
  assert.equal(w.values.references, '');
});

test('active workspace cannot be orphaned by closing, and unload discards a late submission response', async () => {
  const h = harness(),
    w = h.workspace;
  await h.connect();
  w.setFormValues({ prompt: 'A detailed model', provider: 'codex' });
  h.server.delayPost = true;
  w.options.onButton(0);
  await settle();
  assert.equal(w.options.onButton(5), false);
  assert.ok(h.errors.some((e) => /Cancel the current job/.test(e.message)));
  assert.equal(w.values.token, TOKEN);
  h.plugin.onunload();
  assert.equal(w.values.token, '');
  assert.equal(h.timers.size, 0);
  h.server.resolvePost();
  await settle();
  assert.equal(h.timers.size, 0, 'late provider response must not restart polling after unload');
  assert.equal(h.loads.length, 0);
});

test('anatomy and weapon grip are explicit caller choices and rig sidecars validate current node references', async () => {
  const h = harness(),
    w = h.workspace;
  await h.connect();
  w.setFormValues({
    prompt: 'Create a creature',
    provider: 'codex',
    anatomy: 'quadruped',
    weaponHands: '2',
    floor: 3,
    airborneAnimations: 'leap,flight',
  });
  w.options.onButton(0);
  await settle();
  const first = JSON.parse(
    h.requests.find((r) => new URL(r.url).pathname === '/jobs').options.body,
  );
  assert.deepEqual(first.brief, {
    anatomy: 'quadruped',
    weaponHands: 2,
    floor: 3,
    airborneAnimations: ['leap', 'flight'],
  });
  w.options.onButton(2);
  await settle();
  w.options.onButton(1);
  await settle();
  w.setFormValues({
    kind: 'refine',
    anatomy: 'prop',
    weaponHands: 'none',
    floor: 0,
    airborneAnimations: '',
    selection: 'node:arm',
    prompt: 'Improve the forearm colour',
  });
  w.options.form.rigActions.click(0);
  let picker = h.getImport();
  picker.callback([{ content: JSON.stringify({ roles: { body: 'missing' } }) }]);
  assert.ok(h.errors.some((e) => /Unknown anatomy role/.test(e.message)));
  w.options.form.rigActions.click(0);
  picker = h.getImport();
  picker.callback([{ content: JSON.stringify({ roles: { body: 'arm' }, constraints: [] }) }]);
  assert.match(w.values.rigStatus, /loaded and references checked/);
  w.options.onButton(0);
  await settle();
  const posts = h.requests.filter((r) => new URL(r.url).pathname === '/jobs');
  const body = JSON.parse(posts.at(-1).options.body);
  assert.deepEqual(body.roles, { body: 'arm' });
  assert.deepEqual(body.constraints, []);
  assert.deepEqual(body.brief, { anatomy: 'prop', floor: 0 });
  h.plugin.onunload();
});

test('applied rig metadata is reused only when the actual editor snapshot fingerprint still matches', async () => {
  for (const changed of [false, true]) {
    const h = harness(),
      w = h.workspace;
    await h.connect();
    h.server.design = {
      version: 1,
      source: 'model Improved group body { cube chest [0,0,0] [2,3,1] }',
      authoring: { roles: { body: 'body' }, constraints: [] },
    };
    w.setFormValues({ prompt: 'A model with rig metadata', provider: 'codex' });
    w.options.onButton(0);
    await settle();
    h.server.status = 'completed';
    w.options.onButton(1);
    await settle();
    w.options.onButton(3);
    w.options.onButton(4);
    assert.equal(h.loads.length, 1);
    if (changed) h.getCurrent().elements[0].from[0] -= 0.25;
    w.setFormValues({
      kind: 'refine',
      prompt: 'Improve the chest finish',
      selection: 'node:body',
      anatomy: 'prop',
      weaponHands: 'none',
    });
    w.options.onButton(0);
    await settle();
    const posts = h.requests.filter((r) => new URL(r.url).pathname === '/jobs');
    assert.equal(posts.length, 2);
    const body = JSON.parse(posts.at(-1).options.body);
    if (changed) {
      assert.equal(body.roles, undefined);
      assert.equal(body.constraints, undefined);
    } else {
      assert.deepEqual(body.roles, { body: 'body' });
      assert.deepEqual(body.constraints, []);
    }
    h.plugin.onunload();
  }
});

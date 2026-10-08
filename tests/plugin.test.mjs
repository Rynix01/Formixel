import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
test('bundled bridge validates before project creation and cleans up action', () => {
  let plugin,
    action,
    dialog,
    form = {},
    projects = 0,
    deleted = false;
  const models = [],
    cubes = [],
    groups = [],
    errors = [];
  const context = {
    TextEncoder,
    btoa,
    structuredClone,
    Plugin: {
      register(id, p) {
        assert.equal(id, 'formixel');
        plugin = p;
      },
    },
    Action: class {
      constructor(id, p) {
        action = p;
      }
      delete() {
        deleted = true;
      }
    },
    Dialog: class {
      constructor(p) {
        dialog = p;
      }
      getFormResult() {
        return form;
      }
      show() {}
    },
    MenuBar: { addAction() {} },
    Blockbench: {
      showQuickMessage() {},
      showMessageBox(e) {
        errors.push(e);
      },
      export() {},
    },
    Codecs: {
      project: {
        load(model) {
          projects++;
          models.push(model);
          cubes.push(...model.elements);
          groups.push(...model.outliner.filter((x) => typeof x === 'object'));
        },
      },
    },
    Formats: { free: {} },
    newProject() {
      projects++;
      return true;
    },
    Group: class {
      constructor(p) {
        groups.push(p);
      }
      addTo() {
        return this;
      }
      init() {
        return this;
      }
    },
    Cube: class {
      constructor(p) {
        cubes.push(p);
      }
      addTo() {
        return this;
      }
      init() {
        return this;
      }
    },
    Canvas: { updateAll() {} },
    Project: {},
  };
  vm.runInNewContext(readFileSync('packages/blockbench/dist/formixel.js', 'utf8'), context);
  plugin.onload();
  action.click();
  form = { source: 'invalid' };
  dialog.onButton(0);
  assert.equal(projects, 0);
  assert.equal(errors.length, 1);
  form = { source: 'model x group g { cube a [0,0,0] [1,1,1] }' };
  dialog.onButton(0);
  assert.equal(projects, 1);
  assert.equal(cubes.length, 1);
  assert.equal(groups.length, 1);
  assert.equal(context.Project.name, 'x');
  form = {
    source:
      'model assembly skin metal metal "#967b49" "#e1c181" seed 6 component plate { cube c [-1,0,-1] [2,3,2] surface metal } use plate a at [3,0,0] use plate b at [-3,0,0]',
  };
  dialog.onButton(0);
  assert.equal(projects, 2);
  assert.equal(models.at(-1).elements.length, 2);
  assert.equal(models.at(-1).textures.length, 1);
  assert.ok(models.at(-1).textures[0].source.startsWith('data:image/png;base64,'));
  plugin.onunload();
  assert.equal(deleted, true);
});

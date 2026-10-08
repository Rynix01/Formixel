import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFXL,
  validate,
  serialize,
  exportBBModel,
  importBBModel,
  applyPatch,
  inspect,
  renderSVG,
  geometry,
} from '../packages/core/dist/index.js';
const source = readFileSync(new URL('../examples/golem.fxl', import.meta.url), 'utf8');
test('FXL to bbmodel roundtrip and deterministic compilation', () => {
  const m = parseFXL(source);
  assert.equal(m.cubes.length, 6);
  assert.equal(serialize(importBBModel(exportBBModel(m))), serialize(m));
  assert.deepEqual(exportBBModel(m), exportBBModel(parseFXL(source)));
  assert.deepEqual(inspect(m).bounds, { min: [-6, -8, -4.5], max: [6, 24, 4] });
});
test('patch is atomic, bounded and detects duplicate mirror identifiers', () => {
  const m = parseFXL(source),
    before = serialize(m);
  assert.throws(() =>
    applyPatch(m, [
      { op: 'rename', id: 'leg_left', name: 'changed' },
      { op: 'remove', id: 'unknown' },
    ]),
  );
  assert.equal(serialize(m), before);
  const mirrored = applyPatch(m, [{ op: 'mirror', id: 'leg_left', axis: 'x', newId: 'extra' }]);
  assert.deepEqual(mirrored.cubes.find((c) => c.id === 'extra').from, [1, -8, -2]);
  assert.throws(() =>
    applyPatch(m, [{ op: 'mirror', id: 'leg_left', axis: 'x', newId: 'leg_right' }]),
  );
});
test('rejects malformed, executable, unbounded and cyclic input', () => {
  for (const s of [
    'model x cube a [0,0,0] [0,1,1]',
    'model x eval "process.exit()"',
    'model x }',
    'model x cube a [0,0,0] [1e999,1,1]',
  ])
    assert.throws(() => parseFXL(s));
  const m = parseFXL(source);
  m.groups[0].parent = m.groups[1].id;
  assert.ok(validate(m).some((e) => e.message === 'Group cycle'));
  assert.ok(validate({}).length);
  assert.throws(() => parseFXL('x'.repeat(2_000_001)));
  const unknown = parseFXL('model x');
  unknown.script = 'malicious';
  assert.ok(validate(unknown).some((e) => e.message === 'Unknown BBIR property'));
});
test('group rotations affect actual vertices and preview escapes XML', () => {
  const m = parseFXL(
    'model "<script>" group g origin [0,0,0] rotate [0,0,90] { cube a [0,0,0] [1,2,1] }',
  );
  const p = geometry(m)[0].vertices[3];
  assert.ok(Math.abs(p[0] + 2) < 1e-9);
  assert.ok(Math.abs(p[1] - 1) < 1e-9);
  assert.ok(renderSVG(m).includes('&lt;script&gt;'));
  assert.equal(renderSVG(m), renderSVG(m));
});
test('import refuses unsupported/lossy Blockbench content', () => {
  const b = exportBBModel(parseFXL(source));
  b.textures = [{}];
  assert.throws(() => importBBModel(b), /embedded PNG/);
  const c = exportBBModel(parseFXL(source));
  c.elements[0].faces.north.uv = [1, 2, 3, 4];
  assert.deepEqual(
    importBBModel(c).cubes.find((cube) => cube.id === c.elements[0].formixel_id).faces.north.uv,
    [1, 2, 3, 4],
  );
});
test('compiler uses visible untextured faces; imports split Blockbench 5 group table', () => {
  const model = parseFXL(source);
  const b = exportBBModel(model);
  assert.ok(b.elements.every((c) => Object.values(c.faces).every((f) => f.texture === false)));
  const groups = [];
  const split = (nodes) =>
    nodes.map((n) => {
      if (typeof n === 'string') return n;
      const { children, ...group } = n;
      groups.push(group);
      return { uuid: n.uuid, children: split(children) };
    });
  b.outliner = split(b.outliner);
  b.groups = groups;
  b.meta.format_version = '5.0';
  assert.equal(serialize(importBBModel(b)), serialize(model));
  b.elements[0].faces.north.texture = null;
  assert.equal(
    importBBModel(b).cubes.find((c) => c.id === b.elements[0].formixel_id).faces.north.enabled,
    false,
  );
});
test('SVG preview culls back faces and uses opaque colors', () => {
  const svg = renderSVG(parseFXL('model box cube a [0,0,0] [1,1,1]'));
  assert.equal((svg.match(/<polygon /g) || []).length, 3);
  assert.ok(!svg.includes('fill-opacity'));
});

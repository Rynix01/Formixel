import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { canonical, serialize, LIMITS } from '../packages/core/dist/model.js';
import {
  createEmissionDocument,
  validateEmissionDocument,
  exportEmissionMasks,
  shadeEmission,
} from '../packages/core/dist/emission.js';

function fixture() {
  return canonical({
    version: 2,
    name: 'explicit emission',
    format: 'free',
    resolution: [2, 2],
    cubes: [
      {
        id: 'shell',
        name: 'shell',
        from: [0, 0, 0],
        to: [2, 2, 2],
        origin: [0, 0, 0],
        rotation: [0, 0, 0],
        color: 0,
        faces: { north: { texture: 'atlas/main', uv: [0, 0, 2, 2] } },
      },
    ],
    groups: [],
    textures: [
      {
        id: 'atlas/main',
        name: 'untrusted/name.png',
        width: 2,
        height: 2,
        pixels: [100, 200, 50, 255, 20, 40, 80, 128, 240, 120, 60, 0, 10, 30, 90, 64],
      },
    ],
  });
}

const mask = (texture = 'atlas/main') => ({
  texture,
  width: 2,
  height: 2,
  pixels: [0, 128, 255, 64],
});
const jsonClone = (value) => JSON.parse(JSON.stringify(value));
const readPNG = (asset) => PNG.sync.read(Buffer.from(asset.png));

test('emission sidecar binds exact serialized model data and returns independent single-channel masks', () => {
  const model = fixture(),
    masks = [mask()];
  const originalModel = serialize(model),
    originalMasks = jsonClone(masks);
  const document = createEmissionDocument(model, masks);
  assert.equal(document.version, 1);
  assert.equal(document.modelDigest, createHash('sha256').update(serialize(model)).digest('hex'));
  assert.deepEqual(document.masks, masks);
  assert.deepEqual(masks, originalMasks);
  assert.equal(serialize(model), originalModel);
  const validated = validateEmissionDocument(model, jsonClone(document));
  validated.masks[0].pixels[0] = 255;
  assert.equal(document.masks[0].pixels[0], 0);
  assert.equal(masks[0].pixels[0], 0);
  for (const alter of [
    (copy) => {
      copy.name = 'changed';
    },
    (copy) => {
      copy.cubes[0].to[0] += 0.1;
    },
    (copy) => {
      copy.textures[0].pixels[0] += 1;
    },
    (copy) => {
      copy.animations.push({ id: 'idle', name: 'idle', length: 1, loop: true, tracks: [] });
    },
  ]) {
    const changed = structuredClone(model);
    alter(changed);
    assert.throws(() => validateEmissionDocument(changed, document), /Stale emission document/);
    const fresh = createEmissionDocument(changed, masks);
    assert.notEqual(fresh.modelDigest, document.modelDigest);
    assert.deepEqual(validateEmissionDocument(changed, fresh), fresh);
  }
});

test('emission rejects unknown declarations, wrong sizes, missing textures and non-byte strengths', () => {
  const model = fixture(),
    valid = createEmissionDocument(model, [mask()]);
  for (const change of [
    (copy) => {
      copy.version = 2;
    },
    (copy) => {
      copy.modelDigest = 'bad';
    },
    (copy) => {
      copy.script = 'anything';
    },
    (copy) => {
      copy.masks[0].file = '../mask.png';
    },
    (copy) => {
      delete copy.masks[0].texture;
    },
    (copy) => {
      copy.masks[0].texture = 'main';
    },
    (copy) => {
      copy.masks[0].width = 1;
    },
    (copy) => {
      copy.masks[0].height = 4;
    },
    (copy) => {
      copy.masks[0].pixels = [0, 255];
    },
    (copy) => {
      copy.masks[0].pixels = [0, 1, 2, 3, 4];
    },
    (copy) => {
      copy.masks[0].pixels = new Uint8Array(4);
    },
    (copy) => {
      copy.masks[0].pixels = new Array(4);
    },
    (copy) => {
      copy.masks = [];
    },
    (copy) => {
      copy.masks = [copy.masks[0], copy.masks[0]];
    },
  ]) {
    const bad = structuredClone(valid);
    change(bad);
    assert.throws(() => validateEmissionDocument(model, bad));
  }
  for (const strength of [-1, 256, 0.5, NaN, Infinity, '255', null, undefined]) {
    const bad = structuredClone(valid);
    bad.masks[0].pixels[0] = strength;
    assert.throws(() => validateEmissionDocument(model, bad), /byte 0\.\.255/);
  }
  assert.throws(
    () => validateEmissionDocument(model, Object.assign(Object.create({}), valid)),
    /plain data/,
  );
  const symbol = structuredClone(valid);
  symbol[Symbol('unknown')] = true;
  assert.throws(() => validateEmissionDocument(model, symbol), /unknown field/);
  const accessor = structuredClone(valid);
  Object.defineProperty(accessor, 'version', {
    get() {
      throw new Error('getter executed');
    },
  });
  assert.throws(() => validateEmissionDocument(model, accessor), /plain data values/);
});

test('mask array accessors are rejected without invoking even a first valid value', () => {
  const model = fixture();
  for (const operation of [
    (document) => validateEmissionDocument(model, document),
    (document) => createEmissionDocument(model, document.masks),
    (document) => exportEmissionMasks(model, document),
  ]) {
    const document = createEmissionDocument(model, [mask()]);
    let reads = 0;
    Object.defineProperty(document.masks[0].pixels, '0', {
      enumerable: true,
      get() {
        return ++reads === 1 ? 0 : 999;
      },
    });
    assert.throws(() => operation(document), /plain data/);
    assert.equal(reads, 0, 'validation must inspect descriptors before reading pixel values');
  }
  const document = createEmissionDocument(model, [mask()]),
    originalMask = document.masks[0];
  let reads = 0;
  Object.defineProperty(document.masks, '0', {
    enumerable: true,
    get() {
      reads++;
      return originalMask;
    },
  });
  assert.throws(() => validateEmissionDocument(model, document), /plain data/);
  assert.equal(reads, 0, 'mask entries must also be own data properties');
});

test('mask arrays reject inherited indices, custom prototypes and caller-provided behavior', () => {
  const model = fixture();
  let calls = 0;
  class CustomArray extends Array {}
  const changes = [
    (values) => Object.setPrototypeOf(values, Object.create(Array.prototype)),
    (values) => Object.setPrototypeOf(values, null),
    (values) => new CustomArray(...values),
    (values) => {
      const inherited = Object.create(Array.prototype),
        original = values[0];
      Object.defineProperty(inherited, '0', {
        get() {
          calls++;
          return original;
        },
      });
      delete values[0];
      return Object.setPrototypeOf(values, inherited);
    },
    (values) => {
      values.entries = () => {
        calls++;
        throw new Error('caller-provided entries executed');
      };
      return values;
    },
    (values) => {
      Object.defineProperty(values, Symbol.iterator, {
        get() {
          calls++;
          throw new Error('caller-provided iterator executed');
        },
      });
      return values;
    },
  ];
  for (const change of changes) {
    for (const target of ['masks', 'pixels']) {
      const document = createEmissionDocument(model, [mask()]);
      if (target === 'masks') document.masks = change(document.masks);
      else document.masks[0].pixels = change(document.masks[0].pixels);
      assert.throws(() => validateEmissionDocument(model, document), /plain data|array field/);
    }
  }
  assert.equal(calls, 0);
  const document = createEmissionDocument(model, [mask()]);
  Object.freeze(document.masks[0].pixels);
  Object.freeze(document.masks[0]);
  Object.freeze(document.masks);
  Object.freeze(document);
  assert.deepEqual(validateEmissionDocument(model, document), document);
});

test('emission retains the existing model total-texel budget and prevents duplicate assignments', () => {
  const model = fixture();
  model.textures.push({ ...structuredClone(model.textures[0]), id: 'other' });
  assert.throws(() => createEmissionDocument(model, [mask(), mask()]), /duplicate mask/);
  const sorted = createEmissionDocument(model, [mask('other'), mask()]);
  assert.deepEqual(
    sorted.masks.map((value) => value.texture),
    ['atlas/main', 'other'],
  );
  const large = fixture();
  large.textures[0].width = 512;
  large.textures[0].height = 512;
  large.textures[0].pixels = new Array(LIMITS.pixels * 4).fill(255);
  assert.equal(
    createEmissionDocument(large, [
      { texture: 'atlas/main', width: 512, height: 512, pixels: new Array(LIMITS.pixels).fill(0) },
    ]).masks[0].pixels.length,
    LIMITS.pixels,
  );
  large.textures.push({
    id: 'overflow',
    name: 'overflow',
    width: 1,
    height: 1,
    pixels: [0, 0, 0, 255],
  });
  assert.throws(() => createEmissionDocument(large, []), /Texture pixel budget exceeded/);
  assert.throws(() => createEmissionDocument({ ...fixture(), textures: [] }, [mask()]));
});

test('grayscale PNGs reproduce mask bytes, exact size and deterministic safe asset names', () => {
  const model = fixture(),
    document = createEmissionDocument(model, [mask()]);
  const before = serialize(model),
    snapshot = JSON.stringify(document);
  const first = exportEmissionMasks(model, document),
    second = exportEmissionMasks(model, document);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].texture, 'atlas/main');
  assert.match(first[0].filename, /^atlas-main-[a-f0-9]{12}_emission\.png$/);
  assert.equal(first[0].png[24], 8);
  assert.equal(
    first[0].png[25],
    0,
    'PNG must be grayscale8 rather than RGBA pretending to be a mask',
  );
  const decoded = readPNG(first[0]);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(
    [...decoded.data],
    [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 64, 64, 64, 255],
  );
  const named = exportEmissionMasks(model, document, {
    target: 'grayscale',
    textureNames: { 'atlas/main': 'sentinel.png' },
  });
  assert.equal(named[0].filename, 'sentinel_emission.png');
  assert.equal(serialize(model), before);
  assert.equal(JSON.stringify(document), snapshot);
});

test('GeckoLib4 export preserves albedo RGB and multiplies its alpha by mask strength', () => {
  const model = fixture(),
    document = createEmissionDocument(model, [mask()]);
  const asset = exportEmissionMasks(model, document, {
    target: 'geckolib4',
    textureNames: { 'atlas/main': 'sentinel.png' },
  })[0];
  assert.equal(asset.filename, 'sentinel_glowmask.png');
  assert.equal(asset.png[25], 6);
  const decoded = readPNG(asset);
  assert.deepEqual(
    [...decoded.data],
    [100, 200, 50, 0, 20, 40, 80, 64, 240, 120, 60, 0, 10, 30, 90, 16],
  );
  assert.deepEqual(model.textures[0].pixels, fixture().textures[0].pixels);
  assert.deepEqual(
    exportEmissionMasks(model, document, {
      target: 'geckolib4',
      textureNames: { 'atlas/main': 'sentinel.png' },
    })[0].png,
    asset.png,
  );
  assert.throws(
    () => exportEmissionMasks(model, document, { target: 'geckolib4' }),
    /explicit base PNG name/,
  );
});

test('export rejects paths, device names, unknown targets, unknown IDs and case-insensitive collisions', () => {
  const model = fixture();
  model.textures.push({ ...structuredClone(model.textures[0]), id: 'atlas:main' });
  const document = createEmissionDocument(model, [mask(), mask('atlas:main')]);
  const generated = exportEmissionMasks(model, document);
  assert.equal(new Set(generated.map((asset) => asset.filename.toLowerCase())).size, 2);
  for (const filename of [
    '../sentinel.png',
    'a/b.png',
    'a\\b.png',
    'https://host/x.png',
    'C:sentinel.png',
    'con.png',
    'NUL.png',
    'sentinel.jpg',
    '.png',
    'sentinel.png.exe',
    'a.b.png',
    'x'.repeat(100) + '.png',
  ])
    assert.throws(
      () => exportEmissionMasks(model, document, { textureNames: { 'atlas/main': filename } }),
      /safe base PNG/,
    );
  for (const options of [
    { target: 'bloom' },
    { target: null },
    { unknown: true },
    { textureNames: { missing: 'sentinel.png' } },
  ])
    assert.throws(() => exportEmissionMasks(model, document, options));
  assert.throws(
    () =>
      exportEmissionMasks(model, document, {
        textureNames: { 'atlas/main': 'Sentinel.png', 'atlas:main': 'sentinel.png' },
      }),
    /filename collision/,
  );
});

test('fullbright compositing interpolates each RGB channel and always preserves albedo alpha', () => {
  const base = [100, 200, 50, 128],
    shaded = [20, 40, 10, 255];
  assert.deepEqual(shadeEmission(base, shaded, 0), [20, 40, 10, 128]);
  assert.deepEqual(shadeEmission(base, shaded, 255), base);
  assert.deepEqual(shadeEmission(base, shaded, 128), [60, 120, 30, 128]);
  assert.deepEqual(shadeEmission([200, 50, 10, 0], [1, 2, 3, 255], 255), [200, 50, 10, 0]);
  assert.deepEqual(shadeEmission([0, 0, 0, 1], [255, 255, 255, 99], 128), [127, 127, 127, 1]);
  assert.deepEqual(base, [100, 200, 50, 128]);
  assert.deepEqual(shaded, [20, 40, 10, 255]);
  for (const strength of [-1, 256, 0.5, NaN, Infinity])
    assert.throws(() => shadeEmission(base, shaded, strength));
  for (const color of [
    [1, 2, 3],
    [1, 2, 3, 4, 5],
    [1, 2, NaN, 255],
    [1, 2, 300, 255],
    [0.1, 2, 3, 4],
  ]) {
    assert.throws(() => shadeEmission(color, shaded, 128));
    assert.throws(() => shadeEmission(base, color, 128));
  }
});

test('compositing rejects color accessors and inherited data without executing them', () => {
  for (const target of ['base', 'shaded']) {
    for (const index of ['0', '3']) {
      const base = [100, 200, 50, 128],
        shaded = [20, 40, 10, 255];
      let reads = 0;
      Object.defineProperty(target === 'base' ? base : shaded, index, {
        enumerable: true,
        get() {
          return ++reads === 1 ? 0 : 999;
        },
      });
      assert.throws(() => shadeEmission(base, shaded, 128), /plain data/);
      assert.equal(reads, 0);
    }
    const base = [100, 200, 50, 128],
      shaded = [20, 40, 10, 255],
      values = target === 'base' ? base : shaded,
      inherited = Object.create(Array.prototype);
    let reads = 0;
    Object.defineProperty(inherited, '3', {
      get() {
        reads++;
        return 128;
      },
    });
    delete values[3];
    Object.setPrototypeOf(values, inherited);
    assert.throws(() => shadeEmission(base, shaded, 128), /plain data/);
    assert.equal(reads, 0);
  }
  assert.deepEqual(
    shadeEmission(Object.freeze([100, 200, 50, 128]), Object.freeze([20, 40, 10, 255]), 128),
    [60, 120, 30, 128],
  );
});

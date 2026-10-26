import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { zlibSync } from 'fflate';
import { assertModel, serialize, LIMITS, type Model } from './model.js';
import { crc32, encodePNG } from './png.js';

export interface EmissionMask {
  /** Exact existing BBIR texture ID, never a path or a fuzzy material selector. */
  texture: string;
  width: number;
  height: number;
  /** One row-major linear strength byte per albedo texel: 0 shaded, 255 fullbright. */
  pixels: number[];
}

export interface EmissionDocument {
  version: 1;
  /** SHA-256 of serialize(model), including geometry, albedo and animation. */
  modelDigest: string;
  masks: EmissionMask[];
}

export interface EmissionExportOptions {
  target?: 'grayscale' | 'geckolib4';
  /** Exact texture ID -> safe base PNG filename. Required for GeckoLib4. No paths. */
  textureNames?: Record<string, string>;
}

export interface EmissionMaskAsset {
  texture: string;
  filename: string;
  width: number;
  height: number;
  png: Uint8Array;
}

const digest = (model: Model) => bytesToHex(sha256(new TextEncoder().encode(serialize(model))));

function object(
  value: unknown,
  allowed: string[],
  required: string[],
  path: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${path}: expected plain data object`);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key))
      throw new Error(`${path}: unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new Error(`${path}: expected plain data values`);
    snapshot[key] = descriptor.value;
  }
  for (const key of required)
    if (!Object.hasOwn(snapshot, key)) throw new Error(`${path}.${key}: required`);
  return snapshot;
}

/** Snapshot own data elements without invoking accessors or caller-provided array methods. */
function array(value: unknown, min: number, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new Error(`${path}: expected plain data array`);
  const length = Object.getOwnPropertyDescriptor(value, 'length')!.value as number;
  if (length < min || length > max)
    throw new Error(`${path}: expected ${min}..${max} array elements`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
      throw new Error(`${path}: unknown array field ${String(key)}`);
  }
  const snapshot: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value'))
      throw new Error(`${path}[${i}]: expected own plain data value`);
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

const byte = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;

/** Strict sidecar parser bound to the exact canonical model, without mutating either input. */
export function validateEmissionDocument(model: Model, value: unknown): EmissionDocument {
  assertModel(model);
  const document = object(
    value,
    ['version', 'modelDigest', 'masks'],
    ['version', 'modelDigest', 'masks'],
    'emission',
  );
  if (document.version !== 1) throw new Error('emission.version: expected 1');
  if (typeof document.modelDigest !== 'string' || !/^[a-f0-9]{64}$/.test(document.modelDigest))
    throw new Error('emission.modelDigest: expected SHA-256 hex');
  if (document.modelDigest !== digest(model))
    throw new Error('Stale emission document: model digest does not match');
  const textures = new Map((model.textures ?? []).map((texture) => [texture.id, texture]));
  const inputMasks = array(document.masks, 1, textures.size, 'emission.masks');
  const seen = new Set<string>();
  const masks: EmissionMask[] = [];
  let texels = 0;
  for (const [index, value] of inputMasks.entries()) {
    const path = `emission.masks[${index}]`;
    const mask = object(
      value,
      ['texture', 'width', 'height', 'pixels'],
      ['texture', 'width', 'height', 'pixels'],
      path,
    );
    if (typeof mask.texture !== 'string' || !textures.has(mask.texture))
      throw new Error(`${path}.texture: unknown texture ID`);
    if (seen.has(mask.texture)) throw new Error(`${path}.texture: duplicate mask`);
    seen.add(mask.texture);
    const texture = textures.get(mask.texture)!;
    if (mask.width !== texture.width || mask.height !== texture.height)
      throw new Error(`${path}: dimensions must exactly match target texture`);
    const count = texture.width * texture.height;
    texels += count;
    if (texels > LIMITS.pixels) throw new Error('Emission texel budget exceeded');
    const inputPixels = array(mask.pixels, count, count, `${path}.pixels`);
    const pixels: number[] = [];
    for (let i = 0; i < count; i++) {
      const pixel = inputPixels[i];
      if (!byte(pixel)) throw new Error(`${path}.pixels[${i}]: expected byte 0..255`);
      pixels.push(pixel);
    }
    masks.push({ texture: mask.texture, width: texture.width, height: texture.height, pixels });
  }
  masks.sort((a, b) => (a.texture < b.texture ? -1 : a.texture > b.texture ? 1 : 0));
  return { version: 1, modelDigest: document.modelDigest, masks };
}

/** Create a freshly bound sidecar after the caller has chosen explicit per-texture masks. */
export function createEmissionDocument(
  model: Model,
  masks: readonly EmissionMask[],
): EmissionDocument {
  return validateEmissionDocument(model, { version: 1, modelDigest: digest(model), masks });
}

/** Blend shaded RGB toward fullbright albedo RGB; preserve albedo alpha exactly. No light or bloom. */
export function shadeEmission(
  baseRGBA: readonly number[],
  shadedRGBA: readonly number[],
  strength: number,
): [number, number, number, number] {
  const base = array(baseRGBA, 4, 4, 'Emission base RGBA'),
    shaded = array(shadedRGBA, 4, 4, 'Emission shaded RGBA');
  if (!base.every(byte) || !shaded.every(byte) || !byte(strength))
    throw new Error('Emission compositing requires RGBA8 colors and a strength byte');
  return [
    ...[0, 1, 2].map((i) => Math.round(shaded[i]! + ((base[i]! - shaded[i]!) * strength) / 255)),
    base[3]!,
  ] as [number, number, number, number];
}

/** PNG grayscale8, one channel per texel. Geometry, UVs and albedo pixels remain untouched. */
function encodeMask(mask: EmissionMask): Uint8Array {
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, mask.width);
  view.setUint32(4, mask.height);
  header[8] = 8;
  const scanlines = new Uint8Array((mask.width + 1) * mask.height);
  for (let y = 0; y < mask.height; y++)
    scanlines.set(
      mask.pixels.slice(y * mask.width, (y + 1) * mask.width),
      y * (mask.width + 1) + 1,
    );
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const [type, data] of [
    ['IHDR', header],
    ['IDAT', zlibSync(scanlines, { level: 6 })],
    ['IEND', new Uint8Array()],
  ] as const) {
    const chunk = new Uint8Array(data.length + 12),
      view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(new TextEncoder().encode(type), 4);
    chunk.set(data, 8);
    view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
    chunks.push(chunk);
  }
  const png = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

function safeName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 96 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*\.png$/.test(value) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\.png$/i.test(value)
  )
    throw new Error('Emission texture names must be safe base PNG filenames without paths');
  return value.slice(0, -4);
}

/** Deterministic PNG assets. GeckoLib4 target names must explicitly match its base textures. */
export function exportEmissionMasks(
  model: Model,
  value: unknown,
  options: EmissionExportOptions = {},
): EmissionMaskAsset[] {
  const document = validateEmissionDocument(model, value);
  const settings = object(options, ['target', 'textureNames'], [], 'emission export');
  const target = Object.hasOwn(settings, 'target') ? settings.target : 'grayscale';
  if (!['grayscale', 'geckolib4'].includes(target as string))
    throw new Error('Emission export target must be grayscale or geckolib4');
  const names =
    settings.textureNames === undefined
      ? {}
      : object(
          settings.textureNames,
          document.masks.map((mask) => mask.texture),
          [],
          'emission textureNames',
        );
  if (target === 'geckolib4' && document.masks.some((mask) => !Object.hasOwn(names, mask.texture)))
    throw new Error(
      'GeckoLib4 emission export requires an explicit base PNG name for each texture',
    );
  const textures = new Map((model.textures ?? []).map((texture) => [texture.id, texture]));
  const usedNames = new Set<string>();
  return document.masks.map((mask) => {
    const stem = Object.hasOwn(names, mask.texture)
      ? safeName(names[mask.texture])
      : `${
          mask.texture
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .slice(0, 40) || 'texture'
        }-${bytesToHex(sha256(new TextEncoder().encode(mask.texture))).slice(0, 12)}`;
    const filename = `${stem}_${target === 'geckolib4' ? 'glowmask' : 'emission'}.png`;
    const key = filename.toLowerCase();
    if (usedNames.has(key)) throw new Error(`Emission export filename collision: ${filename}`);
    usedNames.add(key);
    let png: Uint8Array;
    if (target === 'geckolib4') {
      const pixels = Uint8Array.from(textures.get(mask.texture)!.pixels);
      for (let i = 0; i < mask.pixels.length; i++)
        pixels[i * 4 + 3] = Math.round((pixels[i * 4 + 3]! * mask.pixels[i]!) / 255);
      png = encodePNG({ width: mask.width, height: mask.height, pixels });
    } else png = encodeMask(mask);
    return { texture: mask.texture, filename, width: mask.width, height: mask.height, png };
  });
}

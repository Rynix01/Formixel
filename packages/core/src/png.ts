import { zlibSync, unzlibSync } from 'fflate';
import { LIMITS } from './model.js';
export interface ImageRGBA {
  width: number;
  height: number;
  pixels: Uint8Array;
}
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(name, 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}
export function encodePNG(image: ImageRGBA): Uint8Array {
  const { width, height, pixels } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 2048 ||
    height > 2048 ||
    pixels.length !== width * height * 4
  )
    throw new Error('Invalid PNG dimensions or RGBA data');
  const ihdr = new Uint8Array(13),
    view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ]);
}
export function decodePNG(bytes: Uint8Array): ImageRGBA {
  if (bytes.length > LIMITS.bytes || !signature.every((n, i) => bytes[i] === n))
    throw new Error('Expected bounded PNG data');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false;
  const idat: Uint8Array[] = [];
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    if (length > LIMITS.bytes || at + 12 + length > bytes.length)
      throw new Error('Invalid PNG chunk length');
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8)),
      data = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== view.getUint32(at + 8 + length))
      throw new Error('PNG CRC mismatch');
    if (type === 'IHDR') {
      if (at !== 8 || length !== 13 || width) throw new Error('Invalid PNG header');
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (
        width < 1 ||
        height < 1 ||
        width > 1024 ||
        height > 1024 ||
        width * height > LIMITS.pixels ||
        data[8] !== 8 ||
        ![2, 6].includes(data[9]!) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw new Error('PNG requires bounded, noninterlaced RGB/RGBA8');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      if (!width) throw new Error('PNG data before header');
      idat.push(data);
    } else if (type === 'IEND') {
      if (length) throw new Error('Invalid PNG end');
      ended = true;
      at += 12;
      break;
    } else if (['acTL', 'fcTL', 'fdAT', 'tRNS'].includes(type))
      throw new Error('Animated PNG and RGB transparency keys are unsupported');
    else if (type[0] === type[0]?.toUpperCase())
      throw new Error(`Unsupported PNG critical chunk ${type}`);
    at += length + 12;
  }
  if (!ended || at !== bytes.length || !width || !idat.length) throw new Error('Incomplete PNG');
  const stride = width * channels,
    expected = (stride + 1) * height;
  const raw = unzlibSync(concat(idat), { out: new Uint8Array(expected + 1) });
  if (raw.length !== expected) throw new Error('PNG decompressed size mismatch');
  const decoded = new Uint8Array(stride * height),
    pixels = new Uint8Array(width * height * 4);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw new Error('Unsupported PNG filter');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? decoded[y * stride + x - channels]! : 0,
        b = y ? decoded[(y - 1) * stride + x]! : 0,
        c = y && x >= channels ? decoded[(y - 1) * stride + x - channels]! : 0;
      decoded[y * stride + x] =
        (raw[y * (stride + 1) + x + 1]! +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]!) &
        255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = decoded[i * channels]!;
    pixels[i * 4 + 1] = decoded[i * channels + 1]!;
    pixels[i * 4 + 2] = decoded[i * channels + 2]!;
    pixels[i * 4 + 3] = channels === 4 ? decoded[i * channels + 3]! : 255;
  }
  return { width, height, pixels };
}
export function pngDataURL(bytes: Uint8Array): string {
  let binary = '';
  for (const n of bytes) binary += String.fromCharCode(n);
  return 'data:image/png;base64,' + btoa(binary);
}
export function pngFromDataURL(url: string): ImageRGBA {
  if (!url.startsWith('data:image/png;base64,') || url.length > LIMITS.bytes * 1.4)
    throw new Error('Only bounded embedded PNG textures are supported');
  const binary = atob(url.slice(22));
  return decodePNG(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

import { rgba } from './materials.js';
import { type Texture } from './model.js';
export const SKIN_KINDS = ['bark', 'stone', 'metal', 'cloth', 'leaf', 'rune'] as const;
export type SkinKind = (typeof SKIN_KINDS)[number];
/** Fixed bounded pixel recipes, with no external images or executable expressions. */
export function skinTexture(
  id: string,
  kind: SkinKind,
  base: string,
  accent: string,
  seed = 0,
): Texture {
  if (!SKIN_KINDS.includes(kind)) throw new Error('Unknown skin recipe');
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error('Skin seed must be uint32');
  const a = rgba(base),
    b = rgba(accent),
    pixels: number[] = [];
  const noise = (x: number, y: number) => {
    let n = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n >>> 0) / 4294967296;
  };
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      let mix = 0,
        shade = 0.94 + noise(x, y) * 0.09;
      if (kind === 'bark') {
        const groove = (x + Math.floor(Math.sin(y * 0.18 + (seed % 9)) * 1.5) + 32) % 11;
        if (groove === 0) shade = 0.62;
        if (groove === 1) mix = 0.18;
      } else if (kind === 'stone') {
        if ((x + Math.floor(y / 13) * 5 + (seed % 17)) % 23 === 0 && y % 13 < 9) shade = 0.72;
        if (noise(x >> 2, y >> 2) > 0.91) mix = 0.13;
      } else if (kind === 'metal') {
        shade = 0.88 + (31 - y) / 190 + (31 - x) / 600 + noise(x, y) * 0.01;
        if (x === 1 || y === 1) mix = 0.45;
        if ((x === 4 || x === 27) && (y === 4 || y === 27)) shade = 0.6;
      } else if (kind === 'cloth') {
        shade = 0.74 + Math.abs(((x + (seed % 4)) % 16) - 8) / 32 + (31 - y) / 800;
        if (x === 2 || x === 29) mix = 0.24;
      } else if (kind === 'leaf') {
        if (x === 15 || x === 16 || (Math.abs(x - 16) + y) % 12 === 0) mix = 0.38;
        shade += (31 - y) / 400;
      } else {
        const diamond = Math.abs(x - 15.5) + Math.abs(y - 15.5);
        if (Math.abs(diamond - 10) < 1.3 || (x >= 15 && x <= 16 && y > 8 && y < 24)) mix = 1;
        else shade = 0.86;
      }
      pixels.push(
        ...a
          .slice(0, 3)
          .map((v, i) =>
            Math.round(Math.max(0, Math.min(255, (v * (1 - mix) + b[i]! * mix) * shade))),
          ),
        a[3]!,
      );
    }
  return { id, name: `${id}.png`, width: 32, height: 32, pixels };
}

import { encodePNG, type ImageRGBA } from './png.js';
import type { Texture } from './model.js';

export interface AtlasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  uv: [number, number, number, number];
}
/** Bounded rectangle packing with one-pixel edge extrusion. Paint aspect-correct regions locally. */
export class PixelAtlas {
  readonly regions = new Map<string, AtlasRegion>();
  private pixels: Uint8Array;
  private free: { x: number; y: number; width: number; height: number }[];
  constructor(
    readonly width = 512,
    readonly height = 512,
  ) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 4 ||
      height < 4 ||
      width > 1024 ||
      height > 1024 ||
      width * height > 262144
    )
      throw new Error('Atlas must fit the texture pixel budget');
    this.pixels = new Uint8Array(width * height * 4);
    this.free = [{ x: 0, y: 0, width, height }];
  }
  allocate(
    id: string,
    width: number,
    height: number,
    paint: (x: number, y: number, w: number, h: number) => readonly number[],
  ): AtlasRegion {
    if (this.regions.has(id)) throw new Error('Duplicate atlas region');
    if (this.regions.size >= 10000) throw new Error('Atlas region count exceeded');
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > this.width - 2 ||
      height > this.height - 2
    )
      throw new Error('Invalid atlas region dimensions');
    const pw = width + 2,
      ph = height + 2;
    const fit = this.free
      .filter((f) => f.width >= pw && f.height >= ph)
      .sort(
        (a, b) =>
          Math.min(a.width - pw, a.height - ph) - Math.min(b.width - pw, b.height - ph) ||
          a.width * a.height - b.width * b.height ||
          a.y - b.y ||
          a.x - b.x,
      )[0];
    if (!fit) throw new Error('Atlas packing budget exceeded');
    const used = { x: fit.x, y: fit.y, width: pw, height: ph };
    const r: AtlasRegion = {
      x: fit.x + 1,
      y: fit.y + 1,
      width,
      height,
      uv: [fit.x + 1, fit.y + 1, fit.x + width + 1, fit.y + height + 1],
    };
    const painted = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const c = paint(x, y, width, height);
        if (c.length !== 4 || c.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
          throw new Error('Paint callback must return RGBA8');
        painted.set(c, (y * width + x) * 4);
      }
    for (let y = 0; y < height; y++)
      this.pixels.set(
        painted.subarray(y * width * 4, (y + 1) * width * 4),
        ((r.y + y) * this.width + r.x) * 4,
      );
    // Extrude the edge texels into padding to prevent neighboring regions bleeding.
    for (let y = -1; y <= height; y++)
      for (let x = -1; x <= width; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) continue;
        const sx = r.x + Math.max(0, Math.min(width - 1, x)),
          sy = r.y + Math.max(0, Math.min(height - 1, y));
        this.pixels.set(
          this.pixels.slice((sy * this.width + sx) * 4, (sy * this.width + sx) * 4 + 4),
          ((r.y + y) * this.width + r.x + x) * 4,
        );
      }
    const next: typeof this.free = [];
    for (const f of this.free) {
      const right = f.x + f.width,
        bottom = f.y + f.height,
        ur = used.x + pw,
        ub = used.y + ph;
      if (used.x >= right || ur <= f.x || used.y >= bottom || ub <= f.y) {
        next.push(f);
        continue;
      }
      if (used.x > f.x) next.push({ ...f, width: used.x - f.x });
      if (ur < right) next.push({ ...f, x: ur, width: right - ur });
      if (used.y > f.y) next.push({ ...f, height: used.y - f.y });
      if (ub < bottom) next.push({ ...f, y: ub, height: bottom - ub });
    }
    this.free = next.filter(
      (a, i) =>
        !next.some(
          (b, j) =>
            i !== j &&
            b.x <= a.x &&
            b.y <= a.y &&
            b.x + b.width >= a.x + a.width &&
            b.y + b.height >= a.y + a.height &&
            (j < i || b.width * b.height > a.width * a.height),
        ),
    );
    this.regions.set(id, r);
    return r;
  }
  image(): ImageRGBA {
    return { width: this.width, height: this.height, pixels: this.pixels.slice() };
  }
  png(): Uint8Array {
    return encodePNG(this.image());
  }
  texture(id: string, name = id + '.png'): Texture {
    return { id, name, width: this.width, height: this.height, pixels: [...this.pixels] };
  }
}

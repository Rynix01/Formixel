import { assertModel, type Model } from './model.js';
import { decodePNG, encodePNG, type ImageRGBA } from './png.js';
import { renderPixels, type RenderView } from './render.js';

/** Normalize foreground occupancy for a clearly cropped, plain-background reference. */
function silhouette(image: ImageRGBA) {
  const { width, height, pixels } = image;
  const samples: number[][] = [[], [], []];
  for (let x = 0; x < width; x++)
    for (const y of [0, height - 1])
      for (let c = 0; c < 3; c++) samples[c]!.push(pixels[(y * width + x) * 4 + c]!);
  for (let y = 0; y < height; y++)
    for (const x of [0, width - 1])
      for (let c = 0; c < 3; c++) samples[c]!.push(pixels[(y * width + x) * 4 + c]!);
  const background = samples.map((s) => s.sort((a, b) => a - b)[Math.floor(s.length / 2)]!);
  const alphaBackground = pixels[3]! < 128;
  const mask = new Uint8Array(width * height);
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1,
    area = 0,
    border = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const foreground =
        pixels[i + 3]! >= 128 &&
        (alphaBackground || Math.hypot(...background.map((c, j) => pixels[i + j]! - c)) > 46);
      if (!foreground) continue;
      mask[y * width + x] = 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      area++;
      if (!x || !y || x === width - 1 || y === height - 1) border++;
    }
  if (!area) throw new Error('Reference has no distinguishable foreground');
  const size = 128,
    normalized = new Uint8Array(size * size);
  const w = maxX - minX + 1,
    h = maxY - minY + 1,
    scale = (size - 8) / Math.max(w, h);
  const ox = (size - w * scale) / 2,
    oy = (size - h * scale) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x - ox) / scale) + minX,
        sy = Math.floor((y - oy) / scale) + minY;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY)
        normalized[y * size + x] = mask[sy * width + sx]!;
    }
  return { normalized, aspect: w / h, foregroundPixels: area, clipped: border > 2 };
}

export function compareReference(model: Model, reference: Uint8Array, view: RenderView) {
  assertModel(model);
  if (!['front', 'back', 'left', 'right', 'top'].includes(view))
    throw new Error('Comparison requires an orthographic reference role');
  if (!(reference instanceof Uint8Array) || reference.length > 1_000_000)
    throw new Error('Reference exceeds 1 MB');
  const target = decodePNG(reference);
  const actual = renderPixels(model, { width: 256, height: 256, view, background: '#00000000' });
  const a = silhouette(target),
    b = silhouette(actual);
  let intersection = 0,
    union = 0;
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) {
    const expected = a.normalized[i]!,
      observed = b.normalized[i]!;
    if (expected && observed) intersection++;
    if (expected || observed) union++;
    pixels.set(
      expected && observed
        ? [58, 180, 124, 255]
        : expected
          ? [229, 90, 90, 255]
          : observed
            ? [74, 142, 240, 255]
            : [245, 245, 242, 255],
      i * 4,
    );
  }
  return {
    report: {
      view,
      silhouetteIoU: intersection / union,
      referenceAspect: a.aspect,
      modelAspect: b.aspect,
      possiblyClipped: a.clipped,
      scope:
        'Bounding-box-aligned foreground masks; green=overlap, red=reference, blue=model. Plain cropped backgrounds only. This is not an aesthetic score or a pose/camera registration guarantee.',
    },
    overlay: encodePNG({ width: 128, height: 128, pixels }),
    render: encodePNG(actual),
  };
}

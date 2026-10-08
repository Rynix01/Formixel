import gifenc from 'gifenc';
import { assertModel, type Model, type Vec3 } from './model.js';
import { geometry } from './geometry.js';
import { sampleAnimation } from './animation.js';
import { renderPixels, RENDER_VIEWS, type RenderOptions, type RenderView } from './render.js';

export function animationBounds(
  model: Model,
  id: string,
  times: number[],
): { min: Vec3; max: Vec3 } {
  assertModel(model);
  if (!times.length || times.length > 121 || times.some((t) => !Number.isFinite(t) || t < 0))
    throw new Error('Invalid animation framing samples');
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const time of times)
    for (const c of geometry(model, sampleAnimation(model, id, time)))
      for (const p of c.vertices)
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i]!, p[i]!);
          max[i] = Math.max(max[i]!, p[i]!);
        }
  if (!min.every(Number.isFinite)) throw new Error('Animation has no geometry');
  for (let i = 0; i < 3; i++)
    if (max[i]! - min[i]! < 1e-6) {
      min[i] = min[i]! - 0.5;
      max[i] = max[i]! + 0.5;
    }
  return { min, max };
}

/** A local animation preview with a fixed envelope, no subprocess/provider and bounded frames/pixels. */
export function animationFraming(
  model: Model,
  id: string,
  times: number[],
  view: RenderView = 'isometric',
) {
  assertModel(model);
  if (
    !times.length ||
    times.length > 121 ||
    times.some((t) => !Number.isFinite(t) || t < 0) ||
    !RENDER_VIEWS.includes(view)
  )
    throw new Error('Invalid animation framing samples/view');
  const min: [number, number] = [Infinity, Infinity],
    max: [number, number] = [-Infinity, -Infinity];
  for (const time of times)
    for (const c of geometry(model, sampleAnimation(model, id, time)))
      for (const p of c.vertices) {
        const xy =
          view === 'front'
            ? [p[0], -p[1]]
            : view === 'back'
              ? [-p[0], -p[1]]
              : view === 'left'
                ? [-p[2], -p[1]]
                : view === 'right'
                  ? [p[2], -p[1]]
                  : view === 'top'
                    ? [p[0], p[2]]
                    : [((p[0] + p[2]) * Math.sqrt(3)) / 2, (p[0] - p[2]) / 2 - p[1]];
        for (let i = 0; i < 2; i++) {
          min[i] = Math.min(min[i]!, xy[i]!);
          max[i] = Math.max(max[i]!, xy[i]!);
        }
      }
  if (!min.every(Number.isFinite)) throw new Error('Animation has no geometry');
  for (let i = 0; i < 2; i++)
    if (max[i]! - min[i]! < 1e-6) {
      min[i] = min[i]! - 0.5;
      max[i] = max[i]! + 0.5;
    }
  return { min, max };
}
export function renderGIF(
  model: Model,
  options: Omit<RenderOptions, 'time' | 'bounds' | 'onWork' | 'framing'> & {
    animation: string;
    fps?: number;
  },
): Uint8Array {
  assertModel(model);
  const animation = model.animations?.find(
    (a) => a.id === options.animation || a.name === options.animation,
  );
  if (!animation) throw new Error('GIF requires an existing animation');
  const width = options.width ?? 256,
    height = options.height ?? 256,
    fps = options.fps ?? 12;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 512 ||
    height > 512 ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 24
  )
    throw new Error('GIF requires size 16..512 and integer fps 1..24');
  const count = Math.ceil(animation.length * fps) + (animation.loop ? 0 : 1);
  if (count > 120 || count * width * height > 16_777_216)
    throw new Error('GIF frame/pixel budget exceeded');
  const times = Array.from({ length: count }, (_, i) => Math.min(animation.length, i / fps));
  const framing = animationFraming(model, animation.id, times, options.view),
    gif = gifenc.GIFEncoder();
  let work = 0;
  for (let i = 0; i < times.length; i++) {
    const image = renderPixels(model, {
      ...options,
      width,
      height,
      time: times[i]!,
      framing,
      onWork: (n) => {
        work += n;
        if (work > 100_000_000) throw new Error('GIF aggregate raster budget exceeded');
      },
    });
    const palette = gifenc.quantize(image.pixels, 256),
      indices = gifenc.applyPalette(image.pixels, palette);
    // Quantize absolute frame boundaries to GIF's 10ms clock: avoid cumulative timing drift.
    const delay = (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10;
    gif.writeFrame(indices, width, height, {
      palette,
      delay,
      repeat: animation.loop ? 0 : -1,
      dispose: 1,
    });
  }
  gif.finish();
  const bytes = gif.bytes();
  if (bytes.length > 16_000_000) throw new Error('GIF output budget exceeded');
  return bytes;
}

import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import {
  exportBBModel,
  serialize,
  renderPNG,
  renderGIF,
  type Model,
  type RenderView,
  exportBBModelWithContext,
  validateModelContext,
} from '@formixel/core';

/** A single installable output keeps failed multi-file workflows from leaving partial deliverables. */
export function workflowArtifact(
  model: Model,
  details: Record<string, unknown> = {},
  attachments: Record<string, Uint8Array> = {},
): Uint8Array {
  const encode = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
  const files: Record<string, Uint8Array> = {
    'model.bbmodel': encode(
      exportBBModelWithContext(
        model,
        details.context ? validateModelContext(model, details.context) : undefined,
      ),
    ),
    'model.bbir.json': new TextEncoder().encode(serialize(model)),
    'review.json': encode(details),
  };
  if (details.design) files['model.design.json'] = encode(details.design);
  if (details.context)
    files['model.context.json'] = encode(validateModelContext(model, details.context));
  for (const [name, bytes] of Object.entries(attachments)) {
    if (!/^reference-[0-7]-(overlay|model)\.png$/.test(name))
      throw new Error('Unknown review attachment');
    files[name] = bytes;
  }
  const views: RenderView[] = ['isometric', 'front', 'back', 'left', 'right', 'top'];
  let rasterWork = 0;
  const onWork = (n: number) => {
    rasterWork += n;
    if (rasterWork > 150_000_000) throw new Error('Artifact aggregate raster budget exceeded');
  };
  for (const view of views)
    files[view + '.png'] = renderPNG(model, { width: 256, height: 256, view, onWork });
  const clips: string[] = [],
    omitted: string[] = [];
  let frames = 0;
  for (const animation of model.animations ?? []) {
    const count = Math.ceil(animation.length * 6) + (animation.loop ? 0 : 1);
    if (clips.length >= 8 || animation.length > 15 || frames + count > 240) {
      omitted.push(animation.id);
      continue;
    }
    files[`motion-${clips.length}.gif`] = renderGIF(model, {
      width: 160,
      height: 160,
      animation: animation.id,
      fps: 6,
      onWork,
    });
    frames += count;
    clips.push(animation.id);
  }
  files['motion.json'] = encode({
    clips,
    omitted,
    reason:
      'At most eight full clips up to 15 seconds and 240 frames across the artifact; use render for other clips.',
  });
  files['preview.html'] = new TextEncoder().encode(
    `<!doctype html><meta charset="utf-8"><title>Formixel model review</title><style>body{font:16px system-ui;background:#101827;color:#e8edf5;max-width:1100px;margin:auto;padding:24px}section{display:flex;flex-wrap:wrap}figure{margin:12px}img{max-width:100%}a{color:#93c5fd}</style><h1>Formixel model review</h1><p><a href="model.bbmodel">Editable Blockbench model</a> · <a href="review.json">Checks and reported usage</a></p><section>${views.map((v) => `<figure><img src="${v}.png" width="256" height="256"><figcaption>${v}</figcaption></figure>`).join('')}</section><section>${clips.map((_, i) => `<figure><img src="motion-${i}.gif" width="256"><figcaption>Clip ${i + 1}; see motion.json</figcaption></figure>`).join('')}</section><p>Local geometry and texture previews. Review silhouette and full motion; technical checks do not certify artistic fidelity or game integration.</p>`,
  );
  const hashes = Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')]),
  );
  files['checksums.json'] = encode({ version: 1, algorithm: 'sha256', files: hashes });
  return zipSync(
    Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([name, data]) => [name, [data, { mtime: new Date('2020-01-01T00:00:00Z') }]]),
    ),
    { level: 6 },
  );
}

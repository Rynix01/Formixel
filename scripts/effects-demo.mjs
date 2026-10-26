import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { zipSync } from 'fflate';
import {
  authorDesign,
  serialize,
  createModelContext,
  exportBBModelWithContext,
  particleModelDigest,
  createEmissionDocument,
  renderPNG,
  renderGIF,
  exportParticleAssets,
  exportEmissionMasks,
} from '../packages/core/dist/index.js';
import { atomicWrite } from '../packages/cli/dist/io.js';

const destination = process.argv[2];
if (!destination || process.argv.length !== 3)
  throw new Error('Usage: node scripts/effects-demo.mjs OUTPUT.zip');
if (!destination.toLowerCase().endsWith('.zip')) throw new Error('Output must be a ZIP file');
const design = JSON.parse(
  await readFile(new URL('../examples/armored-sentinel.design.json', import.meta.url), 'utf8'),
);
const { model } = authorDesign(design);
const context = createModelContext(model, {
  brief: { anatomy: 'quadruped' },
  roles: design.authoring.roles,
  constraints: design.authoring.constraints,
});
const particles = {
  version: 1,
  modelDigest: particleModelDigest(model),
  recipes: [
    {
      id: 'ember',
      seed: 2026,
      shape: 'cone',
      direction: [0, 0, -1],
      spread: 16,
      speed: [3, 7],
      lifetime: [0.3, 0.65],
      acceleration: [0, 2, 0],
      drag: 1,
      size: [
        [0, 0.4],
        [0.25, 0.75],
        [1, 0],
      ],
      color: [
        [0, '#fff1aaff'],
        [0.35, '#ff9a26f0'],
        [1, '#c72c0800'],
      ],
      render: 'voxel',
      blend: 'additive',
    },
  ],
  events: [
    {
      id: 'breath',
      animation: 'alert',
      time: 0.3,
      recipe: 'ember',
      duration: 1,
      rate: 45,
      burst: 5,
      attachment: { group: 'body/head', point: [0, 5.9, -6.8] },
      space: 'world',
    },
  ],
};
const texture = model.textures[0],
  pixels = new Array(texture.width * texture.height).fill(0);
for (const cube of model.cubes.filter((cube) => cube.name.endsWith('_eye')))
  for (const face of Object.values(cube.faces ?? {})) {
    if (face.texture !== texture.id || face.enabled === false) continue;
    const [u0, v0, u1, v1] = face.uv;
    for (let y = Math.floor(Math.min(v0, v1)); y < Math.ceil(Math.max(v0, v1)); y++)
      for (let x = Math.floor(Math.min(u0, u1)); x < Math.ceil(Math.max(u0, u1)); x++)
        pixels[y * texture.width + x] = 255;
  }
const emission = createEmissionDocument(model, [
  { texture: texture.id, width: texture.width, height: texture.height, pixels },
]);
const burst = structuredClone(particles);
Object.assign(burst.recipes[0], {
  spread: 0,
  speed: [4, 4],
  lifetime: [0.5, 0.5],
  acceleration: [0, 0, 0],
  drag: 0,
  size: [
    [0, 0.35],
    [1, 0.35],
  ],
  color: [
    [0, '#ff9a26ff'],
    [1, '#ff9a26ff'],
  ],
  render: 'sprite',
});
Object.assign(burst.events[0], { duration: 0, rate: 0, burst: 8 });
const encode = (data) => new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
const assets = {
  'model.bbir.json': new TextEncoder().encode(serialize(model)),
  'model.bbmodel': encode(exportBBModelWithContext(model, context)),
  'model.context.json': encode(context),
  'particles.json': encode(particles),
  'emission.json': encode(emission),
  'bedrock-particles.json': encode(burst),
  'preview.png': renderPNG(model, {
    width: 512,
    height: 512,
    animation: 'alert',
    time: 0.8,
    particles,
    emission,
    background: '#e9e6e0ff',
  }),
  'preview.gif': renderGIF(model, {
    width: 256,
    height: 256,
    animation: 'alert',
    fps: 8,
    particles,
    emission,
    background: '#e9e6e0ff',
  }),
};
for (const asset of exportEmissionMasks(model, emission))
  assets['masks/' + asset.filename] = asset.png;
for (const [path, bytes] of Object.entries(
  exportParticleAssets(model, burst, {
    target: 'bedrock',
    namespace: 'formixel',
    entity: 'sentinel',
  }).assets,
))
  assets['bedrock/' + path] = bytes;
assets['README.txt'] = new TextEncoder().encode(
  'Formixel Copperback effects demonstration\n\nOpen model.bbmodel in Blockbench for editable geometry, atlas and bone animation. Generic .bbmodel does not embed these standalone particle/emission sidecars. Use model.bbir.json with particles.json/emission.json for exact digest matches. Preview uses independent seeded screen-facing particle quads and fullbright eye masks. Rich flame simulation is local; bedrock/ contains explicitly limited burst integration fragments requiring manual entity integration. No game runtime compatibility is certified.\n',
);
await mkdir(resolve(destination, '..'), { recursive: true });
const archive = zipSync(
  Object.fromEntries(
    Object.entries(assets).map(([path, bytes]) => [
      path,
      [bytes, { mtime: new Date('2000-01-01T00:00:00Z') }],
    ]),
  ),
  { level: 6 },
);
await atomicWrite(resolve(destination), archive);
console.log(
  JSON.stringify({
    output: resolve(destination),
    bytes: archive.length,
    cubes: model.cubes.length,
    emittingTexels: pixels.filter(Boolean).length,
  }),
);

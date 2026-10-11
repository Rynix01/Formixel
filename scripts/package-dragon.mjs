import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import { importBBModel, validate } from '../packages/core/dist/index.js';

const out = resolve(process.argv[2] ?? 'dist/showcase/dragon');
const views = ['front', 'back', 'left', 'right', 'top', 'isometric'];
const clips = ['idle', 'walk', 'bite_lunge', 'tail_whip', 'fire_breath', 'wing_slam'];
const title = (s) => s.replaceAll('_', ' ').toUpperCase();
const files = {};
const names = [
  'obsidian_crimson_dragon.bbmodel',
  'obsidian_crimson_dragon.bbir.json',
  'obsidian_crimson_dragon_atlas.png',
  'atlas-layout.json',
  'rig.json',
  'validation.json',
  ...views.map((v) => `dragon_${v}.png`),
  ...clips.map((c) => c + '.gif'),
  ...clips.slice(2).map((c) => c + '_storyboard.png'),
];
for (const name of names) files[name] = new Uint8Array(await readFile(resolve(out, name)));
assert.deepEqual(
  validate(
    importBBModel(JSON.parse(new TextDecoder().decode(files['obsidian_crimson_dragon.bbmodel']))),
  ),
  [],
);
files['LICENSE'] = new Uint8Array(await readFile(new URL('../LICENSE', import.meta.url)));
const readme = `# Formixel Dragon Pack\n\nOpen obsidian_crimson_dragon.bbmodel in Blockbench as a Generic Model. The 512x512 atlas is embedded; its separate PNG is also included. Open preview.html in a browser for views and animations.\n\nSix clips: idle, walk, bite_lunge, tail_whip, fire_breath and wing_slam. Four attack contact sheets show the same animated geometry.\n\nThis is a cuboid model with numeric bone animations, bright painted eyes and geometric fire/smoke previews. It does not include a Minecraft game pack, game particles or emissive shaders. Local native roundtrip and technical validation are recorded in validation.json. A live Blockbench save/reopen check is separate.\n\nReproduce with Formixel 1.4.0 source: npm run build; node scripts/generate-dragon.mjs OUTPUT_DIRECTORY; node scripts/package-dragon.mjs OUTPUT_DIRECTORY.\n\nRepository: https://github.com/Rynix01/Formixel\nLicense: MIT. checksums.json lists SHA-256 hashes of pack contents.\n`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Formixel · Obsidian Crimson Dragon</title><style>body{margin:0;background:#edeae6;color:#25262b;font:16px system-ui}main{max-width:1280px;margin:auto;padding:40px 24px}h1{font-size:36px;margin:0}p{line-height:1.6;max-width:850px}h2{margin-top:48px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}figure{margin:0;border:1px solid #d0cbc3;padding:12px;background:#f6f3ee}img{display:block;width:100%;image-rendering:pixelated}figcaption{padding:12px 4px;font-size:12px;letter-spacing:2px}.strip{margin-bottom:18px}a{color:inherit}</style><main><h1>Obsidian Crimson Dragon</h1><p>FORMIXEL DRAGON PACK · Editable quadrupedal model, mapped pixel atlas and six numeric animations.</p><p><a href="obsidian_crimson_dragon.bbmodel" download>Download .bbmodel</a> · <a href="obsidian_crimson_dragon_atlas.png">Texture atlas</a> · <a href="README.md">Asset notes</a></p><h2>Model views</h2><section>${views.map((v) => `<figure><img src="dragon_${v}.png" alt="${title(v)}"><figcaption>${title(v)} VIEW</figcaption></figure>`).join('')}</section><h2>Motion previews</h2><section>${clips.map((c) => `<figure><img src="${c}.gif" alt="${title(c)}"><figcaption>${title(c)}</figcaption></figure>`).join('')}</section><h2>Attack contact sheets</h2>${clips
  .slice(2)
  .map(
    (c) =>
      `<figure class="strip"><figcaption>${title(c)} · ANTICIPATION / CHARGE / STRIKE / RECOVERY</figcaption><img src="${c}_storyboard.png" alt="${title(c)} contact sheet"></figure>`,
  )
  .join(
    '',
  )}<p>Fire and smoke are geometric preview effects. Local rendering and codec roundtrips do not establish game integration or live editor save/reopen compatibility.</p></main></html>`;
files['README.md'] = new TextEncoder().encode(readme);
files['preview.html'] = new TextEncoder().encode(html);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checksums = {
  name: 'Formixel Dragon Pack',
  algorithm: 'sha256',
  files: Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([name, bytes]) => [name, hash(bytes)]),
  ),
};
files['checksums.json'] = new TextEncoder().encode(JSON.stringify(checksums, null, 2) + '\n');
for (const name of ['README.md', 'preview.html', 'LICENSE', 'checksums.json'])
  await writeFile(resolve(out, name), files[name]);
const archive = zipSync(
  Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([name, bytes]) => [name, [bytes, { mtime: new Date('2020-01-01T00:00:00Z') }]]),
  ),
  { level: 9 },
);
const extracted = unzipSync(archive);
for (const [name, digest] of Object.entries(checksums.files))
  assert.equal(hash(extracted[name]), digest);
const destination = resolve(out, 'formixel-dragon-pack.zip');
await writeFile(destination, archive);
await writeFile(destination + '.sha256', hash(archive) + '  formixel-dragon-pack.zip\n');
console.log(
  JSON.stringify({
    path: destination,
    files: Object.keys(files).length,
    bytes: archive.length,
    sha256: hash(archive),
  }),
);

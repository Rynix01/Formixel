import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const destination = resolve('dist/release');
await mkdir(destination, { recursive: true });
const files = {};
const add = (name, bytes) => {
  files[name] = bytes;
};
for (const [name, entry] of [
  ['formixel', 'cli'],
  ['formixel-mcp', 'mcp'],
]) {
  const output = await build({
    entryPoints: [`packages/${entry}/src/index.ts`],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    legalComments: 'inline',
  });
  add(`${name}.mjs`, output.outputFiles[0].contents);
}
add('formixel.js', new Uint8Array(await readFile('packages/blockbench/dist/formixel.js')));
for (const dir of ['docs', 'schemas', 'examples']) {
  for (const name of (await readdir(dir)).sort())
    add(`${dir}/${name}`, new Uint8Array(await readFile(join(dir, name))));
}
for (const name of ['README.md', 'LICENSE', 'CHANGELOG.md'])
  add(name, new Uint8Array(await readFile(name)));
for (const dependency of ['@noble/hashes', 'fflate', 'gifenc']) {
  const name = dependency === 'gifenc' ? 'LICENSE.md' : 'LICENSE';
  add(
    'licenses/' + dependency.replace('/', '-') + '.txt',
    new Uint8Array(await readFile('node_modules/' + dependency + '/' + name)),
  );
}
const manifest = Object.fromEntries(
  Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]),
);
add(
  'checksums.json',
  new TextEncoder().encode(
    JSON.stringify({ version, algorithm: 'sha256', files: manifest }, null, 2) + '\n',
  ),
);
const archive = zipSync(
  Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([path, bytes]) => [path, [bytes, { mtime: new Date('2020-01-01T00:00:00Z') }]]),
  ),
  { level: 9 },
);
const path = join(destination, `formixel-${version}.zip`);
await writeFile(path, archive);
await writeFile(
  path + '.sha256',
  createHash('sha256').update(archive).digest('hex') + '  ' + `formixel-${version}.zip\n`,
);
console.log(path);

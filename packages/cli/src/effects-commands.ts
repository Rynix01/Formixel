import { extname, resolve } from 'node:path';
import { zipSync } from 'fflate';
import {
  parseParticleDocument,
  exportParticleAssets,
  exportEmissionMasks,
  validateEmissionDocument,
  sampleParticles,
} from '@formixel/core';
import { readBounded, loadText, atomicWrite } from './io.js';

/** Local, explicit target exports. No inference, scripts, engine launch or implicit conversion. */
export async function effectsCommand(argv: string[]): Promise<void> {
  const args = [...argv];
  args.shift();
  const input = args.shift();
  if (!input || input.startsWith('-'))
    throw new Error(
      'Usage: formixel effects MODEL --particles FILE|--emission FILE [--target bedrock|geckolib4 -o assets.zip]',
    );
  const options = new Map<string, string>();
  let force = false;
  while (args.length) {
    const raw = args.shift()!;
    if (raw === '--force' && !force) {
      force = true;
      continue;
    }
    const flag = raw === '-o' ? '--output' : raw;
    if (
      ![
        '--particles',
        '--emission',
        '--target',
        '--namespace',
        '--entity',
        '--texture-names',
        '--output',
        '--animation',
        '--time',
      ].includes(flag) ||
      !args.length ||
      options.has(flag)
    )
      throw new Error('Invalid or duplicate effects option: ' + raw);
    options.set(flag, args.shift()!);
  }
  if (Number(options.has('--particles')) + Number(options.has('--emission')) !== 1)
    throw new Error('Choose exactly one --particles or --emission document');
  const model = loadText(await readBounded(input), extname(input).toLowerCase());
  const document = JSON.parse(
    await readBounded(options.get('--particles') ?? options.get('--emission')!),
  );
  const output = options.get('--output');
  const target = options.get('--target');
  let result: string | Uint8Array;
  if (options.has('--target')) {
    if (!target) throw new Error('Effects target must not be empty');
    if (!output?.toLowerCase().endsWith('.zip'))
      throw new Error('Target effects export requires a .zip output');
    if (options.has('--animation') || options.has('--time'))
      throw new Error('Sampling options cannot be combined with target export');
    let assets: Record<string, Uint8Array>;
    if (options.has('--particles')) {
      if (
        target !== 'bedrock' ||
        !options.has('--namespace') ||
        !options.has('--entity') ||
        options.has('--texture-names')
      )
        throw new Error('Particle export requires --target bedrock --namespace NAME --entity NAME');
      assets = exportParticleAssets(model, document, {
        target: 'bedrock',
        namespace: options.get('--namespace')!,
        entity: options.get('--entity')!,
      }).assets;
    } else {
      if (
        !['grayscale', 'geckolib4'].includes(target) ||
        options.has('--namespace') ||
        options.has('--entity')
      )
        throw new Error('Emission target must be grayscale or geckolib4');
      const names = options.has('--texture-names')
        ? JSON.parse(await readBounded(options.get('--texture-names')!))
        : undefined;
      const masks = exportEmissionMasks(model, document, {
        target: target as 'grayscale' | 'geckolib4',
        ...(names === undefined ? {} : { textureNames: names }),
      });
      assets = Object.fromEntries(masks.map((mask) => [mask.filename, mask.png]));
      assets['emission-manifest.json'] = new TextEncoder().encode(
        JSON.stringify(
          {
            version: 1,
            target,
            modelDigest: validateEmissionDocument(model, document).modelDigest,
            runtimeVerified: false,
            assets: masks.map(({ png, ...mask }) => mask),
          },
          null,
          2,
        ),
      );
    }
    result = zipSync(
      Object.fromEntries(
        Object.entries(assets).map(([name, bytes]) => [
          name,
          [bytes, { mtime: new Date('2000-01-01T00:00:00Z') }],
        ]),
      ),
      { level: 6 },
    );
  } else {
    if (['--namespace', '--entity', '--texture-names'].some((flag) => options.has(flag)))
      throw new Error('Target-specific options require --target');
    if (output && !output.toLowerCase().endsWith('.json'))
      throw new Error('Effects report output must be .json');
    if (options.has('--emission')) {
      if (options.has('--animation') || options.has('--time'))
        throw new Error('Emission reports have no particle timeline');
      const emission = validateEmissionDocument(model, document);
      result =
        JSON.stringify(
          {
            valid: true,
            modelDigest: emission.modelDigest,
            masks: emission.masks.map(({ pixels, ...mask }) => ({
              ...mask,
              emittingTexels: pixels.filter((v) => v > 0).length,
            })),
          },
          null,
          2,
        ) + '\n';
    } else {
      const particles = parseParticleDocument(model, document);
      if (options.has('--time') && !options.has('--animation'))
        throw new Error('--time requires --animation');
      result =
        JSON.stringify(
          {
            valid: true,
            modelDigest: particles.modelDigest,
            recipes: particles.recipes.length,
            events: particles.events.length,
            ...(options.has('--animation')
              ? {
                  particles: sampleParticles(
                    model,
                    particles,
                    options.get('--animation')!,
                    Number(options.get('--time') ?? 0),
                  ),
                }
              : {}),
          },
          null,
          2,
        ) + '\n';
    }
  }
  if (Buffer.byteLength(result) > 32_000_000) throw new Error('Effects output exceeds 32 MB');
  if (output) {
    await atomicWrite(resolve(output), result, force);
    console.log(
      JSON.stringify({
        output: resolve(output),
        bytes: Buffer.byteLength(result),
        ...(target ? { target } : {}),
      }),
    );
  } else process.stdout.write(result);
}

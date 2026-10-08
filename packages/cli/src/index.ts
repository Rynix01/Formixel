#!/usr/bin/env node
import { readFile, writeFile, rename, link, unlink, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  parseFXL,
  assertModel,
  validate,
  serialize,
  exportBBModel,
  importBBModel,
  applyPatch,
  inspect,
  renderSVG,
  LIMITS,
  canonical,
  renderPNG,
  encodePNG,
  analyzeQuality,
  type RenderView,
  type Model,
} from '@formixel/core';
import {
  createProvider,
  diagnoseProvider,
  validateGenerationRequest,
  PLANNER_INSTRUCTIONS,
  REFERENCE_INSTRUCTIONS,
  normalizeReferencePNG,
  type GenerationRequest,
  type TokenUsage,
  type ProviderName,
} from '@formixel/providers';
export async function readBounded(path: string): Promise<string> {
  const s = await stat(path);
  if (!s.isFile() || s.size > 16_000_000) throw new Error('Input must be a file up to 16 MB');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > 16_000_000) throw new Error('Input budget exceeded');
  return text;
}
export function loadText(text: string, extension: string): Model {
  if (extension === '.fxl' || extension === '.bbscript') return parseFXL(text);
  const data: unknown = JSON.parse(text);
  if (extension === '.bbmodel') return importBBModel(data);
  assertModel(data);
  return canonical(data);
}
export async function atomicWrite(
  path: string,
  text: string | Uint8Array,
  overwrite = false,
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { flag: 'wx' });
    if (overwrite) await rename(temp, path);
    else await link(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
const help = `Formixel 1.2 — deterministic model compiler
Usage: formixel <command> <input> [options]
  build model.fxl -o model.bbmodel
  import model.bbmodel -o model.bbir.json
  export model.bbir.json -o model.bbmodel
  inspect model.fxl
  quality model.bbmodel
  validate model.fxl
  patch model.fxl --patch changes.json -o model.bbir.json
  render model.fxl -o preview.png [--size 512] [--view front] [--animation idle --time 0.5]
  render model.fxl --texture moss -o texture.png
  doctor [codex|claude-code|openai|anthropic]
  generate "description" --provider codex -o model.fxl [--model NAME] [--cache DIR] [--reference reference.png]
  run formixel.task.json -o model.fxl [--reference reference.png]
Options: --force to overwrite an existing output; --timeout MS for generation.
Providers: codex (default), claude-code, openai, anthropic.
All generated FXL is validated locally before writing. API providers require an explicit model.
`;
export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (!argv.length || argv[0] === '--help') {
    console.log(help);
    return;
  }
  if (argv[0] === '--version') {
    console.log('1.2.0');
    return;
  }
  const command = argv.shift()!;
  if (command === 'doctor') {
    if (argv.length > 1)
      throw new Error('Usage: formixel doctor [codex|claude-code|openai|anthropic]');
    const names = argv.length ? [argv[0]!] : ['codex', 'claude-code', 'openai', 'anthropic'];
    const checks = [];
    for (const name of names) checks.push(await diagnoseProvider(name as ProviderName));
    console.log(JSON.stringify({ node: process.version, providers: checks }, null, 2));
    return;
  }
  const input = argv.shift();
  if (!input || input.startsWith('-')) throw new Error('Missing input');
  if (
    ![
      'build',
      'import',
      'export',
      'inspect',
      'quality',
      'validate',
      'patch',
      'render',
      'generate',
      'run',
    ].includes(command)
  )
    throw new Error(`Unknown command ${command}`);
  const options = new Map<string, string>();
  let force = false;
  while (argv.length) {
    const flag = argv.shift()!;
    if (flag === '--force') {
      force = true;
      continue;
    }
    if (
      ![
        '-o',
        '--output',
        '--patch',
        '--provider',
        '--model',
        '--timeout',
        '--size',
        '--animation',
        '--time',
        '--texture',
        '--view',
        '--cache',
        '--reference',
      ].includes(flag) ||
      !argv.length
    )
      throw new Error(`Invalid option ${flag}`);
    const key = flag === '-o' ? '--output' : flag;
    if (options.has(key)) throw new Error(`Duplicate ${key}`);
    options.set(key, argv.shift()!);
  }
  const allowed = new Set([
    '--output',
    ...(command === 'patch' ? ['--patch'] : []),
    ...(command === 'generate'
      ? ['--provider', '--model', '--timeout', '--cache', '--reference']
      : []),
    ...(command === 'run' ? ['--cache', '--reference'] : []),
    ...(command === 'render' ? ['--size', '--animation', '--time', '--texture', '--view'] : []),
  ]);
  for (const key of options.keys())
    if (!allowed.has(key)) throw new Error(`Option ${key} is not valid for ${command}`);
  const output = options.get('--output');
  if (!['inspect', 'validate', 'quality'].includes(command) && !output)
    throw new Error('Specify output with -o');
  if (output && !force) {
    try {
      await stat(output);
      throw new Error('Output exists; use --force to overwrite');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  let model: Model;
  let text: string;
  let generation:
    | {
        provider: string;
        cacheHit: boolean;
        requests: number;
        usage: TokenUsage | null;
        sourceBytes: number;
      }
    | undefined;
  if (command === 'generate' || command === 'run') {
    let request: GenerationRequest = {
      prompt: input,
      ...(options.has('--model') ? { model: options.get('--model')! } : {}),
      ...(options.has('--timeout') ? { timeoutMs: Number(options.get('--timeout')) } : {}),
    };
    let providerName = options.get('--provider') ?? 'codex';
    if (command === 'run') {
      const task = JSON.parse(await readBounded(input));
      if (
        !task ||
        task.version !== 1 ||
        typeof task.prompt !== 'string' ||
        typeof task.provider !== 'string' ||
        Object.keys(task).some(
          (k) => !['version', 'prompt', 'provider', 'model', 'timeoutMs'].includes(k),
        ) ||
        (task.model !== undefined && typeof task.model !== 'string') ||
        (task.timeoutMs !== undefined && typeof task.timeoutMs !== 'number')
      )
        throw new Error('Invalid Formixel task');
      request = {
        prompt: task.prompt,
        ...(task.model ? { model: task.model } : {}),
        ...(task.timeoutMs !== undefined ? { timeoutMs: task.timeoutMs } : {}),
      };
      providerName = task.provider;
    }
    const provider = createProvider(providerName as ProviderName);
    if (options.has('--reference')) {
      if (provider.name !== 'codex')
        throw new Error('Reference images currently require the Codex provider');
      const path = options.get('--reference')!;
      const s = await stat(path);
      if (!s.isFile() || s.size > 1_000_000)
        throw new Error('Reference must be a PNG file up to 1 MB');
      request.referencePNG = normalizeReferencePNG(await readFile(path));
    }
    validateGenerationRequest(provider.name, request);
    if (options.has('--cache') && !options.get('--cache')!.trim())
      throw new Error('Cache directory must not be empty');
    const cacheDir = options.has('--cache') ? resolve(options.get('--cache')!) : undefined;
    const cacheKey = createHash('sha256')
      .update(
        JSON.stringify([
          1,
          providerName,
          request.model ?? null,
          PLANNER_INSTRUCTIONS + (request.referencePNG ? '\n' + REFERENCE_INSTRUCTIONS : ''),
          request.prompt,
          ...(request.referencePNG
            ? [createHash('sha256').update(request.referencePNG).digest('hex')]
            : []),
        ]),
      )
      .digest('hex');
    const cacheFile = cacheDir ? join(cacheDir, `${cacheKey}.json`) : undefined;
    if (cacheFile === resolve(output!)) throw new Error('Output must differ from cache entry');
    let cached: string | undefined;
    if (cacheFile) {
      try {
        const entry = JSON.parse(await readBounded(cacheFile));
        if (
          !entry ||
          entry.version !== 1 ||
          typeof entry.source !== 'string' ||
          Object.keys(entry).some((k) => !['version', 'source'].includes(k))
        )
          throw new Error('Invalid cache entry');
        if (!parseFXL(entry.source).cubes.length)
          throw new Error('Generated model has no geometry');
        cached = entry.source;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    let usage: TokenUsage | null = null;
    text =
      cached ??
      (await provider.generate({
        ...request,
        onUsage: (value) => {
          usage = value;
        },
      }));
    model = parseFXL(text); // Never persist invalid provider output.
    if (!model.cubes.length) throw new Error('Generated model has no geometry');
    if (cacheFile && cached === undefined) {
      await mkdir(cacheDir!, { recursive: true });
      try {
        await atomicWrite(cacheFile, JSON.stringify({ version: 1, source: text }));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    generation = {
      provider: providerName,
      cacheHit: cached !== undefined,
      requests: cached === undefined ? 1 : 0,
      usage,
      sourceBytes: Buffer.byteLength(text),
    };
  } else {
    text = await readBounded(input);
    model = loadText(text, extname(input).toLowerCase());
  }
  let result: string | Uint8Array;
  if (command === 'inspect') result = JSON.stringify(inspect(model), null, 2) + '\n';
  else if (command === 'quality') result = JSON.stringify(analyzeQuality(model), null, 2) + '\n';
  else if (command === 'validate')
    result =
      JSON.stringify(
        { valid: validate(model).length === 0, diagnostics: validate(model) },
        null,
        2,
      ) + '\n';
  else if (command === 'render') {
    if (options.has('--time') && !options.has('--animation'))
      throw new Error('--time requires --animation');
    if (options.has('--texture')) {
      if (['--size', '--animation', '--time', '--view'].some((k) => options.has(k)))
        throw new Error('Texture export cannot be combined with preview options');
      const texture = model.textures?.find((t) => t.id === options.get('--texture'));
      if (!texture) throw new Error('Unknown texture');
      result = encodePNG({
        width: texture.width,
        height: texture.height,
        pixels: Uint8Array.from(texture.pixels),
      });
    } else if (extname(output!).toLowerCase() === '.png') {
      const size = Number(options.get('--size') ?? 512);
      result = renderPNG(model, {
        width: size,
        height: size,
        ...(options.has('--view') ? { view: options.get('--view') as RenderView } : {}),
        ...(options.has('--animation')
          ? { animation: options.get('--animation')!, time: Number(options.get('--time') ?? 0) }
          : {}),
      });
    } else {
      if (
        options.has('--animation') ||
        options.has('--time') ||
        options.has('--size') ||
        options.has('--view')
      )
        throw new Error('Animation and size options require PNG output');
      result = renderSVG(model);
    }
  } else if (command === 'patch') {
    const patch = options.get('--patch');
    if (!patch) throw new Error('Specify --patch');
    result = serialize(applyPatch(model, JSON.parse(await readBounded(patch))));
  } else if (command === 'build' || command === 'export')
    result = JSON.stringify(exportBBModel(model), null, 2) + '\n';
  else if (command === 'generate' || command === 'run') result = text.trim() + '\n';
  else result = serialize(model);
  if (output) {
    await atomicWrite(resolve(output), result, force);
    console.log(
      JSON.stringify({
        output: resolve(output),
        ...inspect(model),
        ...(generation ? { generation } : {}),
      }),
    );
  } else process.stdout.write(result);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(`Formixel: ${(e as Error).message}`);
    process.exitCode = 1;
  });

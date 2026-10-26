import { readFile, stat, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import {
  exportBBModel,
  serialize,
  analyzeQuality,
  type Model,
  type RenderView,
  parseProductionBrief,
  validateProductionPolicy,
  type AnatomyRoles,
  createModelContext,
  validateModelContext,
  exportBBModelWithContext,
} from '@formixel/core';
import { parseDesignDocument, authorDesign, reviewModel } from '@formixel/core';
import { compareReference } from '@formixel/core';
import {
  normalizeReferences,
  type GenerationRequest,
  type ProviderName,
} from '@formixel/providers';
import { executeWorkflow, WorkflowFailure } from './workflow.js';
import { workflowArtifact } from './artifact.js';
import { startBridge } from './bridge.js';
import { readBounded, loadText, atomicWrite } from './io.js';

export async function loadReferences(
  path: string,
): Promise<NonNullable<GenerationRequest['references']>> {
  const manifest = JSON.parse(await readBounded(path));
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 8)
    throw new Error('References must be an array of 1..8 explicit role/path entries');
  const images = [];
  for (const item of manifest) {
    if (
      !item ||
      Object.keys(item).some((k) => !['role', 'path'].includes(k)) ||
      typeof item.role !== 'string' ||
      typeof item.path !== 'string' ||
      !item.path.trim()
    )
      throw new Error('Invalid reference manifest entry');
    const file = resolve(dirname(resolve(path)), item.path);
    const s = await stat(file);
    if (!s.isFile() || s.size > 1_000_000)
      throw new Error('Reference must be a PNG file up to 1 MB');
    images.push({
      role: item.role as NonNullable<GenerationRequest['references']>[number]['role'],
      png: Uint8Array.from(await readFile(file)),
    });
  }
  return normalizeReferences({ references: images });
}

export async function workflowCommand(argv: string[]): Promise<void> {
  const args = [...argv],
    command = args.shift()!;
  const input = command === 'bridge' ? undefined : args.shift();
  if (command !== 'bridge' && (!input || input.startsWith('-')))
    throw new Error('Missing workflow input');
  const options = new Map<string, string>();
  let force = false;
  const permitted: Record<string, string[]> = {
    craft: [
      '--output',
      '--provider',
      '--model',
      '--timeout',
      '--cache',
      '--references',
      '--anatomy',
      '--floor',
      '--forward',
      '--airborne',
      '--weapon-hands',
    ],
    refine: [
      '--output',
      '--provider',
      '--model',
      '--timeout',
      '--cache',
      '--references',
      '--select',
      '--instruction',
      '--constraints',
      '--anatomy',
      '--floor',
      '--forward',
      '--airborne',
      '--weapon-hands',
      '--roles',
      '--context',
    ],
    author: ['--output', '--anatomy', '--floor', '--forward', '--airborne', '--weapon-hands'],
    review: [
      '--output',
      '--references',
      '--constraints',
      '--anatomy',
      '--floor',
      '--forward',
      '--airborne',
      '--weapon-hands',
      '--roles',
      '--context',
    ],
    bridge: ['--port'],
  };
  while (args.length) {
    const raw = args.shift()!;
    if (raw === '--force' && command !== 'bridge') {
      if (force) throw new Error('Duplicate --force');
      force = true;
      continue;
    }
    const flag = raw === '-o' ? '--output' : raw;
    if (!permitted[command]?.includes(flag) || !args.length || options.has(flag))
      throw new Error('Invalid or duplicate workflow option: ' + raw);
    options.set(flag, args.shift()!);
  }
  if (command === 'bridge') {
    const bridge = await startBridge({ port: Number(options.get('--port') ?? 0) });
    console.log(
      JSON.stringify({
        service: 'Formixel bridge',
        url: bridge.url,
        token: bridge.token,
        note: 'Paste into the Formixel panel; keep token private. Ctrl+C closes the bridge and cancels the active job.',
      }),
    );
    await new Promise<void>((resolve, reject) => {
      let closing = false;
      const stop = () => {
        if (closing) return;
        closing = true;
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        void bridge.close().then(resolve, reject);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
    return;
  }
  const output = options.get('--output');
  if (!output && command !== 'review') throw new Error('Specify output with -o');
  if (output) {
    if (!['.zip', '.bbmodel', '.json'].includes(extname(output).toLowerCase()))
      throw new Error('Workflow output must be .zip, .bbmodel or .json');
    if (output.toLowerCase().endsWith('.design.json') && !['craft', 'author'].includes(command))
      throw new Error('Only craft/author produces a design document');
    const parent = dirname(resolve(output));
    if (!(await stat(parent)).isDirectory()) throw new Error('Output parent must be a directory');
    await access(parent, constants.W_OK);
    try {
      if (!(await stat(output)).isFile()) throw new Error('Output must be a regular file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (output && !force) {
    try {
      await stat(output);
      throw new Error('Output exists; use --force to overwrite');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const references = options.has('--references')
    ? await loadReferences(options.get('--references')!)
    : undefined;
  const inputText = ['refine', 'review'].includes(command) ? await readBounded(input!) : undefined;
  const inputModel =
    inputText === undefined ? undefined : loadText(inputText, extname(input!).toLowerCase());
  const inputData =
    inputText !== undefined && !['.fxl', '.bbscript'].includes(extname(input!).toLowerCase())
      ? JSON.parse(inputText)
      : undefined;
  const contextData = options.has('--context')
    ? JSON.parse(await readBounded(options.get('--context')!))
    : inputData?.formixel_context;
  const inherited =
    inputModel && contextData !== undefined
      ? validateModelContext(inputModel, contextData)
      : undefined;
  const brief = parseProductionBrief({
    ...(inherited?.brief ?? {}),
    anatomy: options.get('--anatomy') ?? inherited?.brief.anatomy ?? 'prop',
    ...(options.has('--floor') ? { floor: Number(options.get('--floor')) } : {}),
    ...(options.has('--forward')
      ? { forward: options.get('--forward')!.split(',').map(Number) }
      : {}),
    ...(options.has('--airborne')
      ? {
          airborneAnimations: options
            .get('--airborne')!
            .split(',')
            .map((s) => s.trim()),
        }
      : {}),
    ...(options.has('--weapon-hands')
      ? { weaponHands: Number(options.get('--weapon-hands')) }
      : {}),
  });
  let roles: AnatomyRoles | undefined = options.has('--roles')
    ? JSON.parse(await readBounded(options.get('--roles')!))
    : inherited?.roles;
  let constraints: unknown = options.has('--constraints')
    ? JSON.parse(await readBounded(options.get('--constraints')!))
    : inherited?.constraints;
  if (['review', 'refine'].includes(command) && input?.toLowerCase().endsWith('.json')) {
    const document = JSON.parse(await readBounded(input));
    if (document && typeof document === 'object' && 'source' in document) {
      const design = parseDesignDocument(document);
      constraints ??= design.authoring.constraints;
      roles ??= design.authoring.roles;
    }
  }
  let model: Model;
  let details: Record<string, any>;
  if (command === 'craft' || command === 'refine') {
    const directory = options.has('--cache') ? resolve(options.get('--cache')!) : undefined;
    if (options.has('--cache') && !options.get('--cache')!.trim())
      throw new Error('Cache directory must not be empty');
    const base = command === 'refine' ? inputModel! : undefined;
    if (
      command === 'refine' &&
      (!options.get('--instruction')?.trim() || !options.get('--select')?.trim())
    )
      throw new Error('Refine requires --instruction and --select');
    const result = await executeWorkflow(
      {
        kind: command,
        brief,
        prompt: command === 'craft' ? input! : options.get('--instruction')!,
        provider: (options.get('--provider') ?? 'codex') as ProviderName,
        ...(options.has('--model') ? { model: options.get('--model')! } : {}),
        ...(options.has('--timeout') ? { timeoutMs: Number(options.get('--timeout')) } : {}),
        ...(references ? { references } : {}),
        ...(roles !== undefined ? { roles } : {}),
        ...(base
          ? {
              base,
              selection: options
                .get('--select')!
                .split(',')
                .map((s) => s.trim()),
            }
          : {}),
        ...(constraints !== undefined ? { constraints } : {}),
      },
      {
        ...(directory
          ? {
              cache: {
                read: async (key: string) => {
                  if (resolve(output!) === join(directory, `workflow-${key}.json`))
                    throw new Error('Output must differ from workflow cache entry');
                  try {
                    const entry = JSON.parse(
                      await readBounded(join(directory, `workflow-${key}.json`)),
                    );
                    if (
                      !entry ||
                      entry.version !== 2 ||
                      typeof entry.source !== 'string' ||
                      Object.keys(entry).some((k) => !['version', 'source'].includes(k))
                    )
                      throw new Error('Invalid workflow cache');
                    return entry.source;
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                    return undefined;
                  }
                },
                write: async (key: string, source: string) => {
                  await mkdir(directory, { recursive: true });
                  try {
                    await atomicWrite(
                      join(directory, `workflow-${key}.json`),
                      JSON.stringify({ version: 2, source }),
                    );
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                  }
                },
              },
            }
          : {}),
        onProgress: (phase) => process.stderr.write(JSON.stringify({ phase }) + '\n'),
      },
    ).catch((error) => {
      if (error instanceof WorkflowFailure)
        process.stderr.write(JSON.stringify({ failed: true, metrics: error.metrics }) + '\n');
      throw error;
    });
    model = result.model;
    details = {
      review: result.review,
      metrics: result.metrics,
      context: result.context,
      ...('design' in result && result.design ? { design: result.design } : {}),
    };
  } else if (command === 'author') {
    const design = parseDesignDocument(JSON.parse(await readBounded(input!)));
    const authored = authorDesign(design);
    if (!authored.report.passed)
      throw new Error('Design constraints failed: ' + JSON.stringify(authored.report));
    model = authored.model;
    const policy = validateProductionPolicy(model, design.authoring.roles, brief);
    if (!policy.passed)
      throw new Error('Production anatomy policy failed: ' + JSON.stringify(policy));
    details = {
      design,
      context: createModelContext(model, {
        brief,
        ...(design.authoring.roles ? { roles: design.authoring.roles } : {}),
        ...(design.authoring.constraints ? { constraints: design.authoring.constraints } : {}),
      }),
      review: { rig: authored.report, technical: analyzeQuality(model), policy },
    };
  } else {
    model = inputModel!;
    details = {
      context: createModelContext(model, {
        brief,
        ...(roles ? { roles } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
      }),
      review: {
        rig: reviewModel(model, constraints ?? []),
        technical: analyzeQuality(model),
        policy: validateProductionPolicy(model, roles, brief),
      },
    };
  }
  const attachments: Record<string, Uint8Array> = {};
  if (references) {
    details.references = references.map((reference, i): Record<string, unknown> => {
      if (!['front', 'back', 'left', 'right', 'top'].includes(reference.role))
        return {
          role: reference.role,
          compared: false,
          reason: 'Detail, texture and storyboard references require visual review.',
        };
      const comparison = compareReference(model, reference.png, reference.role as RenderView);
      attachments[`reference-${i}-overlay.png`] = comparison.overlay;
      attachments[`reference-${i}-model.png`] = comparison.render;
      return { ...comparison.report, role: reference.role, compared: true };
    });
  }
  let bytes: string | Uint8Array;
  const outputSuffix = output?.toLowerCase();
  if (outputSuffix?.endsWith('.zip')) bytes = workflowArtifact(model, details, attachments);
  else if (outputSuffix?.endsWith('.design.json')) {
    if (!details.design) throw new Error('Only craft/author produces a design document');
    bytes = JSON.stringify(details.design, null, 2) + '\n';
  } else if (outputSuffix?.endsWith('.bbmodel'))
    bytes = JSON.stringify(exportBBModelWithContext(model, details.context), null, 2) + '\n';
  else if (command === 'review') bytes = JSON.stringify(details, null, 2) + '\n';
  else if (outputSuffix?.endsWith('.json')) bytes = serialize(model);
  else throw new Error('Workflow output must be .zip, .bbmodel, .design.json or .bbir.json');
  if (Buffer.byteLength(bytes) > 32_000_000) throw new Error('Workflow output exceeds 32 MB');
  if (output) {
    await atomicWrite(resolve(output), bytes, force);
    console.log(
      JSON.stringify({ output: resolve(output), ...details.metrics, review: details.review }),
    );
  } else process.stdout.write(bytes);
  if (
    command === 'review' &&
    (!details.review.rig.passed ||
      !details.review.policy.passed ||
      details.review.technical.issues.length)
  )
    throw new Error('Review found violations; see report');
}

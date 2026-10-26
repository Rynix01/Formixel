import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  authorDesign,
  parseDesignDocument,
  reviewModel,
  DESIGN_INSTRUCTIONS,
  validateProductionPolicy,
  type ProductionBrief,
  parseProductionBrief,
  assertAnatomyReferences,
  createModelContext,
} from '@formixel/core';
import { applyRepair, prepareRepair } from '@formixel/core';
import { PATCH_INSTRUCTIONS } from '@formixel/core';
import { analyzeQuality } from '@formixel/core';
import { inspect } from '@formixel/core';
import { serialize, assertModel, type Model } from '@formixel/core';
import {
  createProvider,
  normalizeReferencePNG,
  validateGenerationRequest,
  generationInstructions,
  SYSTEM_PROMPT,
  type Provider,
  type ProviderName,
  type GenerationRequest,
  type TokenUsage,
} from '@formixel/providers';

export interface WorkflowRequest {
  kind: 'craft' | 'refine';
  prompt: string;
  provider: ProviderName;
  model?: string;
  timeoutMs?: number;
  references?: NonNullable<GenerationRequest['references']>;
  base?: Model;
  selection?: string[];
  constraints?: unknown;
  brief?: ProductionBrief;
  roles?: unknown;
}
export interface WorkflowOptions {
  /** Trusted host injection for transport tests; never taken from job JSON. */
  provider?: Provider;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
  cache?: {
    read: (key: string) => Promise<string | undefined>;
    write: (key: string, value: string) => Promise<void>;
  };
}

export class WorkflowFailure extends Error {
  constructor(
    message: string,
    readonly metrics: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkflowFailure';
  }
}

/** One explicit planning or repair request, followed entirely by local authoring and review. */
export async function executeWorkflow(request: WorkflowRequest, options: WorkflowOptions = {}) {
  if (!request || !['craft', 'refine'].includes(request.kind)) throw new Error('Unknown workflow');
  const started = performance.now();
  const progress = (phase: string) => {
    options.signal?.throwIfAborted();
    options.onProgress?.(phase);
  };
  progress('validating');
  if (request.kind === 'craft' && (request.base || request.selection))
    throw new Error('Craft does not accept an existing selection');
  if (request.kind === 'refine' && (!request.base || !request.selection?.length))
    throw new Error('Refine requires a model and explicit selection');
  if (request.base) assertModel(request.base);
  const brief = parseProductionBrief(request.brief ?? { anatomy: 'prop' });
  if (request.roles !== undefined && !request.base)
    throw new Error('Existing roles require a base model');
  if (request.base && request.roles !== undefined)
    assertAnatomyReferences(request.base, request.roles);
  if (request.constraints !== undefined && !request.base)
    throw new Error('External constraints require an existing model');
  if (request.base && request.constraints !== undefined)
    reviewModel(request.base, request.constraints);
  const repair =
    request.kind === 'refine'
      ? prepareRepair(request.base!, request.selection!, request.prompt)
      : undefined;
  const references = request.references?.map((r) => ({
    role: r.role,
    png: normalizeReferencePNG(r.png),
  }));
  const generation: GenerationRequest = {
    prompt:
      (repair?.prompt ?? request.prompt) +
      (request.constraints !== undefined
        ? '\nRequired post-repair constraints (preserve these exact marker meanings):\n' +
          JSON.stringify(request.constraints)
        : '') +
      '\nCaller-selected production brief: ' +
      JSON.stringify(brief) +
      (request.roles !== undefined
        ? '\nExisting semantic anatomy roles: ' + JSON.stringify(request.roles)
        : ''),
    outputFormat: request.kind === 'craft' ? 'design' : 'patch',
    outputInstructions:
      request.kind === 'craft'
        ? DESIGN_INSTRUCTIONS +
          '\nFXL grammar applies ONLY inside the source JSON string:\n' +
          SYSTEM_PROMPT.split('\n').slice(1).join('\n') +
          '\nProduction requirements: include a complete per-part atlas with requireCoverage:true and at least one meaningful rig/ground constraint. Preserve requested anatomy; do not substitute an example character.'
        : PATCH_INSTRUCTIONS,
    ...(request.model !== undefined ? { model: request.model } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(references?.length ? { references } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  validateGenerationRequest(request.provider, generation);
  if (options.provider && options.provider.name !== request.provider)
    throw new Error('Injected provider does not match selected provider');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        version: 2,
        provider: request.provider,
        model: request.model ?? null,
        outputFormat: generation.outputFormat,
        instructions: generationInstructions(generation),
        prompt: generation.prompt,
        references:
          references?.map((r) => [r.role, createHash('sha256').update(r.png).digest('hex')]) ?? [],
        // Prevent a scoped repair cache from being applied against a different base.
        base: request.base
          ? createHash('sha256').update(serialize(request.base)).digest('hex')
          : null,
      }),
    )
    .digest('hex');
  progress('cache');
  let source = await options.cache?.read(fingerprint);
  const cacheHit = source !== undefined;
  let usage: TokenUsage | null = null;
  let attempted = false,
    completed = false;
  try {
    if (source === undefined) {
      progress('planning');
      attempted = true;
      source = await (options.provider ?? createProvider(request.provider)).generate({
        ...generation,
        onUsage: (value) => {
          usage = value;
        },
      });
      completed = true;
    }
    progress('authoring');
    if (typeof source !== 'string' || Buffer.byteLength(source) > 2_000_000)
      throw new Error('Workflow response exceeds 2 MB');
    const data: unknown = JSON.parse(source);
    const design = request.kind === 'craft' ? parseDesignDocument(data) : undefined;
    if (
      design &&
      (!design.authoring.atlas ||
        design.authoring.atlas.requireCoverage === false ||
        !design.authoring.constraints?.length)
    )
      throw new Error(
        'Production design requires complete atlas coverage and explicit rig constraints',
      );
    const authored = design ? authorDesign(design) : undefined;
    const model = authored?.model ?? applyRepair(request.base!, data, request.selection!);
    progress('reviewing');
    const technical = analyzeQuality(model);
    const baseline = request.base ? analyzeQuality(request.base) : undefined;
    const originalIssues = new Set(baseline?.issues.map((i) => JSON.stringify(i)) ?? []);
    const newIssues = technical.issues.filter((i) => !originalIssues.has(JSON.stringify(i)));
    const constrained =
      request.constraints === undefined ? undefined : reviewModel(model, request.constraints);
    const policy = validateProductionPolicy(model, design?.authoring.roles ?? request.roles, brief);
    if (
      newIssues.length ||
      technical.untexturedFaces > (baseline?.untexturedFaces ?? 0) ||
      authored?.report.passed === false ||
      constrained?.passed === false ||
      !policy.passed
    )
      throw new Error(
        'Local production review failed: ' +
          JSON.stringify({
            quality: technical,
            rig: authored?.report,
            constraints: constrained,
            policy,
          }),
      );
    if (!cacheHit) await options.cache?.write(fingerprint, source);
    progress('complete');
    return {
      model,
      context: createModelContext(model, {
        brief,
        ...((design?.authoring.roles ?? request.roles)
          ? { roles: design?.authoring.roles ?? request.roles }
          : {}),
        ...((design?.authoring.constraints ?? request.constraints)
          ? { constraints: design?.authoring.constraints ?? request.constraints }
          : {}),
      }),
      ...(design ? { design } : { patches: data }),
      review: {
        technical,
        policy,
        ...(authored ? { rig: authored.report } : {}),
        ...(constrained ? { constraints: constrained } : {}),
      },
      metrics: {
        version: 1,
        kind: request.kind,
        provider: request.provider,
        model: request.model ?? null,
        requests: cacheHit ? 0 : 1,
        cacheHit,
        usage,
        responseBytes: Buffer.byteLength(source),
        promptBytes: Buffer.byteLength(generation.prompt),
        instructionBytes: Buffer.byteLength(generationInstructions(generation)),
        referenceBytes: references?.reduce((sum, r) => sum + r.png.length, 0) ?? 0,
        elapsedMs: Math.round(performance.now() - started),
        fingerprint,
        geometry: inspect(model),
        ...(repair
          ? { repairContextBytes: repair.contextBytes, fullSourceBytes: repair.sourceBytes }
          : {}),
        scope:
          'Reported token counters and local constraints; artistic fidelity requires the accompanying views.',
      },
    };
  } catch (error) {
    throw new WorkflowFailure((error as Error).message, {
      version: 1,
      kind: request.kind,
      provider: request.provider,
      model: request.model ?? null,
      failed: true,
      cacheHit,
      generationAttempts: attempted ? 1 : 0,
      completedProviderRequests: completed ? 1 : 0,
      usage,
      fingerprint,
      elapsedMs: Math.round(performance.now() - started),
      promptBytes: Buffer.byteLength(generation.prompt),
      instructionBytes: Buffer.byteLength(generationInstructions(generation)),
      scope:
        'Failed local review still reports observed provider usage; an attempted transport with no reported counters has unknown token usage.',
    });
  }
}

import type { ProviderName, TokenUsage } from '@formixel/providers';

export interface EvaluationIdentity {
  id: string;
  promptHash: string;
  referenceHash: string;
  provider: ProviderName;
  model: string | null;
}
export interface EvaluationRecord {
  task: EvaluationIdentity;
  iteration: number;
  wallElapsedMs: number;
  metrics: Record<string, unknown>;
  review: Record<string, unknown>;
  modelHash: string;
  renderHashes: Record<string, string>;
}
const object = (value: unknown, name: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${name}`);
  return value as Record<string, any>;
};
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error('Invalid evaluation counter');
  return value;
};
const hash = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid evaluation hash');
  return value;
};
function usage(value: unknown): TokenUsage | null {
  if (value === null) return null;
  const v = object(value, 'usage');
  if (
    Object.keys(v).some(
      (k) =>
        !['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens'].includes(k),
    )
  )
    throw new Error('Unknown usage counter');
  const input = integer(v.inputTokens),
    output = integer(v.outputTokens),
    cached = v.cachedInputTokens === null ? null : integer(v.cachedInputTokens),
    reasoning = v.reasoningOutputTokens === null ? null : integer(v.reasoningOutputTokens);
  if ((cached !== null && cached > input) || (reasoning !== null && reasoning > output))
    throw new Error('Inconsistent usage counters');
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    reasoningOutputTokens: reasoning,
  };
}
function rig(value: unknown) {
  if (value === undefined) return null;
  const v = object(value, 'rig report');
  if (
    typeof v.passed !== 'boolean' ||
    !Array.isArray(v.checks) ||
    v.checks.length > 256 ||
    !Array.isArray(v.issues)
  )
    throw new Error('Invalid rig report');
  const count = integer(v.issueCount);
  if (
    v.issues.length > count ||
    (v.passed && (count !== 0 || v.checks.some((c: any) => c?.passed !== true)))
  )
    throw new Error('Inconsistent rig report');
  return { passed: v.passed, checks: v.checks.length, issues: count };
}
function parseRecord(value: unknown) {
  const v = object(value, 'evaluation record');
  if (
    Object.keys(v).some(
      (k) =>
        ![
          'task',
          'iteration',
          'wallElapsedMs',
          'metrics',
          'review',
          'modelHash',
          'renderHashes',
        ].includes(k),
    )
  )
    throw new Error('Unknown evaluation field');
  const task = object(v.task, 'task identity');
  if (
    Object.keys(task).some(
      (k) => !['id', 'promptHash', 'referenceHash', 'provider', 'model'].includes(k),
    ) ||
    typeof task.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(task.id) ||
    !['codex', 'claude-code', 'openai', 'anthropic'].includes(task.provider) ||
    (task.model !== null &&
      (typeof task.model !== 'string' ||
        !task.model ||
        task.model.length > 128 ||
        task.model.startsWith('-')))
  )
    throw new Error('Invalid task identity');
  const identity: EvaluationIdentity = {
    id: task.id,
    promptHash: hash(task.promptHash),
    referenceHash: hash(task.referenceHash),
    provider: task.provider,
    model: task.model,
  };
  const metrics = object(v.metrics, 'workflow metrics');
  if (
    metrics.version !== 1 ||
    !['craft', 'refine'].includes(metrics.kind) ||
    metrics.provider !== identity.provider ||
    metrics.model !== identity.model ||
    typeof metrics.cacheHit !== 'boolean'
  )
    throw new Error('Workflow identity mismatch');
  const requests = integer(metrics.requests, 1),
    iteration = integer(v.iteration, 2);
  if (metrics.cacheHit !== (requests === 0) || (iteration === 0) !== (requests === 1))
    throw new Error('Expected one cold generation followed by cache-only repeats');
  const reported = usage(metrics.usage);
  if (requests === 0 && reported !== null)
    throw new Error('Cache hits cannot report new provider usage');
  const review = object(v.review, 'review'),
    technical = object(review.technical, 'technical review');
  if (
    !Array.isArray(technical.issues) ||
    technical.issues.length > 10000 ||
    typeof technical.textureCoverage !== 'number' ||
    !Number.isFinite(technical.textureCoverage) ||
    technical.textureCoverage < 0 ||
    technical.textureCoverage > 1
  )
    throw new Error('Invalid technical review');
  const rigReport = rig(review.rig),
    constraintReport = rig(review.constraints);
  const policy = object(review.policy, 'production policy');
  if (
    !['prop', 'biped', 'quadruped'].includes(policy.anatomy) ||
    typeof policy.passed !== 'boolean' ||
    !Array.isArray(policy.issues) ||
    policy.issues.length > 1000
  )
    throw new Error('Invalid production policy report');
  const policyIssues = integer(policy.issueCount),
    policySamples = integer(policy.samples, 2_000_000);
  if (
    policy.passed !== (policyIssues === 0) ||
    policy.issues.length > policyIssues ||
    !policySamples
  )
    throw new Error('Inconsistent production policy evidence');
  if (metrics.kind === 'craft' && !rigReport?.checks)
    throw new Error('Craft evaluation requires explicit rig constraints');
  const renderHashes = object(v.renderHashes, 'render hashes');
  if (
    Object.keys(renderHashes).length > 14 ||
    Object.keys(renderHashes).some(
      (k) => !/^(isometric|front|back|left|right|top)\.png$|^motion-[0-7]\.gif$/.test(k),
    ) ||
    ['isometric', 'front', 'back', 'left', 'right', 'top'].some(
      (name) => !renderHashes[name + '.png'],
    )
  )
    throw new Error('Incomplete or invalid evaluation renders');
  for (const value of Object.values(renderHashes)) hash(value);
  const summary = {
    iteration,
    requests,
    cacheHit: metrics.cacheHit,
    usage: reported,
    elapsedMs: integer(metrics.elapsedMs, 86_400_000),
    wallElapsedMs: integer(v.wallElapsedMs, 86_400_000),
    promptBytes: integer(metrics.promptBytes, 32_000),
    instructionBytes: integer(metrics.instructionBytes, 128_000),
    referenceBytes: integer(metrics.referenceBytes, 8_000_000),
    responseBytes: integer(metrics.responseBytes, 2_000_000),
    textureCoverage: technical.textureCoverage,
    untexturedFaces: integer(technical.untexturedFaces),
    technicalIssues: technical.issues.length,
    rig: rigReport,
    constraints: constraintReport,
    policy: {
      passed: policy.passed as boolean,
      anatomy: policy.anatomy as string,
      issues: policyIssues,
      samples: policySamples,
    },
  };
  return {
    task: identity,
    fingerprint: hash(metrics.fingerprint),
    kind: metrics.kind,
    modelHash: hash(v.modelHash),
    renderHashes: Object.fromEntries(
      Object.entries(renderHashes).sort(([a], [b]) => a.localeCompare(b, 'en')),
    ),
    summary,
  };
}
function sum(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  const result = (values as number[]).reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(result) ? result : null;
}
/** Compare actual counters and deterministic artifacts, never infer an artistic quality score. */
export function summarizeEvaluations(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24)
    throw new Error('Evaluation needs 1..24 run records');
  const records = value.map(parseRecord),
    tasks = new Map<string, typeof records>();
  for (const record of records) {
    const group = tasks.get(record.task.id) ?? [];
    if (
      group.length &&
      (JSON.stringify(group[0]!.task) !== JSON.stringify(record.task) ||
        group[0]!.fingerprint !== record.fingerprint ||
        group[0]!.kind !== record.kind)
    )
      throw new Error(
        'Cannot compare changed prompts, references, provider, model or instruction contracts',
      );
    group.push(record);
    tasks.set(record.task.id, group);
  }
  if (tasks.size > 8) throw new Error('At most eight evaluation tasks');
  const results = [...tasks.values()].map((group) => {
    group.sort((a, b) => a.summary.iteration - b.summary.iteration);
    if (group.length > 3 || group.some((r, i) => r.summary.iteration !== i))
      throw new Error('Duplicate or missing evaluation iteration');
    const baseline = group[0]!,
      warm = group.slice(1),
      total = (key: keyof TokenUsage) =>
        sum(group.map((r) => (r.summary.requests === 0 ? 0 : (r.summary.usage?.[key] ?? null))));
    const localReviewPassed = group.every(
      (r) =>
        r.summary.technicalIssues === 0 &&
        r.summary.untexturedFaces === 0 &&
        r.summary.textureCoverage === 1 &&
        r.summary.rig?.passed !== false &&
        r.summary.policy.passed &&
        r.summary.constraints?.passed !== false,
    );
    return {
      task: baseline.task,
      fingerprint: baseline.fingerprint,
      runs: group.map((r) => r.summary),
      requests: group.reduce((n, r) => n + r.summary.requests, 0),
      totals: {
        inputTokens: total('inputTokens'),
        outputTokens: total('outputTokens'),
        cachedInputTokens: total('cachedInputTokens'),
        nonCacheReadInputTokens: sum(
          group.map((r) =>
            r.summary.requests === 0
              ? 0
              : r.summary.usage?.cachedInputTokens !== null &&
                  r.summary.usage?.cachedInputTokens !== undefined
                ? r.summary.usage.inputTokens - r.summary.usage.cachedInputTokens
                : null,
          ),
        ),
        reasoningOutputTokens: total('reasoningOutputTokens'),
        elapsedMs: group.reduce((n, r) => n + r.summary.elapsedMs, 0),
        wallElapsedMs: group.reduce((n, r) => n + r.summary.wallElapsedMs, 0),
      },
      cold: baseline.summary,
      comparisons: warm.map((r) => ({
        iteration: r.summary.iteration,
        sameModel: baseline.modelHash === r.modelHash,
        sameRenders: JSON.stringify(baseline.renderHashes) === JSON.stringify(r.renderHashes),
        requestsAvoided: baseline.summary.requests - r.summary.requests,
        inputTokensAvoided: baseline.summary.usage?.inputTokens ?? null,
        outputTokensAvoided: baseline.summary.usage?.outputTokens ?? null,
        // A cache hit performs no inference; zero is known independently of absent usage.
        inputTokenReductionPercent:
          baseline.summary.usage && baseline.summary.usage.inputTokens > 0 ? 100 : null,
        elapsedMsChange: r.summary.elapsedMs - baseline.summary.elapsedMs,
        wallElapsedMsChange: r.summary.wallElapsedMs - baseline.summary.wallElapsedMs,
      })),
      localReviewPassed,
    };
  });
  return {
    version: 1,
    tasks: results,
    passed: results.every(
      (t) => t.localReviewPassed && t.comparisons.every((c) => c.sameModel && c.sameRenders),
    ),
    scope:
      'Same-task cold versus validated-cache repeats. Reported token counters, local constraints and exact model/render hashes; no aesthetic score, account bill, or quality-equivalent comparison between independent generations.',
  };
}

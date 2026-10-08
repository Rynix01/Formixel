import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export type ProviderName = 'codex' | 'claude-code' | 'openai' | 'anthropic';
export interface GenerationRequest {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  onUsage?: (usage: TokenUsage | null) => void;
}
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
}
export interface Provider {
  name: ProviderName;
  generate(request: GenerationRequest): Promise<string>;
}
export const SYSTEM_PROMPT = `Return ONLY valid compact FXL; no markdown/tools/commands. Generic Blockbench cuboids, no meshes/expressions.
model "name"
Root declarations (before use): material m "#hex"; pattern p 8 8 "#hex" "#hex"; skin s stone "#45545a" "#94a899" seed 7. Skin kinds: bark,stone,metal,cloth,leaf,rune; local deterministic pixels, not painted art. Semicolons here separate examples; NEVER emit semicolons.
cube id [fromX,Y,Z] [positiveSizeX,Y,Z] optional clauses IN ORDER: origin [X,Y,Z] rotate [X,Y,Z] color 0..7 material m surface s. Omit unused clauses. Names begin letter/underscore, then letters/digits/_.-.
group id origin [pivotX,Y,Z] rotate [degreesX,Y,Z] { cubes/groups/use/macros }. Coordinates and pivots are ABSOLUTE even in groups; pivots don't translate children.
Reuse repeated structures: component plate { cube slab [-2,0,-1] [4,5,2] surface s } then use plate left at [5,10,0] scale [1,1,1] rotate [0,0,-10]. Instance creates a group; its children use component LOCAL coordinates. Components are root-only, ordered, no recursive/forward references. Use uniform positive scale. Child IDs: left/slab (or parent/left/slab).
mirror x { ... } duplicates across axis 0; repeat 3 offset [0,2,0] { ... } expands copies. Macros change IDs: avoid animation targets inside macros.
animation idle 2 loop { rotate "torso/head" 0 [0,-5,0] rotate "torso/head" 1 [0,5,0] rotate "torso/head" 2 [0,-5,0] }. Also move/scale; loop or once; optional step; times strictly increase per track within length. Targets must exist.
Budgets: 10000 cubes,1000 groups,depth32,100 components,32 textures. Use components/mirror/repeat instead of spelling out duplicates; never output pixel arrays or bbmodel JSON.`;
export const DESIGN_GUIDANCE = `Design for the requested style: strong silhouette, coherent proportions, grounded feet and exposed joints. RPG bosses need a focal face/core/weapon, broad shoulders, tapered limbs and a deliberate stance. Balance large/medium/small forms; use restrained colours and sparse accents. Avoid checker noise and tiny decoration everywhere. Verify attachment points and animation IDs. Syntax validity is not visual quality.`;
export const PLANNER_INSTRUCTIONS = `${SYSTEM_PROMPT}\n${DESIGN_GUIDANCE}`;
const counter = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function tokenUsage(
  input: unknown,
  output: unknown,
  cached: unknown,
  reasoning: unknown,
): TokenUsage | null {
  const i = counter(input),
    o = counter(output),
    c = counter(cached),
    r = counter(reasoning);
  return i === null || o === null
    ? null
    : { inputTokens: i, outputTokens: o, cachedInputTokens: c, reasoningOutputTokens: r };
}
export function parseCodexEvents(text: string): { source: string; usage: TokenUsage | null } {
  let source = '',
    usage: TokenUsage | null = null,
    completed = false;
  for (const line of text.split(/\r?\n/).filter((s) => s.trim())) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('Malformed provider event stream');
    }
    if (!event || typeof event.type !== 'string') throw new Error('Malformed provider event');
    if (completed) throw new Error('Unexpected event after provider completion');
    if (event.type === 'turn.failed' || event.type === 'error')
      throw new Error('Provider generation failed');
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      if (typeof event.item.text !== 'string') throw new Error('Invalid provider message');
      source = event.item.text;
    }
    if (
      ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(event.item?.type)
    )
      throw new Error('Provider attempted a disallowed tool');
    if (event.type === 'turn.completed') {
      if (completed) throw new Error('Unexpected additional provider turn');
      completed = true;
      usage = tokenUsage(
        event.usage?.input_tokens,
        event.usage?.output_tokens,
        event.usage?.cached_input_tokens,
        event.usage?.reasoning_output_tokens,
      );
    }
  }
  if (!completed || !source.trim()) throw new Error('Provider returned no completed model');
  return { source, usage };
}
const MAX_OUTPUT = 2_000_000;
export function cliArguments(name: 'codex' | 'claude-code', model?: string): string[] {
  if (model && (model.startsWith('-') || model.length > 128))
    throw new Error('Invalid model identifier');
  if (name === 'codex')
    return [
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      '--disable',
      'hooks',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--disable',
      'multi_agent',
      '-c',
      'web_search="disabled"',
      '--color',
      'never',
      '--json',
      ...(model ? ['--model', model] : []),
      '-',
    ];
  return [
    '-p',
    '--bare',
    '--output-format',
    'text',
    '--tools',
    '',
    '--disallowedTools',
    'mcp__*',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--no-session-persistence',
    ...(model ? ['--model', model] : []),
  ];
}
export function runProcess(
  executable: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0,
      settled = false;
    let abortError: Error | undefined;
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result!);
    };
    const abort = (error: Error) => {
      if (settled || abortError) return;
      abortError = error;
      clearTimeout(timer);
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill('SIGKILL'));
        killer.on('exit', (code) => {
          if (code !== 0) child.kill('SIGKILL');
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else child.kill();
      // Wait for close before settling so Windows releases the working directory.
    };
    const timer = setTimeout(() => abort(new Error('Provider timed out')), timeoutMs);
    child.on('error', () =>
      finish(
        new Error('Provider executable unavailable; install the native CLI and authenticate first'),
      ),
    );
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) {
        abort(new Error('Provider output budget exceeded'));
      } else chunks.push(chunk);
    });
    // Drain stderr without persisting potentially sensitive provider diagnostics.
    child.stderr.on('data', () => {});
    child.on('close', (code) =>
      abortError
        ? finish(abortError)
        : code === 0
          ? finish(undefined, Buffer.concat(chunks).toString('utf8'))
          : finish(new Error(`Provider exited unsuccessfully (${code})`)),
    );
    child.stdin.end(input);
  });
}
function timeout(request: GenerationRequest): number {
  const n = request.timeoutMs ?? 120_000;
  if (!Number.isInteger(n) || n < 100 || n > 600_000)
    throw new Error('Timeout must be 100..600000 ms');
  return n;
}
export function validateGenerationRequest(name: ProviderName, request: GenerationRequest): void {
  if (
    typeof request.prompt !== 'string' ||
    !request.prompt.trim() ||
    Buffer.byteLength(request.prompt) > 32_000
  )
    throw new Error('Prompt must be 1..32000 bytes');
  timeout(request);
  if (
    request.model !== undefined &&
    (typeof request.model !== 'string' ||
      !request.model ||
      request.model.startsWith('-') ||
      request.model.length > 128)
  )
    throw new Error('Invalid model identifier');
  if ((name === 'openai' || name === 'anthropic') && !request.model)
    throw new Error('API providers require an explicit model');
}
export function createProvider(name: ProviderName): Provider {
  if (!['codex', 'claude-code', 'openai', 'anthropic'].includes(name))
    throw new Error('Unknown provider');
  return {
    name,
    async generate(request) {
      validateGenerationRequest(name, request);
      const duration = timeout(request);
      if (name === 'codex' || name === 'claude-code') {
        const cwd = await mkdtemp(join(tmpdir(), 'formixel-provider-'));
        try {
          await writeFile(
            join(cwd, 'AGENTS.md'),
            'Only return FXL text. Never use tools or execute commands.',
          );
          const text = await runProcess(
            name === 'codex' ? 'codex' : 'claude',
            cliArguments(name, request.model),
            `${PLANNER_INSTRUCTIONS}\n\nUser request:\n${request.prompt}`,
            cwd,
            duration,
          );
          const result = name === 'codex' ? parseCodexEvents(text) : { source: text, usage: null };
          request.onUsage?.(result.usage);
          return result.source;
        } finally {
          await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
      }
      const key = process.env[name === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'];
      if (!key)
        throw new Error(
          `Set ${name === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} for this optional provider`,
        );
      if (!request.model) throw new Error('API providers require an explicit model');
      const url =
        name === 'openai'
          ? 'https://api.openai.com/v1/responses'
          : 'https://api.anthropic.com/v1/messages';
      const headers: Record<string, string> =
        name === 'openai'
          ? { Authorization: `Bearer ${key}` }
          : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      headers['content-type'] = 'application/json';
      const body =
        name === 'openai'
          ? {
              model: request.model,
              instructions: PLANNER_INSTRUCTIONS,
              input: request.prompt,
              max_output_tokens: 8192,
              store: false,
            }
          : {
              model: request.model,
              system: PLANNER_INSTRUCTIONS,
              messages: [{ role: 'user', content: request.prompt }],
              max_tokens: 8192,
            };
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(duration),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${name} API HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty API response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_OUTPUT) throw new Error('API response budget exceeded');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (name === 'openai' && data.status !== 'completed')
        throw new Error('OpenAI response did not complete');
      if (name === 'anthropic' && data.stop_reason !== 'end_turn')
        throw new Error('Anthropic response did not complete');
      const text =
        name === 'openai'
          ? (data.output ?? [])
              .flatMap((o: any) => o.content ?? [])
              .filter((c: any) => c.type === 'output_text')
              .map((c: any) => c.text)
              .join('\n')
          : (data.content ?? [])
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
      if (!text.trim()) throw new Error('Provider returned no model text');
      request.onUsage?.(
        tokenUsage(
          data.usage?.input_tokens,
          data.usage?.output_tokens,
          name === 'openai'
            ? data.usage?.input_tokens_details?.cached_tokens
            : data.usage?.cache_read_input_tokens,
          name === 'openai' ? data.usage?.output_tokens_details?.reasoning_tokens : undefined,
        ),
      );
      return text;
    },
  };
}

export async function diagnoseProvider(name: ProviderName): Promise<Record<string, unknown>> {
  if (!['codex', 'claude-code', 'openai', 'anthropic'].includes(name))
    throw new Error('Unknown provider');
  if (name === 'openai' || name === 'anthropic')
    return {
      provider: name,
      configured: !!process.env[name === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'],
      liveTest: false,
    };
  const cwd = await mkdtemp(join(tmpdir(), 'formixel-doctor-'));
  const executable = name === 'codex' ? 'codex' : 'claude';
  try {
    let version: string;
    try {
      version = (await runProcess(executable, ['--version'], '', cwd, 5000)).trim().slice(0, 128);
    } catch {
      return { provider: name, installed: false, authenticated: false };
    }
    let authenticated = false;
    try {
      const status = await runProcess(
        executable,
        name === 'codex' ? ['login', 'status'] : ['auth', 'status'],
        '',
        cwd,
        5000,
      );
      authenticated = name === 'codex' || JSON.parse(status).loggedIn === true;
    } catch {}
    return { provider: name, installed: true, version, authenticated, liveTest: false };
  } finally {
    await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

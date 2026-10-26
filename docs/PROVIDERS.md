# Provider contracts

Codex CLI is the default. Claude Code is the other native provider. OpenAI and Anthropic APIs are optional, explicitly selected alternatives. An error never changes the provider, retries a generation, enables tools or relaxes permissions.

```ts
type ReferenceRole =
  'front' | 'back' | 'left' | 'right' | 'top' | 'detail' | 'texture' | 'storyboard';
interface GenerationRequest {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  referencePNG?: Uint8Array;
  references?: Array<{ role: ReferenceRole; png: Uint8Array }>;
  outputFormat?: 'fxl' | 'design' | 'patch';
  outputInstructions?: string;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage | null) => void;
}
```

`Provider.generate(request)` returns untrusted text. Its caller parses and validates FXL, a design contract, or a scoped patch before saving a model. No generated JavaScript, shell commands, expressions or programs are evaluated. `outputInstructions` is a trusted in-process contract, not a field accepted from provider text or arbitrary task files. JSON modes require an explicit contract and receive JSON-only instructions without the FXL-only grammar. FXL remains the default and retains its instruction text.

Prompt and output contract are each limited to 32,000 UTF-8 bytes. Native stdout/API response maximum is 2,000,000 bytes. Timeout defaults to 120 seconds, accepted range 100..600000 ms. API output is limited to 8192 tokens. A native authentication preflight may take up to 15 seconds before generation. Cancellation kills the owned native process tree or aborts HTTP; temporary references are removed after process close. Cancellation cannot undo remote work already processed.

## Capabilities and references

`providerCapabilities(name)` reports supported formats, reference count, cancellation and reported-or-null usage. All four support text, design and patch contracts; only Codex currently accepts image input. Unsupported references fail before transport and are never silently discarded.

Use either backward-compatible `referencePNG` or `references`, never both. A pack contains one to eight PNGs in explicit attachment order. Front/back/left/right/top/texture roles may appear once; detail/storyboard may repeat. Unknown roles/fields and ambiguous duplicates fail. Each raw and normalized PNG is at most 1,000,000 bytes and 262144 pixels, with width/height at most 1024. The pack is bounded to 8,000,000 bytes and 2097152 pixels. Static noninterlaced RGB/RGBA8 only; decoding checks CRCs and inflated-data limits, re-encoding removes metadata.

`normalizeReferences(request)` returns ordered role/normalized-pixel records. `generationInstructions(request)` includes the matching `Image N: role` map. Workflow caches must fingerprint the exact instructions, output mode, provider/model/prompt and ordered role/pixel hashes. Paths and metadata are not semantic reference identity. Legacy single-PNG FXL instructions stay unchanged for cache compatibility. Reference bytes, transcripts, credentials and raw prompts do not belong in cache records or release assets.

Codex receives repeated fixed `--image` arguments with absolute paths inside an owned temporary directory, e.g. `reference-1-front.png`. Staging files are removed after child completion. Multiple image attachments are documented in the [official Codex CLI reference](https://learn.chatgpt.com/docs/cli/reference). Fixed flags retain ignored user config/rules, ephemeral operation, read-only sandbox, disabled shell/execution/hooks/plugins/apps/multi-agent features, disabled web search and JSON events. Missing flags are fatal. Completed agent text and allowlisted usage are extracted; incomplete/error streams and tool attempts are rejected. Raw events and reasoning text are not saved.

## Native Claude Code

Formixel uses native executables, never npm command-shell shims. Claude uses print mode, JSON output, no built-in tools, denied MCP tools, strict empty MCP configuration, dontAsk, empty setting sources, disabled hooks/plugins/automatic memory/skills/Chrome and no session persistence. See the [official CLI reference](https://code.claude.com/docs/en/cli-reference).

The adapter intentionally **does not use bare mode**. The [official headless documentation](https://code.claude.com/docs/en/headless) and installed 2.1.91 help state that bare mode skips OAuth/keychain authentication and requires an API key. Instead Formixel preserves subscription credentials, removes Anthropic/OpenAI API credentials and third-party billing toggles from the child environment, and checks native authentication for a subscription before generation. Missing authentication fails with a login diagnostic. Intentional API billing uses the explicit anthropic provider. Administrator-managed policy remains effective.

Successful JSON result text and actual usage are extracted. Error, incomplete, multi-turn, permission-denied and server-tool-use envelopes fail. Missing counters are not guessed. Authentication is separate from generation: a failed sign-in check makes zero inference calls.

## Optional APIs

OpenAI uses the official Responses endpoint, OPENAI_API_KEY, explicit model, instructions/input, max_output_tokens:8192 and store:false; completed output_text is extracted. See the [official text guide](https://developers.openai.com/api/docs/guides/text). Anthropic uses the official Messages endpoint, ANTHROPIC_API_KEY, API version 2023-06-01, explicit model/system/user messages and max_tokens:8192; end_turn text is extracted. See the [official Messages reference](https://platform.claude.com/docs/en/api/messages/create). Model access is account-specific. Tests and doctor make no live paid API request.

## Usage, cache and testing

Usage reports input/output totals and nullable cached-input/reasoning counts. Codex events, Claude JSON results and both APIs can supply them. Missing/malformed required counts return null, not zero. Anthropic/Claude input is the sum of reported uncached, cache-read and cache-creation buckets; cached input is the read bucket, following [documented accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Token counts are not an account bill.

Doctor reads native version/auth status or API key presence without generating or printing credentials/account bodies. Codex checks allow five seconds; Claude startup/auth checks allow fifteen. Authentication does not prove model access or output quality.

Legacy generate/run opt-in caches still store only validated source under fingerprints. Cache hits validate locally and make zero provider calls; corrupt entries fail without a retry. Programmatic ProviderTransport injection is a trusted offline test hook, never a task-file transport override. See [provider testing](PROVIDER_TESTING.md) for actual evidence and remaining account gates.

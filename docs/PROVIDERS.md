# Provider contracts

`Provider.generate({prompt,model?,timeoutMs?}) -> Promise<string>` returns untrusted FXL. CLI parses/validates it before writing. Providers do not compile models and never select another provider on error. Default is `codex`; select `claude-code`, `openai`, or `anthropic` explicitly.

CLI authentication is managed by the separately installed provider. Check `codex --version` / `claude --version` and log in outside Formixel. Use native executables on Windows; Formixel intentionally does not use a command shell to execute npm `.cmd` shims. Optional `--model` is forwarded as a single argument, with leading flag-like identifiers rejected. Prompt maximum is 32,000 bytes. Timeout defaults to 120 seconds, allowed range 100..600000 ms. Output maximum is 2,000,000 bytes.

Codex flags follow [official non-interactive documentation](https://developers.openai.com/codex/noninteractive). Current strict invocation includes `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--sandbox read-only`, disabled `shell_tool`/`unified_exec`/`hooks`/`plugins`/`apps`/`multi_agent`, and `web_search="disabled"`. stdout is the final text. Missing flags are fatal; there is no downgrade path.

Claude Code flags follow [official CLI reference](https://code.claude.com/docs/en/cli-reference). Bare mode avoids auto-discovered customizations; `--tools ""` removes built-in tools, `--disallowedTools "mcp__*"` denies MCP, strict empty MCP configuration avoids connector discovery, `dontAsk` denies requests needing permission, `--setting-sources ""` skips user/project/local settings. These flags need a modern native CLI. Actual Claude Code authentication and generation remain a manual compatibility gate.

OpenAI uses `POST https://api.openai.com/v1/responses`, `OPENAI_API_KEY`, explicit model, `instructions`, `input`, `max_output_tokens`, and `store:false`; completed `output_text` content is extracted. See [official text generation guide](https://developers.openai.com/api/docs/guides/text). Anthropic uses `POST https://api.anthropic.com/v1/messages`, `ANTHROPIC_API_KEY`, API version `2023-06-01`, explicit model, system grammar, user message and `max_tokens`; `end_turn` text content is extracted. See [official Messages reference](https://platform.claude.com/docs/en/api/messages/create). Model availability and token limits are account-specific. No paid API requests are part of tests.

## Task file bridge

```json
{ "version": 1, "prompt": "A small stone golem", "provider": "codex" }
```

Optional fields: `model`, `timeoutMs`. No paths or executable flags in the task. Use `formixel run formixel.task.json -o result.fxl`; compile with `formixel build result.fxl -o result.bbmodel`. Output is supplied by the user to the CLI, not trusted from the task. API tasks need `model` set explicitly. The plugin provides a model field and requires it for API tasks.

## Testing and limits

Fake child processes verify stdin handling, output budget, nonzero exit and timeout. Mocked HTTP verifies envelopes and endpoint/request shapes. This proves transport logic, not that every CLI version/account will authenticate or emit valid FXL. Keep live generation checks separate, record installed versions and inspect tool availability before claiming compatibility. No retry/repair loop is implemented yet; invalid output fails with a local diagnostic and leaves outputs untouched.

## Doctor

formixel doctor [provider] checks native version/auth status or API environment-key presence. It makes no generation request and never prints credentials or account response bodies. Native checks time out after five seconds each. An installed/authenticated result does not prove model access or grammar quality; run an intentional generation smoke test. Codex 0.160.0 flags were locally reviewed. Claude Code requires the documented bare/tool restriction flags; incompatible versions fail without weaker fallback.

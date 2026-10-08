#!/usr/bin/env node
import { parseFXL, inspect, exportBBModel, LIMITS } from '@formixel/core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const protocol = '2025-06-18';
const toolNames = ['formixel_validate', 'formixel_inspect', 'formixel_build'] as const;
export function handle(message: unknown): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  const m = message as Record<string, any>;
  if (
    m.jsonrpc !== '2.0' ||
    typeof m.method !== 'string' ||
    (m.id !== undefined && typeof m.id !== 'number' && typeof m.id !== 'string')
  )
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  if (m.id === undefined) return undefined;
  const result = (value: unknown) => ({ jsonrpc: '2.0', id: m.id, result: value });
  const error = (code: number, text: string) => ({
    jsonrpc: '2.0',
    id: m.id,
    error: { code, message: text },
  });
  if (m.method === 'initialize')
    return result({
      protocolVersion: protocol,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Formixel', version: '1.3.0' },
    });
  if (m.method === 'ping') return result({});
  if (m.method === 'tools/list')
    return result({
      tools: toolNames.map((name) => ({
        name,
        description: `${name.replace('formixel_', '')} a bounded FXL document locally`,
        inputSchema: {
          type: 'object',
          properties: { source: { type: 'string', maxLength: LIMITS.bytes } },
          required: ['source'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
    });
  if (m.method === 'tools/call') {
    if (!toolNames.includes(m.params?.name)) return error(-32602, 'Unknown tool');
    if (
      typeof m.params?.arguments?.source !== 'string' ||
      Object.keys(m.params.arguments).some((k) => k !== 'source')
    )
      return error(-32602, 'Expected source argument only');
    try {
      const model = parseFXL(m.params.arguments.source);
      const value =
        m.params.name === 'formixel_build'
          ? exportBBModel(model)
          : m.params.name === 'formixel_inspect'
            ? inspect(model)
            : { valid: true, diagnostics: [] };
      return result({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
    } catch (e) {
      return result({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
    }
  }
  return error(-32601, 'Method not found');
}
export function serve(): void {
  let buffer = Buffer.alloc(0);
  const send = (value: unknown) => {
    if (value !== undefined) process.stdout.write(JSON.stringify(value) + '\n');
  };
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    let newline: number;
    while ((newline = buffer.indexOf(10)) >= 0) {
      if (newline > LIMITS.bytes + 4096) {
        process.stderr.write('Formixel MCP message budget exceeded\n');
        process.exitCode = 1;
        process.stdin.destroy();
        return;
      }
      const line = buffer.subarray(0, newline).toString('utf8');
      buffer = buffer.subarray(newline + 1);
      try {
        send(handle(JSON.parse(line)));
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
    }
    if (buffer.length > LIMITS.bytes + 4096) {
      process.stderr.write('Formixel MCP message budget exceeded\n');
      process.exitCode = 1;
      process.stdin.destroy();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) serve();

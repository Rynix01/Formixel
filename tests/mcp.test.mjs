import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { handle } from '../packages/mcp/dist/index.js';
const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', method, params, id });
test('MCP initialize and compact local tools', () => {
  assert.equal(handle(rpc('initialize')).result.serverInfo.name, 'Formixel');
  assert.equal(handle(rpc('tools/list')).result.tools.length, 3);
  const r = handle(
    rpc('tools/call', {
      name: 'formixel_build',
      arguments: { source: 'model x cube a [0,0,0] [1,1,1]' },
    }),
  );
  assert.equal(JSON.parse(r.result.content[0].text).elements.length, 1);
  assert.equal(
    handle(rpc('tools/call', { name: 'formixel_validate', arguments: { source: 'evil()' } })).result
      .isError,
    true,
  );
  assert.equal(
    handle(rpc('tools/call', { name: 'formixel_build', arguments: { path: '/etc/passwd' } })).error
      .code,
    -32602,
  );
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
});
test('stdio transport emits only JSON RPC and handles malformed input', () => {
  const r = spawnSync(process.execPath, ['packages/mcp/dist/index.js'], {
    input:
      JSON.stringify(rpc('initialize')) + '\nnope\n' + JSON.stringify(rpc('ping', {}, 2)) + '\n',
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const messages = r.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(messages.length, 3);
  assert.equal(messages[1].error.code, -32700);
  assert.equal(messages[2].id, 2);
});

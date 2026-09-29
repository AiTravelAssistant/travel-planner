import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/mcp.js';

function request(body, method = 'POST') {
  let status = 200;
  let payload;
  handler({ method, body, headers: { accept: 'application/json, text/event-stream' } }, {
    setHeader() {}, status(code) { status = code; return this; },
    json(value) { payload = value; return this; }, end() { return this; }
  });
  return { status, payload };
}

test('MCP handshake, discovery, and search return catalog records', () => {
  const init = request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.payload.result.protocolVersion, '2025-06-18');
  assert.equal(request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).payload.result.tools[0].name, 'searchJapanLocalResources');
  const call = request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'searchJapanLocalResources', arguments: { municipality: '金泽', category: 'craft', limit: 10 }
  } });
  assert.equal(call.status, 200);
  assert.equal(call.payload.result.structuredContent.total, 4);
  assert.equal(call.payload.result.structuredContent.results[0].id, 'JP-ISH-KNZ-001');
});

test('invalid arguments and methods fail safely', () => {
  const base = { jsonrpc: '2.0', id: 4, method: 'tools/call' };
  assert.equal(request({ ...base, params: { name: 'searchJapanLocalResources', arguments: { limit: 99 } } }).payload.error.code, -32602);
  assert.equal(request(base, 'GET').status, 405);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mcp from '../api/mcp.js';
import deepseek from '../api/deepseek.js';
import hotels from '../api/rakuten-hotels.js';
import products from '../api/rakuten-products.js';
import experiences from '../api/viator-experiences.js';

async function call(handler, req) {
  let status = 200, payload;
  await handler(req, {
    setHeader() {}, status(n) { status = n; return this; },
    json(value) { payload = value; return this; }, end() { return this; }
  });
  return { status, payload };
}
const rpc = params => ({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params } });

function configure(t) {
  for (const key of ['VIATOR_API_KEY', 'RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY', 'DEEPSEEK_API_KEY']) {
    const old = process.env[key]; process.env[key] = 'test-placeholder';
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}

test('MCP accepts valid dates and passes date range to Viator', async t => {
  configure(t);
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ products: { results: [] } }) };
  });
  const result = await call(mcp, rpc({ name: 'searchExperiences', arguments: {
    searchTerm: 'Kyoto tea ceremony', startDate: '2026-10-10', endDate: '2026-10-12'
  } }));
  assert.equal(result.payload.error, undefined);
  assert.deepEqual(body.productFiltering.dateRange, { from: '2026-10-10', to: '2026-10-12' });
  assert.equal(result.payload.result.structuredContent.start_date, '2026-10-10');
});

test('MCP rejects malformed dates before contacting provider', async t => {
  let fetched = false;
  t.mock.method(globalThis, 'fetch', async () => { fetched = true; });
  for (const startDate of ['10/10/2026', '2026-1-10', 'bad-date']) {
    const result = await call(mcp, rpc({ name: 'searchExperiences', arguments: { searchTerm: 'Kyoto', startDate } }));
    assert.equal(result.payload.error.code, -32602);
  }
  assert.equal(fetched, false);
});

test('MCP returns parameter errors for null, scalar, and array params', async () => {
  for (const params of [null, 'bad', 42, [], true]) {
    for (const method of ['tools/call', 'initialize', 'tools/list']) {
      const req = rpc(params); req.body.method = method;
      const result = await call(mcp, req);
      assert.equal(result.payload.error.code, -32602);
    }
  }
});

for (const [name, handler, req, timeout] of [
  ['DeepSeek', deepseek, { method: 'POST', headers: { origin: 'https://www.mengtrip.com' }, body: { messages: [{ role: 'user', content: 'Kyoto' }] } }, 60000],
  ['Rakuten hotels', hotels, { method: 'GET', url: '/api/rakuten-hotels?keyword=京都' }, 15000],
  ['Rakuten products', products, { method: 'GET', url: '/api/rakuten-products?keyword=抹茶' }, 15000],
  ['Viator', experiences, { method: 'GET', url: '/api/viator-experiences?searchTerm=Kyoto' }, 15000]
]) {
  test(`${name} bounds upstream time and returns 504 on timeout`, async t => {
    configure(t);
    t.mock.method(AbortSignal, 'timeout', ms => {
      assert.equal(ms, timeout);
      const controller = new AbortController();
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
      return controller.signal;
    });
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      assert.ok(opts.signal instanceof AbortSignal);
      opts.signal.throwIfAborted();
      assert.fail('Expected aborted request');
    });
    const result = await call(handler, req);
    assert.equal(result.status, 504);
    assert.match(result.payload.error, /timed out/);
  });
  test(`${name} returns 504 when timeout occurs while reading response body`, async t => {
    configure(t);
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => { throw new DOMException('Body read aborted', 'AbortError'); }
    }));
    const result = await call(handler, req);
    assert.equal(result.status, 504);
    assert.match(result.payload.error, /timed out/);
  });
}

test('OpenAPI exposes all four resource tools with matching limits', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../openapi.json', import.meta.url)));
  for (const [path, name, limit, maximum] of [
    ['/api/resources', 'searchJapanLocalResources', 5, 20],
    ['/api/rakuten-hotels', 'searchRakutenHotels', 5, 20],
    ['/api/viator-experiences', 'searchExperiences', 5, 10],
    ['/api/rakuten-products', 'searchRakutenProducts', 6, 20]
  ]) {
    const get = spec.paths[path].get;
    assert.equal(get.operationId, name);
    const schema = get.parameters.find(p => p.name === 'limit').schema;
    assert.equal(schema.default, limit); assert.equal(schema.maximum, maximum);
    assert.ok(get.responses['200'].content['application/json'].schema);
  }
  for (const path of ['/api/rakuten-hotels', '/api/rakuten-products', '/api/viator-experiences']) {
    assert.ok(spec.paths[path].get.responses['504']);
  }
});

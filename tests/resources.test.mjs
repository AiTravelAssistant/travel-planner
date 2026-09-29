import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/resources.js';

function request(url, method = 'GET') {
  let statusCode = 200;
  let payload;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(data) { payload = data; return this; },
    end() { return this; }
  };
  handler({ url, method }, res);
  return { statusCode, payload };
}

test('search by prefecture returns sourced static resources', () => {
  const { statusCode, payload } = request('/api/resources?prefecture=%E5%8D%83%E5%8F%B6%E5%8E%BF&limit=2');
  assert.equal(statusCode, 200);
  assert.equal(payload.data_type, 'static_demo');
  assert.equal(payload.returned, 2);
  assert.ok(payload.total >= 2);
  assert.ok(payload.results.every(item => item.prefecture === '千叶县' && item.source_url.startsWith('https://')));
});

test('keyword and category filters work together', () => {
  const { payload } = request('/api/resources?q=%E9%87%91%E7%AE%94&category=craft');
  assert.ok(payload.total >= 1);
  assert.ok(payload.results.every(item => item.category === 'craft'));
});

test('bad limits and duplicate parameters fail', () => {
  assert.equal(request('/api/resources?limit=21').statusCode, 400);
  assert.equal(request('/api/resources?q=a&q=b').statusCode, 400);
  assert.equal(request('/api/resources', 'POST').statusCode, 405);
});

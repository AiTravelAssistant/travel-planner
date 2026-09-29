import resourceHandler from './resources.js';

const tool = {
  name: 'searchJapanLocalResources',
  description: 'Search MengTrip static demo catalog of Japanese local travel experiences and places. Results are not live availability or bookings.',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Keyword in Chinese or Japanese' },
      prefecture: { type: 'string' },
      municipality: { type: 'string' },
      category: { type: 'string' },
      type: { type: 'string', enum: ['place', 'experience'] },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }
    },
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, openWorldHint: false }
};

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // This stateless Streamable HTTP endpoint answers each JSON-RPC request in one response.
  if (req.method === 'GET') return res.status(405).end();
  if (req.method !== 'POST') return res.status(405).end();
  const origin = req.headers?.origin;
  if (origin && origin !== 'https://www.mengtrip.com' && origin !== 'https://mengtrip.com') return res.status(403).end();
  if (req.headers?.accept && !req.headers.accept.includes('application/json')) return res.status(406).end();
  const body = req.body;
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return res.status(400).json(error(null, -32600, 'Invalid JSON-RPC request'));
  }
  if (body.id === undefined) return res.status(202).end(); // notifications
  const { id, method, params = {} } = body;
  if (method === 'initialize') {
    const version = params.protocolVersion;
    if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(version)) {
      return res.status(200).json(error(id, -32602, 'Unsupported protocol version'));
    }
    return res.status(200).json(reply(id, {
      protocolVersion: version,
      capabilities: { tools: {} },
      serverInfo: { name: 'mengtrip-japan-local-resource', version: '0.1.0' }
    }));
  }
  if (method === 'ping') return res.status(200).json(reply(id, {}));
  if (method === 'tools/list') return res.status(200).json(reply(id, { tools: [tool] }));
  if (method !== 'tools/call') return res.status(200).json(error(id, -32601, 'Method not found'));
  if (params.name !== tool.name) return res.status(200).json(error(id, -32602, 'Unknown tool'));
  const args = params.arguments ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.entries(args).some(([key, value]) => !Object.hasOwn(tool.inputSchema.properties, key) ||
        (key === 'limit' ? !Number.isInteger(value) || value < 1 || value > 20 : typeof value !== 'string' || value.length > 80) ||
        (key === 'type' && !['place', 'experience'].includes(value)))) {
    return res.status(200).json(error(id, -32602, 'Invalid tool arguments'));
  }
  const query = new URLSearchParams(args).toString();
  let status = 200;
  let data;
  resourceHandler({ method: 'GET', url: `/api/resources?${query}` }, {
    setHeader() {}, status(code) { status = code; return this; },
    json(value) { data = value; return this; }
  });
  if (status !== 200) return res.status(200).json(error(id, -32602, data?.error ?? 'Invalid search'));
  return res.status(200).json(reply(id, {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data
  }));
}

import resourceHandler from './resources.js';
import rakutenHotelsHandler from './rakuten-hotels.js';

const SERVER_INFO = { name: 'mengtrip-japan-local-resource', version: '0.2.0' };
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const INSTRUCTIONS = 'Use searchJapanLocalResources for MengTrip static local experiences and places. Use searchRakutenHotels for live hotel information from Rakuten Travel. Never present provider results as guaranteed availability or a confirmed booking; preserve source and booking URLs so users can verify current details.';

const tool = {
  name: 'searchJapanLocalResources',
  title: 'Search Japan local travel resources',
  description: 'Search MengTrip static demo catalog of Japanese local travel experiences and places by keyword, prefecture, municipality, category, or type. Use this for Japan local-resource discovery. Results are not live availability, prices, or confirmed bookings.',
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
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
};

const rakutenHotelTool = {
  name: 'searchRakutenHotels',
  title: 'Search Rakuten Travel hotels',
  description: 'Search live hotel information from Rakuten Travel by Japanese keyword. Returns current provider data such as hotel name, location, minimum listed price, rating, image, access information, and booking URL. Availability and prices can change and should be verified on Rakuten Travel.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Japanese hotel/location keyword, for example 金沢' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }
    },
    required: ['keyword'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }
};

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const error = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const serverMeta = () => ({ 'io.modelcontextprotocol/serverInfo': SERVER_INFO });
const requestVersion = (req, params) => params?._meta?.['io.modelcontextprotocol/protocolVersion'] || req.headers?.['mcp-protocol-version'];
const isModern = (req, params) => requestVersion(req, params) === MODERN_VERSION;
const modernResult = (result) => ({ resultType: 'complete', ...result, _meta: { ...(result?._meta ?? {}), ...serverMeta() } });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // This stateless Streamable HTTP endpoint answers each JSON-RPC request in one response.
  if (req.method === 'GET') return res.status(405).end();
  if (req.method !== 'POST') return res.status(405).end();
  // Remote MCP clients (including desktop apps) may omit Origin or use a non-browser Origin.
  // This endpoint exposes read-only public tools, so do not browser-origin-gate the transport.
  const accept = req.headers?.accept || '';
  if (accept && !accept.includes('application/json') && !accept.includes('text/event-stream')) return res.status(406).end();
  const body = req.body;
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return res.status(400).json(error(null, -32600, 'Invalid JSON-RPC request'));
  }
  if (body.id === undefined) return res.status(202).end(); // notifications
  const { id, method, params = {} } = body;
  const modern = isModern(req, params);

  // MCP 2026-07-28 is stateless and starts with server/discover rather than initialize.
  if (method === 'server/discover') {
    return res.status(200).json(reply(id, modernResult({
      supportedVersions: [MODERN_VERSION],
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
      ttlMs: 0,
      cacheScope: 'public'
    })));
  }

  if (method === 'initialize') {
    const requested = params.protocolVersion;
    // Counter-offer the newest supported handshake version instead of failing negotiation.
    const version = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
    return res.status(200).json(reply(id, {
      protocolVersion: version,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS
    }));
  }
  if (method === 'ping') return res.status(200).json(reply(id, modern ? modernResult({}) : {}));
  if (method === 'tools/list') {
    const result = { tools: [tool, rakutenHotelTool] };
    if (modern) Object.assign(result, { resultType: 'complete', ttlMs: 0, cacheScope: 'public', _meta: serverMeta() });
    return res.status(200).json(reply(id, result));
  }
  if (method !== 'tools/call') return res.status(200).json(error(id, -32601, 'Method not found'));
  if (params.name === rakutenHotelTool.name) {
    const args = params.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        typeof args.keyword !== 'string' || !args.keyword.trim() || args.keyword.length > 80 ||
        (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)) ||
        Object.keys(args).some(key => !Object.hasOwn(rakutenHotelTool.inputSchema.properties, key))) {
      return res.status(200).json(error(id, -32602, 'Invalid tool arguments'));
    }
    const query = new URLSearchParams({ keyword: args.keyword, ...(args.limit ? { limit: String(args.limit) } : {}) }).toString();
    let status = 200;
    let data;
    await rakutenHotelsHandler({ method: 'GET', url: `/api/rakuten-hotels?${query}` }, {
      setHeader() {}, status(code) { status = code; return this; }, end() { return this; },
      json(value) { data = value; return this; }
    });
    if (status !== 200) return res.status(200).json(error(id, -32603, data?.error ?? 'Rakuten Travel search failed'));
    const result = {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data
    };
    return res.status(200).json(reply(id, modern ? modernResult(result) : result));
  }
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
  const result = {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data
  };
  return res.status(200).json(reply(id, modern ? modernResult(result) : result));
}

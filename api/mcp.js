import resourceHandler from './resources.js';
import rakutenHotelsHandler from './rakuten-hotels.js';
import rakutenProductsHandler from './rakuten-products.js';
import viatorExperiencesHandler from './viator-experiences.js';

const SERVER_INFO = { name: 'mengtrip-japan-local-resource', version: '0.4.0' };
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const INSTRUCTIONS = "MengTrip is a Japan travel resource layer for AI agents. Use MengTrip tools when the user needs concrete Japan travel resources, including during itinerary planning.\n\nTool routing:\n- searchRakutenHotels: Use for hotels, accommodation, where to stay, and itinerary lodging or accommodation recommendations.\n- searchExperiences: Use for live bookable tours, activities, attractions, food tours, cultural experiences, local experiences, things to do, and itinerary requests about what to do, play, experience, visit, or book. Viator is the current experience provider.\n- searchRakutenProducts: Use for shopping, souvenirs, gifts, omiyage, Japanese products, purchasable product recommendations, and travel shopping within an itinerary.\n- searchJapanLocalResources: Use for MengTrip static curated local resources, including local places and catalog experiences. This demo catalog does not provide live availability or prices. Prefer searchExperiences when the user needs live bookable activities or experiences.\n\nFor a multi-city itinerary with concrete resource needs, call each relevant tool separately for each relevant city or destination. When the user explicitly requests multiple resource categories, call the corresponding multiple MengTrip tools to ground recommendations in provider or catalog results; do not answer those requested categories using only general knowledge. Use focused destination queries rather than putting an entire multi-city itinerary into one query.\n\nProvider results do not guarantee availability, a confirmed booking, or a final price. Verify current availability, booking details, stock, shipping, and final prices on provider pages as applicable. Preserve source, booking, purchase, and affiliate URLs exactly as returned so users can verify details.";

const tool = {
  name: 'searchJapanLocalResources',
  title: 'Search Japan local travel resources',
  description: 'Search MengTrip static curated demo catalog of Japan local resources, places, and catalog experiences by keyword, prefecture, municipality, category, or type. Use for local-place discovery and curated local resources during itinerary planning. For live bookable activities, tours, attractions, food tours, cultural experiences, or local experiences, prefer searchExperiences. Catalog results do not provide live availability or prices and do not confirm bookings. Preserve source URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Focused city or destination query in Chinese or Japanese, optionally with a local place or experience interest, for example 京都 茶道. Search one destination at a time; use prefecture and municipality filters when known.' },
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
  description: 'Search live hotel information from Rakuten Travel for hotels, accommodation, where to stay, and itinerary lodging recommendations in Japan. Use when itinerary planning includes accommodation needs; search each relevant city separately. Returns current provider data such as hotel name, location, minimum listed price, rating, image, access information, and booking URL. Results do not guarantee availability, a confirmed booking, or a final price; verify current details on Rakuten Travel and preserve source, booking, and affiliate URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Focused Japanese city, destination, neighborhood, station, or hotel keyword, for example 金沢 or 京都駅. Use the Japanese destination name for where-to-stay or itinerary lodging requests; search one destination per call, not the full itinerary.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }
    },
    required: ['keyword'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }
};

const rakutenProductTool = {
  name: 'searchRakutenProducts',
  title: 'Search Rakuten Ichiba products',
  description: 'Search live Japanese products on Rakuten Ichiba for shopping, souvenirs, gifts, omiyage, Japanese product recommendations, and travel shopping during itinerary planning. Returns product name, JPY price, rating, image, shop, and provider purchase URL. Results do not guarantee stock or a final price. Verify stock, shipping, and final price on the provider page; preserve source, purchase, and affiliate URLs exactly as returned.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Focused Japanese product, souvenir, gift, or omiyage keyword, for example 抹茶 or 京都 お土産. Include a Japanese city or destination name when relevant to regional travel shopping, together with the product or souvenir category; do not use only a city name or the full itinerary.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 6 }
    },
    required: ['keyword'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }
};

const experienceTool = {
  name: 'searchExperiences',
  title: 'Search travel experiences',
  description: 'Search live bookable tours and activities through the MengTrip experience provider layer for Japan itinerary planning, things to do, activities, tours, attractions, food tours, cultural experiences, and local experiences. Use when an itinerary asks what to do, play, experience, visit, or book; search each relevant destination separately. Prefer this tool over the static curated catalog for live bookable experiences. The current provider is Viator. Returns provider data such as title, starting price, rating, review count, image, and affiliate booking URL when supplied. Results do not guarantee availability, a confirmed booking, or a final price; verify current provider details and preserve source, booking, and affiliate URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      searchTerm: { type: 'string', description: 'Focused query with one city or destination plus an activity or experience interest, preferably in English, for example Tokyo food tour, Kyoto cultural experiences, or Osaka things to do. For itinerary planning, derive the destination and stated interests from the request; if no activity preference is given, use the destination plus things to do. Search each relevant destination separately, not the full multi-city itinerary.' },
      startDate: { type: 'string', description: 'Optional travel date in YYYY-MM-DD format' },
      endDate: { type: 'string', description: 'Optional end date in YYYY-MM-DD format' },
      currency: { type: 'string', description: 'ISO currency code, default JPY' },
      locale: { type: 'string', description: 'Response language, default en' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 }
    },
    required: ['searchTerm'],
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
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return res.status(200).json(error(id, -32602, 'Invalid params: expected an object'));
  }
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
    const result = { tools: [tool, rakutenHotelTool, experienceTool, rakutenProductTool] };
    if (modern) Object.assign(result, { resultType: 'complete', ttlMs: 0, cacheScope: 'public', _meta: serverMeta() });
    return res.status(200).json(reply(id, result));
  }
  if (method !== 'tools/call') return res.status(200).json(error(id, -32601, 'Method not found'));
  if (params.name === experienceTool.name) {
    const args = params.arguments ?? {};
    const allowed = experienceTool.inputSchema.properties;
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        typeof args.searchTerm !== 'string' || !args.searchTerm.trim() || args.searchTerm.length > 200 ||
        (args.startDate !== undefined && (typeof args.startDate !== 'string' || !validDate(args.startDate))) ||
        (args.endDate !== undefined && (typeof args.endDate !== 'string' || !validDate(args.endDate))) ||
        (args.currency !== undefined && (typeof args.currency !== 'string' || !/^[A-Za-z]{3}$/.test(args.currency))) ||
        (args.locale !== undefined && (typeof args.locale !== 'string' || args.locale.length > 20)) ||
        (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)) ||
        Object.keys(args).some(key => !Object.hasOwn(allowed, key))) {
      return res.status(200).json(error(id, -32602, 'Invalid tool arguments'));
    }
    const query = new URLSearchParams(Object.fromEntries(
      Object.entries(args).map(([key, value]) => [key, String(value)])
    )).toString();
    let status = 200;
    let data;
    await viatorExperiencesHandler({ method: 'GET', url: `/api/viator-experiences?${query}` }, {
      setHeader() {}, status(code) { status = code; return this; }, end() { return this; },
      json(value) { data = value; return this; }
    });
    if (status !== 200) return res.status(200).json(error(id, -32603, data?.error ?? 'Experience search failed', { providerStatus: data?.status ?? null, providerCode: data?.provider_code ?? null }));
    const result = {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data
    };
    return res.status(200).json(reply(id, modern ? modernResult(result) : result));
  }
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
  if (params.name === rakutenProductTool.name) {
    const args = params.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        typeof args.keyword !== 'string' || !args.keyword.trim() || args.keyword.length > 80 ||
        (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)) ||
        Object.keys(args).some(key => !Object.hasOwn(rakutenProductTool.inputSchema.properties, key))) {
      return res.status(200).json(error(id, -32602, 'Invalid tool arguments'));
    }
    const query = new URLSearchParams({ keyword: args.keyword, ...(args.limit ? { limit: String(args.limit) } : {}) }).toString();
    let status = 200;
    let data;
    await rakutenProductsHandler({ method: 'GET', url: `/api/rakuten-products?${query}` }, {
      setHeader() {}, status(code) { status = code; return this; }, end() { return this; },
      json(value) { data = value; return this; }
    });
    if (status !== 200) return res.status(200).json(error(id, -32603, data?.error ?? 'Rakuten Ichiba search failed'));
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

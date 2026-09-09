// api/deepseek.js

const ALLOWED_ORIGINS = new Set([
  'https://aitravelassistant.github.io',
  'http://localhost:3000',
  'http://localhost:5173'
]);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_MESSAGE_CHARS = 12000;
const MAX_TEMPERATURE = 1;
const MAX_TOKENS = 4096;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const rateLimitStore = globalThis.__deepseekRateLimitStore || new Map();
globalThis.__deepseekRateLimitStore = rateLimitStore;

function getClientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(req) {
  const now = Date.now();
  const key = getClientKey(req);
  const previous = rateLimitStore.get(key);

  if (!previous || now - previous.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    return false;
  }

  if (previous.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  previous.count += 1;
  return false;
}

function getAllowedOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : false;
}

function applyCors(req, res) {
  const origin = getAllowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  return origin;
}

function getRequestBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return null;
  }
  return req.body;
}

function validateRequestBody(body) {
  if (!body) return 'Invalid JSON body';

  if (body.model !== undefined && body.model !== 'deepseek-chat') {
    return 'Unsupported model';
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return 'Invalid messages';
  }

  let totalChars = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== 'object') return 'Invalid message';
    if (!['system', 'user'].includes(message.role)) return 'Unsupported message role';
    if (typeof message.content !== 'string' || message.content.length === 0 || message.content.length > MAX_MESSAGE_CHARS) {
      return 'Message content is too long or invalid';
    }
    totalChars += message.content.length;
  }

  if (totalChars > MAX_TOTAL_MESSAGE_CHARS) return 'Messages are too long';

  if (body.temperature !== undefined &&
      (typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > MAX_TEMPERATURE)) {
    return 'Invalid temperature';
  }

  if (body.max_tokens !== undefined &&
      (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > MAX_TOKENS)) {
    return 'Invalid max_tokens';
  }

  if (body.userInput !== undefined &&
      (typeof body.userInput !== 'string' || body.userInput.length > MAX_MESSAGE_CHARS)) {
    return 'Invalid userInput';
  }

  const allowedKeys = new Set(['model', 'messages', 'temperature', 'max_tokens', 'userInput']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) return `Unsupported parameter: ${key}`;
  }

  return null;
}

function createRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logTravelRequest(requestId, status, userInput, extra = {}) {
  console.log('[travel-request]', JSON.stringify({
    time: new Date().toISOString(),
    requestId,
    status,
    userInput,
    ...extra
  }));
}

export default async function handler(req, res) {
  const origin = applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (origin === false) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    return res.status(204).end();
  }

  if (origin === false) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  // Origin filtering reduces accidental/browser abuse; it is not authentication.
  // Non-browser clients can forge Origin. Require it even for local development.
  if (!origin) {
    return res.status(403).json({ error: 'Origin required' });
  }

  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error('DEEPSEEK_API_KEY is not configured');
    return res.status(500).json({ error: 'AI service is not configured' });
  }

  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' });
  }

  if (isRateLimited(req)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests' });
  }

  const body = getRequestBody(req);
  const validationError = validateRequestBody(body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const requestId = createRequestId();
  const userInput = body.userInput === undefined ? '' : body.userInput;
  logTravelRequest(requestId, 'started', userInput);

  const upstreamBody = {
    model: 'deepseek-chat',
    messages: body.messages,
    temperature: body.temperature === undefined ? 0.7 : body.temperature,
    max_tokens: body.max_tokens === undefined ? 4096 : body.max_tokens
  };

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(upstreamBody)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      logTravelRequest(requestId, 'failed', '', { upstreamStatus: response.status });
      console.error('DeepSeek API error:', response.status);
      return res.status(response.status >= 400 && response.status < 600 ? response.status : 502).json({
        error: 'AI service request failed'
      });
    }

    logTravelRequest(requestId, 'success', '');
    return res.status(200).json(data);
  } catch (err) {
    logTravelRequest(requestId, 'failed', '', { error: err?.name || 'unknown' });
    console.error('代理出错:', err);
    return res.status(502).json({ error: 'AI service unavailable' });
  }
}

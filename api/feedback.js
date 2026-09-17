const ALLOWED_ORIGINS = new Set([
  'https://aitravelassistant.github.io',
  'http://localhost:3000',
  'http://localhost:5173'
]);

const MAX_BODY_BYTES = 4 * 1024;
const MAX_COMMENT_CHARS = 500;
const MAX_FEATURES = 6;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const HELP_OPTIONS = new Set(['very_helpful', 'average', 'not_helpful']);
const PAYMENT_OPTIONS = new Set(['free_only', 'cny_3_5', 'cny_6_10', 'cny_10_20', 'subscription']);
const FEATURE_OPTIONS = new Set(['transport', 'restaurant', 'hotel', 'map', 'budget', 'other']);

const rateLimitStore = globalThis.__feedbackRateLimitStore || new Map();
globalThis.__feedbackRateLimitStore = rateLimitStore;

function getClientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
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
  if (previous.count >= RATE_LIMIT_MAX_REQUESTS) return true;
  previous.count += 1;
  return false;
}

function applyCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  }
  return false;
}

function validateFeedback(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid JSON body';
  if (!HELP_OPTIONS.has(body.helpfulness)) return 'Invalid helpfulness';
  if (!PAYMENT_OPTIONS.has(body.payment)) return 'Invalid payment';
  if (!Array.isArray(body.features) || body.features.length > MAX_FEATURES) return 'Invalid features';
  if (new Set(body.features).size !== body.features.length || body.features.some(item => !FEATURE_OPTIONS.has(item))) return 'Invalid features';
  if (typeof body.comment !== 'string' || body.comment.length > MAX_COMMENT_CHARS) return 'Invalid comment';
  const allowedKeys = new Set(['helpfulness', 'payment', 'features', 'comment']);
  if (Object.keys(body).some(key => !allowedKeys.has(key))) return 'Unsupported parameter';
  return null;
}

function createFeedbackId() {
  return `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function handler(req, res) {
  const originAllowed = applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return originAllowed ? res.status(204).end() : res.status(403).json({ error: 'Origin not allowed' });
  }
  if (!originAllowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST requests allowed' });

  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (isRateLimited(req)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests' });
  }

  const validationError = validateFeedback(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const record = {
    time: new Date().toISOString(),
    feedbackId: createFeedbackId(),
    helpfulness: req.body.helpfulness,
    payment: req.body.payment,
    features: req.body.features,
    comment: req.body.comment.trim()
  };

  // Structured Vercel log: no name, email, phone number or raw IP is stored.
  console.log('[user-feedback]', JSON.stringify(record));
  return res.status(201).json({ ok: true, feedbackId: record.feedbackId });
}

const ALLOWED_PARAMS = new Set(['searchTerm', 'startDate', 'endDate', 'currency', 'locale', 'limit']);

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function leadImage(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const first = images[0];
  if (!first) return null;
  const variants = Array.isArray(first.variants) ? first.variants : [];
  return variants.find(v => v?.width >= 480)?.url || variants.at(-1)?.url || null;
}

function normalizeProduct(product) {
  return {
    id: product?.productCode ?? null,
    name: product?.title ?? null,
    description: product?.description ?? null,
    price_from: product?.pricing?.summary?.fromPrice ?? null,
    currency: product?.pricing?.currency ?? null,
    rating: product?.reviews?.combinedAverageRating ?? null,
    review_count: product?.reviews?.totalReviews ?? null,
    duration: product?.duration ?? null,
    image: leadImage(product),
    free_cancellation: product?.flags?.includes?.('FREE_CANCELLATION') ?? null,
    booking_url: product?.productUrl ?? null,
    source: 'Viator'
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Only GET requests allowed' });

  const url = new URL(req.url, 'https://www.mengtrip.com');
  if ([...url.searchParams.keys()].some(key => !ALLOWED_PARAMS.has(key))) {
    return res.status(400).json({ error: 'Unsupported parameter' });
  }

  const searchTerm = (url.searchParams.get('searchTerm') || '').trim();
  if (!searchTerm || searchTerm.length > 200) {
    return res.status(400).json({ error: 'searchTerm is required and must be at most 200 characters' });
  }

  const startDate = (url.searchParams.get('startDate') || '').trim();
  const endDate = (url.searchParams.get('endDate') || '').trim();
  if (startDate && !isDate(startDate)) return res.status(400).json({ error: 'startDate must be YYYY-MM-DD' });
  if (endDate && !isDate(endDate)) return res.status(400).json({ error: 'endDate must be YYYY-MM-DD' });

  const rawLimit = url.searchParams.get('limit');
  if (rawLimit !== null && !/^[1-9][0-9]?$/.test(rawLimit)) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 10' });
  }
  const limit = rawLimit === null ? 5 : Math.min(Number(rawLimit), 10);
  const currency = (url.searchParams.get('currency') || 'JPY').toUpperCase();
  const locale = (url.searchParams.get('locale') || 'en').trim();

  const apiKey = process.env.VIATOR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Viator API credential is not configured' });

  const baseUrl = process.env.VIATOR_API_BASE_URL || 'https://api.viator.com/partner';

  const requestBody = {
    searchTerm,
    searchTypes: [{
      searchType: 'PRODUCTS',
      pagination: { start: 1, count: limit }
    }],
    currency
  };

  if (startDate) {
    requestBody.productFiltering = {
      dateRange: { from: startDate, to: endDate || startDate }
    };
  }

  try {
    const response = await fetch(`${baseUrl}/search/freetext?campaign-value=mengtrip`, {
      method: 'POST',
      headers: {
        'exp-api-key': apiKey,
        'Accept': 'application/json;version=2.0',
        'Content-Type': 'application/json',
        'Accept-Language': locale
      },
      body: JSON.stringify(requestBody)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('Viator API error', response.status, body?.code || body?.message || 'unknown');
      return res.status(502).json({
        error: 'Viator API request failed',
        status: response.status,
        provider_code: body?.code ?? null
      });
    }

    const products = Array.isArray(body?.products?.results)
      ? body.products.results
      : Array.isArray(body?.products)
        ? body.products
        : [];

    const results = products.slice(0, limit).map(normalizeProduct);

    return res.status(200).json({
      provider: 'Viator',
      data_type: 'live_api',
      search_term: searchTerm,
      start_date: startDate || null,
      end_date: endDate || startDate || null,
      currency,
      returned: results.length,
      results,
      notice: 'Experience information is provided by Viator. Prices and availability can change. booking_url is the provider affiliate link when supplied by Viator.'
    });
  } catch (err) {
    console.error('Viator API request failed', err?.message || err);
    return res.status(502).json({ error: 'Unable to reach Viator API' });
  }
}

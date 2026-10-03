const ALLOWED_PARAMS = new Set(['keyword', 'limit']);

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

  const keyword = (url.searchParams.get('keyword') || '').trim();
  if (!keyword || keyword.length > 80) {
    return res.status(400).json({ error: 'keyword is required and must be at most 80 characters' });
  }

  const rawLimit = url.searchParams.get('limit');
  if (rawLimit !== null && !/^[1-9][0-9]?$/.test(rawLimit)) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 20' });
  }
  const limit = rawLimit === null ? 6 : Math.min(Number(rawLimit), 20);

  const applicationId = process.env.RAKUTEN_APPLICATION_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  if (!applicationId || !accessKey) {
    return res.status(500).json({ error: 'Rakuten Ichiba API credentials are not configured' });
  }

  const params = new URLSearchParams({
    format: 'json',
    applicationId,
    accessKey,
    keyword,
    hits: String(limit)
  });

  // Let Rakuten generate the affiliate URLs; preserve its returned URLs verbatim.
  const affiliateId = (process.env.RAKUTEN_AFFILIATE_ID || '').trim();
  if (affiliateId) params.set('affiliateId', affiliateId);

  try {
    const response = await fetch(
      `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?${params.toString()}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/json',
          Referer: 'https://www.mengtrip.com/',
          Origin: 'https://www.mengtrip.com'
        }
      }
    );

    const body = await response.json().catch(err => {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw err;
      return null;
    });
    if (!response.ok) {
      console.error('Rakuten Ichiba API error', response.status);
      return res.status(502).json({ error: 'Rakuten Ichiba API request failed', status: response.status });
    }

    if (!body || !Array.isArray(body.Items)) {
      return res.status(502).json({ error: 'Invalid Rakuten Ichiba response' });
    }
    const results = body.Items.map(entry => entry.Item ?? entry).map(item => ({
      id: item.itemCode,
      name: item.itemName,
      price_jpy: item.itemPrice ?? null,
      currency: 'JPY',
      rating: item.reviewAverage ?? null,
      review_count: item.reviewCount ?? null,
      description: item.itemCaption ?? null,
      image: item.mediumImageUrls?.[0]?.imageUrl ?? item.smallImageUrls?.[0]?.imageUrl ?? null,
      shop_name: item.shopName ?? null,
      purchase_url: item.affiliateUrl || item.itemUrl || null,
      affiliate_url: item.affiliateUrl || null,
      item_url: item.itemUrl || null,
      source: 'Rakuten Ichiba'
    }));
    return res.status(200).json({
      provider: 'Rakuten Ichiba', data_type: 'live_api', keyword,
      total: body.count ?? results.length, returned: results.length, results,
      notice: 'Prices and stock can change. Verify product details and shipping on Rakuten Ichiba. Affiliate links do not guarantee commission.'
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream service timed out; please retry later' });
    }
    return res.status(502).json({ error: 'Unable to reach Rakuten Ichiba API' });
  }
}

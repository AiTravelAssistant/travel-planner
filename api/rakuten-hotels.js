const ALLOWED_PARAMS = new Set(['keyword', 'limit']);

function firstBasicInfo(hotel) {
  const entries = Array.isArray(hotel?.hotel) ? hotel.hotel : [];
  for (const entry of entries) {
    if (entry?.hotelBasicInfo) return entry.hotelBasicInfo;
  }
  return null;
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

  const keyword = (url.searchParams.get('keyword') || '').trim();
  if (!keyword || keyword.length > 80) {
    return res.status(400).json({ error: 'keyword is required and must be at most 80 characters' });
  }

  const rawLimit = url.searchParams.get('limit');
  if (rawLimit !== null && !/^[1-9][0-9]?$/.test(rawLimit)) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 20' });
  }
  const limit = rawLimit === null ? 5 : Math.min(Number(rawLimit), 20);

  const applicationId = process.env.RAKUTEN_APPLICATION_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  if (!applicationId || !accessKey) {
    return res.status(500).json({ error: 'Rakuten Travel API credentials are not configured' });
  }

  const params = new URLSearchParams({
    format: 'json',
    applicationId,
    accessKey,
    keyword,
    hits: String(limit)
  });

  try {
    const response = await fetch(
      `https://openapi.rakuten.co.jp/engine/api/Travel/KeywordHotelSearch/20260731?${params.toString()}`,
      { headers: { Accept: 'application/json' } }
    );

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('Rakuten Travel API error', response.status, body?.error || body?.error_description || 'unknown');
      return res.status(502).json({ error: 'Rakuten Travel API request failed', status: response.status });
    }

    const hotels = Array.isArray(body?.hotels) ? body.hotels : [];
    const results = hotels.map(firstBasicInfo).filter(Boolean).map(info => ({
      id: info.hotelNo,
      name: info.hotelName,
      area: [info.address1, info.address2].filter(Boolean).join(''),
      price_from_jpy: info.hotelMinCharge ?? null,
      rating: info.reviewAverage ?? null,
      review_count: info.reviewCount ?? null,
      description: info.hotelSpecial ?? null,
      access: info.access ?? null,
      image: info.hotelImageUrl ?? info.hotelThumbnailUrl ?? null,
      booking_url: info.hotelInformationUrl ?? null,
      source: 'Rakuten Travel'
    }));

    return res.status(200).json({
      provider: 'Rakuten Travel',
      data_type: 'live_api',
      keyword,
      total: body?.pagingInfo?.recordCount ?? results.length,
      returned: results.length,
      results,
      notice: 'Hotel information is provided by Rakuten Travel. Prices and availability can change; verify current details on the booking page.'
    });
  } catch (err) {
    console.error('Rakuten Travel API request failed', err?.message || err);
    return res.status(502).json({ error: 'Unable to reach Rakuten Travel API' });
  }
}

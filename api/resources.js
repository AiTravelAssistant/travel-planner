import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../data/japan-local-resources.demo.json', import.meta.url), 'utf8'));
const fields = ['q', 'prefecture', 'municipality', 'category', 'type', 'limit'];
const normalize = value => value.normalize('NFKC').toLocaleLowerCase().trim();

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Only GET requests allowed' });

  const url = new URL(req.url, 'https://www.mengtrip.com');
  const params = url.searchParams;
  if ([...params.keys()].some(key => !fields.includes(key)) || fields.some(key => params.getAll(key).length > 1)) {
    return res.status(400).json({ error: 'Unsupported or repeated parameter' });
  }
  for (const key of fields.filter(key => key !== 'limit')) {
    if ((params.get(key) || '').length > 80) return res.status(400).json({ error: 'Filter is too long' });
  }
  const rawLimit = params.get('limit');
  if (rawLimit !== null && !/^[1-9][0-9]?$/.test(rawLimit)) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 20' });
  }
  const limit = rawLimit === null ? 5 : Number(rawLimit);
  if (limit > 20) return res.status(400).json({ error: 'limit must be at most 20' });

  let results = catalog.resources;
  for (const key of ['prefecture', 'municipality', 'category', 'type']) {
    const value = params.get(key);
    if (value) results = results.filter(item => normalize(item[key]).includes(normalize(value)));
  }
  const q = params.get('q');
  if (q) results = results.filter(item =>
    [item.name_zh, item.name_ja, item.summary_zh, item.prefecture, item.municipality, item.category]
      .filter(Boolean).some(value => normalize(value).includes(normalize(q)))
  );

  return res.status(200).json({
    dataset: catalog.dataset,
    version: catalog.version,
    data_type: 'static_demo',
    total: results.length,
    returned: Math.min(results.length, limit),
    results: results.slice(0, limit),
    notice: catalog.notice,
    source_compiled_at: catalog.source_compiled_at
  });
}

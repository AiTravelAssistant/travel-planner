import fs from 'node:fs';

const trips = JSON.parse(fs.readFileSync('data/trips.json', 'utf8'));
const site = 'https://www.mengtrip.com';
const resourceSite = 'https://mengtrip-japan-local-resource.king-meng.chatgpt.site/';

const esc = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cards = trips.map(t => {
  const local = t.anchors || {};
  const hotel = local.hotels ? t.url + local.hotels : resourceSite + '#hotel-section';
  const exp = local.experiences ? t.url + local.experiences : resourceSite + '#experience-section';
  const prod = local.products ? t.url + local.products : resourceSite + '#product-section';
  return `<article class="resource-card"><p class="resource-label">${esc(t.label)}</p><h3><a href="${esc(t.url)}">${esc(t.title)}</a></h3>${t.highlight ? `<p><strong>${esc(t.highlight)}</strong></p>` : ''}<p>${esc(t.description)}</p><a class="resource-demo" href="${esc(t.url)}">查看完整行程</a></article>`;
}).join('\n');

let index = fs.readFileSync('index.html','utf8');
const start = '<!-- FEATURED_TRIPS_START -->';
const end = '<!-- FEATURED_TRIPS_END -->';
if (!index.includes(start) || !index.includes(end)) throw new Error('Featured trip markers missing in index.html');
index = index.replace(new RegExp(start + '[\\s\\S]*?' + end), `${start}\n${cards}\n${end}`);
fs.writeFileSync('index.html', index);

const urls = [
  {url:'/', lastmod: trips.reduce((m,t)=>t.lastmod > m ? t.lastmod : m, '2026-10-03')},
  ...trips.map(t => ({url:t.url, lastmod:t.lastmod}))
];
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(x => `  <url><loc>${site}${x.url}</loc><lastmod>${x.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync('sitemap.xml', xml);
console.log(`Generated ${trips.length} featured trip cards and sitemap entries.`);

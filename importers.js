const cheerio = require('cheerio');
const { XMLParser } = require('fast-xml-parser');
const { q } = require('./db');
const { parseCSV } = require('./csv');
const { importRecords } = require('./jobs');
const U = require('./util');

const UA = 'Mozilla/5.0 (compatible; PlacewellBot/1.0; +job-aggregator)';

async function fetchText(url, { timeout = 20000, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http:// or https://');
  assertPublicHost(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Response too large');
    return { text: buf.toString('utf8'), type: res.headers.get('content-type') || '', finalUrl: res.url };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out fetching ' + url);
    throw e;
  } finally { clearTimeout(t); }
}

// Block fetches to private/internal addresses (the admin enters URLs; keep SSRF out anyway).
function assertPublicHost(url) {
  const h = new URL(url).hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || h.startsWith('[')) {
    throw new Error('That address is not allowed');
  }
}

/* ---------- schema.org JobPosting (what Google-for-Jobs sites embed) ---------- */
function jobPostingToRecord(p, pageUrl) {
  const loc = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation;
  const addr = loc?.address || {};
  const city = addr.addressLocality || '';
  const state = addr.addressRegion || '';
  const bs = p.baseSalary?.value || p.baseSalary || {};
  const unit = String(bs.unitText || '').toUpperCase();
  let min = bs.minValue ?? bs.value ?? null, max = bs.maxValue ?? null;
  if (unit === 'HOUR') { min = null; max = null; }
  return {
    title: p.title || p.name,
    org_name: p.hiringOrganization?.name || (typeof p.hiringOrganization === 'string' ? p.hiringOrganization : ''),
    city, state,
    location: [city, state].filter(Boolean).join(', '),
    work_mode: p.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '',
    salary_min: min, salary_max: max,
    description: p.description || '',
    apply_url: (typeof p.url === 'string' && p.url) || (typeof p.directApply === 'string' ? p.directApply : '') || pageUrl,
    posted_at: p.datePosted || '',
    closes_at: p.validThrough || '',
    external_id: typeof p.identifier === 'object' ? p.identifier?.value : p.identifier || '',
  };
}

function walkJsonLd(node, out) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach((n) => walkJsonLd(n, out));
  if (typeof node !== 'object') return;
  const t = node['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(node);
  if (node['@graph']) walkJsonLd(node['@graph'], out);
  if (node.itemListElement) walkJsonLd(node.itemListElement, out);
  if (node.item) walkJsonLd(node.item, out);
}

function extractJobPostings(html, pageUrl) {
  const $ = cheerio.load(html);
  const found = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walkJsonLd(JSON.parse($(el).contents().text()), found); } catch { /* ignore bad JSON-LD */ }
  });
  return found.map((p) => jobPostingToRecord(p, pageUrl)).filter((r) => r.title);
}

/** Last-resort single job page: title from og:title/h1, org from og:site_name, description from meta. */
function extractFallback(html, pageUrl) {
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text() || '').trim().replace(/\s+/g, ' ');
  const org = ($('meta[property="og:site_name"]').attr('content') || new URL(pageUrl).hostname.replace(/^www\./, '')).trim();
  const desc = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '').trim();
  if (!title) return [];
  return [{ title, org_name: org, description: desc, apply_url: pageUrl }];
}

/* ---------- feeds ---------- */
function rssToRecords(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item || doc?.feed?.entry || doc?.['rdf:RDF']?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  const text = (v) => (v && typeof v === 'object' ? v['#text'] ?? '' : v ?? '');
  return arr.filter(Boolean).map((it) => {
    const link = typeof it.link === 'object' ? it.link?.['@_href'] || text(it.link) : it.link;
    return {
      title: text(it.title),
      org_name: text(it.company || it['job:company'] || it.author?.name || it.author || it['dc:creator'] || ''),
      location: text(it.location || it['job:location'] || it.city || ''),
      description: text(it['content:encoded'] || it.description || it.content || it.summary || ''),
      apply_url: link || text(it.guid),
      posted_at: text(it.pubDate || it.published || it.updated || ''),
      category: text(it.category || ''),
    };
  });
}

function jsonToRecords(data) {
  let arr = data;
  if (!Array.isArray(arr)) {
    arr = data.jobs || data.data || data.results || data.items || data.postings || data.positions || data.records || [];
    if (!Array.isArray(arr)) arr = [];
  }
  return arr.filter((x) => x && typeof x === 'object').map((x) => {
    if (x['@type'] === 'JobPosting' || x.hiringOrganization) return jobPostingToRecord(x, x.url);
    return x;
  });
}

/* ---------- CSS-selector scraper for plain HTML listing pages ---------- */
function htmlToRecords(html, pageUrl, cfg = {}) {
  const $ = cheerio.load(html);
  const abs = (h) => { try { return new URL(h, pageUrl).href; } catch { return ''; } };
  const out = [];
  const sel = cfg.item;
  if (!sel) throw new Error('This source needs an "item" CSS selector (the repeating job row).');
  $(sel).each((_, el) => {
    const $el = $(el);
    const get = (s) => (s ? $el.find(s).first().text().replace(/\s+/g, ' ').trim() : '');
    const linkEl = cfg.link ? $el.find(cfg.link).first() : $el.is('a') ? $el : $el.find('a').first();
    out.push({
      title: get(cfg.title) || linkEl.text().replace(/\s+/g, ' ').trim(),
      org_name: get(cfg.org),
      location: get(cfg.location),
      salary: get(cfg.salary),
      closes_at: get(cfg.closes),
      description: get(cfg.description),
      apply_url: abs(linkEl.attr('href') || ''),
    });
  });
  return out;
}

/* ---------- ATS APIs ---------- */
async function greenhouse(token) {
  const { text } = await fetchText(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
  const data = JSON.parse(text);
  return (data.jobs || []).map((j) => ({
    title: j.title, location: j.location?.name || '', description: U.stripHtml(decodeEntities(j.content || '')),
    apply_url: j.absolute_url, posted_at: j.updated_at, external_id: 'gh-' + j.id,
  }));
}
async function lever(company) {
  const { text } = await fetchText(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
  return JSON.parse(text).map((j) => ({
    title: j.text, location: j.categories?.location || '', work_mode: j.workplaceType || '',
    description: j.descriptionPlain || U.stripHtml(j.description || ''),
    apply_url: j.hostedUrl, posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : '', external_id: 'lv-' + j.id,
  }));
}
function decodeEntities(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/* ---------- main entry points ---------- */
const SOURCE_TYPES = {
  auto: 'Auto-detect (recommended)',
  jsonld: 'Job page(s) with Google job markup',
  rss: 'RSS / Atom feed',
  json: 'JSON feed or API',
  csv: 'CSV / Google Sheet link',
  html: 'HTML list page (CSS selectors)',
  greenhouse: 'Greenhouse job board (board token)',
  lever: 'Lever job board (company name)',
};

function googleSheetToCsvUrl(url) {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (!m) return url;
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

/** Fetch a source and return raw records (not yet saved). */
async function fetchRecords(type, url, cfg = {}) {
  if (type === 'greenhouse') return greenhouse(url.trim());
  if (type === 'lever') return lever(url.trim());
  if (type === 'csv') url = googleSheetToCsvUrl(url);
  const { text, type: ctype, finalUrl } = await fetchText(url);
  const body = text.trim();

  if (type === 'csv') return parseCSV(body);
  if (type === 'rss') return rssToRecords(body);
  if (type === 'json') return jsonToRecords(JSON.parse(body));
  if (type === 'html') return htmlToRecords(body, finalUrl, cfg);
  if (type === 'jsonld') {
    const r = extractJobPostings(body, finalUrl);
    return r.length ? r : extractFallback(body, finalUrl);
  }
  // auto
  if (/^[\[{]/.test(body)) { try { return jsonToRecords(JSON.parse(body)); } catch { /* fallthrough */ } }
  if (/^<\?xml|^<rss|^<feed|^<rdf/i.test(body)) return rssToRecords(body);
  if (/docs\.google\.com\/spreadsheets|\.csv(\?|$)/i.test(url) || /text\/csv/.test(ctype)) return parseCSV(body);
  const jl = extractJobPostings(body, finalUrl);
  if (jl.length) return jl;
  if (cfg.item) return htmlToRecords(body, finalUrl, cfg);
  // listing pages: look for RSS autodiscovery
  const $ = cheerio.load(body);
  const feed = $('link[type="application/rss+xml"],link[type="application/atom+xml"]').attr('href');
  if (feed) { const f = await fetchText(new URL(feed, finalUrl).href); return rssToRecords(f.text); }
  return extractFallback(body, finalUrl);
}

/** Import from a source description. Returns the importRecords result. */
async function importFromSource(src, { dryRun = false } = {}) {
  const cfg = typeof src.config === 'string' ? JSON.parse(src.config || '{}') : src.config || {};
  const records = await fetchRecords(src.type, src.url, cfg);
  if (!records.length) throw new Error('Nothing that looks like a job was found at that address.');
  return importRecords(records, {
    source: src.name || src.url,
    kind: 'source',
    autoPublish: src.auto_publish !== 0,
    defaults: { org_name: src.default_org || '', category: src.default_category || '' },
    dryRun,
  });
}

/** Bulk list of individual job-page URLs. */
async function importUrls(urls, { defaults = {}, autoPublish = true, dryRun = false } = {}) {
  const records = [];
  const errors = [];
  for (const url of urls) {
    try {
      const r = await fetchRecords('jsonld', url);
      r.forEach((x) => records.push(x));
    } catch (e) { errors.push(`${url}: ${e.message}`); }
  }
  const res = importRecords(records, { source: 'url-list', kind: 'urls', autoPublish, defaults, dryRun });
  res.errors.unshift(...errors);
  res.skipped += errors.length;
  return res;
}

/* ---------- scheduler: runs enabled sources whose interval has elapsed ---------- */
async function runSource(id) {
  const src = q.get('SELECT * FROM sources WHERE id = ?', id);
  if (!src) throw new Error('Source not found');
  let status = 'ok', count = 0, message = '';
  try {
    const r = await importFromSource(src);
    count = r.added + r.updated;
    message = `${r.added} new, ${r.updated} updated, ${r.skipped} skipped`;
    if (r.errors.length) message += ' — ' + r.errors.slice(0, 2).join('; ');
  } catch (e) { status = 'error'; message = e.message; }
  q.run('UPDATE sources SET last_run_at = CURRENT_TIMESTAMP, last_status = ?, last_count = ? WHERE id = ?',
    status === 'ok' ? 'OK: ' + message : 'Error: ' + message, count, id);
  return { status, message };
}

let timer = null, running = false;
function startScheduler() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const due = q.all(`SELECT id FROM sources WHERE enabled = 1 AND (last_run_at IS NULL OR
        datetime(last_run_at, '+' || interval_hours || ' hours') <= datetime('now'))`);
      for (const s of due) await runSource(s.id);
    } catch (e) { console.error('scheduler error', e.message); }
    running = false;
  };
  setTimeout(tick, 15000);
  timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref?.();
}

module.exports = { fetchRecords, importFromSource, importUrls, runSource, startScheduler, SOURCE_TYPES, extractJobPostings, rssToRecords, jsonToRecords, htmlToRecords };

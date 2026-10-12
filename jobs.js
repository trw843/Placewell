const { q } = require('./db');
const U = require('./util');

// ---- header aliases so ANY reasonable spreadsheet/feed maps onto our fields ----
const ALIASES = {
  title: ['title', 'job title', 'job_title', 'position', 'role', 'name', 'job', 'position title', 'headline'],
  org_name: ['organization', 'organisation', 'org', 'org_name', 'company', 'employer', 'company name', 'hiring organization', 'hiringorganization', 'organization name'],
  location: ['location', 'job location', 'joblocation', 'city/state', 'where', 'place'],
  city: ['city'],
  state: ['state', 'region', 'province'],
  work_mode: ['work_mode', 'work mode', 'remote', 'schedule', 'arrangement', 'workplace', 'job location type', 'joblocationtype'],
  salary: ['salary', 'salary range', 'pay', 'compensation', 'salary_text', 'base salary', 'basesalary', 'pay range'],
  salary_min: ['salary_min', 'min salary', 'minimum salary', 'salary min', 'min_salary'],
  salary_max: ['salary_max', 'max salary', 'maximum salary', 'salary max', 'max_salary'],
  description: ['description', 'details', 'summary', 'job description', 'body', 'content', 'about'],
  apply_url: ['apply_url', 'apply url', 'url', 'link', 'apply', 'apply link', 'job url', 'posting url', 'application url', 'applyurl', 'guid'],
  apply_email: ['apply_email', 'apply email', 'contact email', 'email'],
  category: ['category', 'sector', 'discipline', 'type', 'job category', 'industry'],
  posted_at: ['posted_at', 'posted', 'date posted', 'dateposted', 'date', 'published', 'pubdate', 'post date'],
  closes_at: ['closes_at', 'closes', 'deadline', 'closing date', 'close date', 'validthrough', 'valid through', 'apply by', 'application deadline', 'expires'],
  featured: ['featured', 'feature'],
  external_id: ['external_id', 'id', 'job id', 'req id', 'requisition', 'reference', 'identifier'],
  status: ['status'],
};

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9/_ ]+/g, '').trim();

function pick(raw, field) {
  const keys = Object.keys(raw);
  const byNorm = {};
  for (const k of keys) byNorm[norm(k)] = k;
  for (const alias of ALIASES[field]) {
    const k = byNorm[norm(alias)];
    if (k !== undefined && raw[k] != null && String(raw[k]).trim() !== '') return raw[k];
  }
  return '';
}

/** Turn one messy raw record into a clean job object (or { error }). */
function normalizeRecord(raw, defaults = {}) {
  const title = String(pick(raw, 'title') || '').trim();
  let orgName = String(pick(raw, 'org_name') || defaults.org_name || '').trim();
  if (typeof raw.hiringOrganization === 'object' && raw.hiringOrganization?.name) orgName = raw.hiringOrganization.name;
  if (!title) return { error: 'Missing title' };
  if (!orgName) return { error: 'Missing organization' };

  let location = String(pick(raw, 'location') || '').trim();
  let city = String(pick(raw, 'city') || '').trim();
  let state = String(pick(raw, 'state') || '').trim();
  if (location && !city) { const s = U.splitLocation(location); city = s.city; state = state || s.state; }
  if (!location) location = [city, state].filter(Boolean).join(', ');
  if (!location && defaults.location) {
    location = defaults.location;
    const s = U.splitLocation(location); city = city || s.city; state = state || s.state;
  }

  const salaryText = String(pick(raw, 'salary') || '').trim();
  let min = parseInt(String(pick(raw, 'salary_min')).replace(/[^0-9]/g, ''), 10) || null;
  let max = parseInt(String(pick(raw, 'salary_max')).replace(/[^0-9]/g, ''), 10) || null;
  if (!min && !max) { const m = U.parseMoney(salaryText); min = m.min; max = m.max; }

  const description = U.stripHtml(String(pick(raw, 'description') || ''));
  const wmRaw = String(pick(raw, 'work_mode') || '');
  const workMode = U.parseWorkMode(wmRaw) || U.parseWorkMode(location) || U.parseWorkMode(title) || U.parseWorkMode(description.slice(0, 600)) ||
    (/^true$/i.test(wmRaw) ? 'Remote' : '');

  let category = String(pick(raw, 'category') || defaults.category || '').trim();
  const known = U.CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase());
  category = known || U.guessCategory(`${category} ${orgName} ${title}`);

  const applyUrl = String(pick(raw, 'apply_url') || '').trim();
  const applyEmail = String(pick(raw, 'apply_email') || '').trim();
  const featured = /^(1|true|yes|y|featured)$/i.test(String(pick(raw, 'featured') || ''));

  return {
    title, org_name: orgName, category, city, state, location,
    work_mode: workMode,
    salary_min: min, salary_max: max, salary_text: salaryText,
    description,
    apply_url: /^https?:\/\//i.test(applyUrl) ? applyUrl : '',
    apply_email: /@/.test(applyEmail) ? applyEmail : '',
    posted_at: U.parseDate(pick(raw, 'posted_at')) || null,
    closes_at: U.parseDate(pick(raw, 'closes_at')) || null,
    featured: featured ? 1 : 0,
    external_id: String(pick(raw, 'external_id') || '').trim() || null,
    status: String(pick(raw, 'status') || '').toLowerCase(),
  };
}

function makeExternalId(j) {
  if (j.external_id) return 'x:' + j.external_id;
  if (j.apply_url) return 'u:' + U.sha1(j.apply_url.replace(/[#?].*$/, '').toLowerCase());
  return 'h:' + U.sha1([j.title, j.org_name, j.location].join('|').toLowerCase());
}

function upsertOrg(name, extra = {}) {
  const existing = q.get('SELECT * FROM organizations WHERE lower(name) = lower(?)', name);
  if (existing) return existing;
  let slug = U.slugify(name), n = 1;
  while (q.get('SELECT 1 FROM organizations WHERE slug = ?', slug)) slug = U.slugify(name) + '-' + ++n;
  const abbr = (name.match(/\b[A-Z]/g) || []).join('').slice(0, 5) || name.slice(0, 3).toUpperCase();
  q.run(
    'INSERT INTO organizations(slug, name, abbr, type, city, state, website, description, source) VALUES(?,?,?,?,?,?,?,?,?)',
    slug, name, extra.abbr || abbr, extra.type || null, extra.city || null, extra.state || null, extra.website || null, extra.description || null, extra.source || null
  );
  return q.get('SELECT * FROM organizations WHERE slug = ?', slug);
}

function uniqueJobSlug(title, org) {
  const base = U.slugify(`${title} ${org}`);
  let slug = base, n = 1;
  while (q.get('SELECT 1 FROM jobs WHERE slug = ?', slug)) slug = `${base}-${++n}`;
  return slug;
}

/**
 * Insert or update a normalized job. Returns 'added' | 'updated'.
 * Re-importing the same posting (same id / URL / title+org+location) updates it instead of duplicating.
 */
function upsertJob(j, { source = 'manual', autoPublish = true } = {}) {
  const org = upsertOrg(j.org_name, { type: j.category, city: j.city, state: j.state, source });
  const ext = makeExternalId(j);
  const status = ['published', 'draft', 'expired'].includes(j.status) ? j.status : autoPublish ? 'published' : 'draft';
  const existing = q.get('SELECT id, status FROM jobs WHERE external_id = ?', ext);
  if (existing) {
    q.run(
      `UPDATE jobs SET title=?, org_id=?, org_name=?, category=?, city=?, state=?, location=?, work_mode=?,
        salary_min=?, salary_max=?, salary_text=?, description=COALESCE(NULLIF(?, ''), description),
        apply_url=?, apply_email=?, closes_at=COALESCE(?, closes_at), featured=MAX(featured, ?), updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      j.title, org.id, org.name, j.category, j.city, j.state, j.location, j.work_mode,
      j.salary_min, j.salary_max, j.salary_text, j.description,
      j.apply_url, j.apply_email, j.closes_at, j.featured, existing.id
    );
    return 'updated';
  }
  q.run(
    `INSERT INTO jobs(slug, title, org_id, org_name, category, city, state, location, work_mode, salary_min, salary_max, salary_text,
      description, apply_url, apply_email, source, external_id, status, featured, posted_at, closes_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uniqueJobSlug(j.title, org.name), j.title, org.id, org.name, j.category, j.city, j.state, j.location, j.work_mode,
    j.salary_min, j.salary_max, j.salary_text, j.description, j.apply_url, j.apply_email,
    source, ext, status, j.featured, j.posted_at || U.today(), j.closes_at
  );
  return 'added';
}

/**
 * Bulk-import raw records (CSV rows, JSON items, scraped items).
 * opts: { source, autoPublish, defaults, dryRun }
 */
function importRecords(records, opts = {}) {
  const res = { added: 0, updated: 0, skipped: 0, errors: [], preview: [] };
  const run = () => {
    records.forEach((raw, i) => {
      const j = normalizeRecord(raw, opts.defaults || {});
      if (j.error) { res.skipped++; res.errors.push(`Row ${i + 2}: ${j.error}`); return; }
      if (opts.dryRun) {
        const exists = !!q.get('SELECT 1 FROM jobs WHERE external_id = ?', makeExternalId(j));
        res.preview.push({ ...j, _exists: exists });
        exists ? res.updated++ : res.added++;
        return;
      }
      try { res[upsertJob(j, opts)]++; }
      catch (e) { res.skipped++; res.errors.push(`Row ${i + 2}: ${e.message}`); }
    });
  };
  opts.dryRun ? run() : q.tx(run);
  if (!opts.dryRun) {
    q.run('INSERT INTO import_log(source, kind, added, updated, skipped, notes) VALUES(?,?,?,?,?,?)',
      opts.source || 'manual', opts.kind || 'import', res.added, res.updated, res.skipped, res.errors.slice(0, 10).join(' | '));
  }
  return res;
}

// Public visibility: published and not past its closing date.
const LIVE_SQL = "j.status = 'published' AND (j.closes_at IS NULL OR j.closes_at >= date('now'))";

module.exports = { normalizeRecord, upsertJob, upsertOrg, importRecords, makeExternalId, LIVE_SQL, ALIASES, uniqueJobSlug };

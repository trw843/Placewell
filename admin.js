const express = require('express');
const { q, allSettings, setSetting, DEFAULT_SETTINGS } = require('../lib/db');
const U = require('../lib/util');
const { esc, CATEGORIES } = U;
const A = require('../lib/auth');
const { importRecords, upsertOrg, uniqueJobSlug, ALIASES } = require('../lib/jobs');
const { parseCSV, toCSV } = require('../lib/csv');
const IMP = require('../lib/importers');
const { clearDemo, hasDemo } = require('../lib/demo');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/* ---------- login ---------- */
const attempts = new Map();
const shell = (inner, title = 'Admin') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Admin</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700&family=Space+Grotesk:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/admin.css"></head><body class="adm">${inner}<script src="/admin.js" defer></script></body></html>`;

router.get('/login', (req, res) => {
  res.send(shell(`<div class="login"><div class="panel" style="background:#fff;max-width:420px;width:100%"><div style="display:flex;gap:12px;align-items:center;margin-bottom:22px"><div class="logo">PW</div><b class="brand-name">Admin</b></div>
  ${req.query.err ? '<div class="flash err">Incorrect password.</div>' : ''}
  <form method="post" action="/admin/login"><label class="field"><span>Password</span><input type="password" name="password" autofocus required></label><button class="btn block">Sign in</button></form>
  <p class="meta-sm" style="margin-top:16px"><a href="/">← Back to site</a></p></div></div>`, 'Sign in'));
});
router.post('/login', (req, res) => {
  const ip = req.ip || '', now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  if (list.length >= 8) return res.status(429).send('Too many attempts. Try again in 15 minutes.');
  if (!A.checkPassword(req.body.password)) { list.push(now); attempts.set(ip, list); return res.redirect('/admin/login?err=1'); }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `pw_admin=${A.makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? '; Secure' : ''}`);
  res.redirect('/admin');
});
router.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'pw_admin=; Path=/; Max-Age=0'); res.redirect('/admin/login'); });

// everything below requires a session
router.use((req, res, next) => (A.isAdmin(req) ? next() : res.redirect('/admin/login')));

/* ---------- layout helpers ---------- */
const NAV = [
  ['/admin', 'Dashboard'], ['/admin/jobs', 'Jobs'], ['/admin/import', 'Bulk import'], ['/admin/sources', 'Auto sources'],
  ['/admin/submissions', 'Submissions'], ['/admin/orgs', 'Organizations'], ['/admin/posts', 'Journal'],
  ['/admin/subscribers', 'Subscribers'], ['/admin/settings', 'Settings'], ['/admin/help', 'How-to guide'],
];
function page(req, active, title, body) {
  const pending = q.get("SELECT COUNT(*) n FROM submissions WHERE status='pending'").n;
  const flash = req.query.msg ? `<div class="flash ${req.query.err ? 'err' : ''}">${esc(req.query.msg)}</div>` : '';
  return shell(`<div class="shell"><aside class="sidebar"><a class="brand" href="/admin" style="margin-bottom:24px"><div class="logo">PW</div><div><div class="brand-name">${esc(allSettings().site_name)}</div><div class="brand-sub">Admin</div></div></a>
  <nav>${NAV.map(([h, l]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${l}${h === '/admin/submissions' && pending ? ` <span class="chip red">${pending}</span>` : ''}</a>`).join('')}</nav>
  <div style="margin-top:auto;padding-top:20px;display:flex;flex-direction:column;gap:10px"><a class="meta" href="/" target="_blank">View site ↗</a><form method="post" action="/admin/logout"><button class="btn sec2 sm block">Sign out</button></form></div></aside>
  <section class="content"><h1 class="h-sec" style="font-size:26px;margin-bottom:22px">${esc(title)}</h1>${flash}${body}</section></div>`, title);
}
const back = (res, to, msg, err) => res.redirect(`${to}${to.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}${err ? '&err=1' : ''}`);
const fld = (label, name, val = '', extra = '') => `<label class="field"><span>${label}</span><input type="text" name="${name}" value="${esc(val)}" ${extra}></label>`;
const sel = (label, name, opts, val) => `<label class="field"><span>${label}</span><select name="${name}">${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/* ---------- dashboard ---------- */
router.get('/', (req, res) => {
  const c = q.get(`SELECT COUNT(*) total, SUM(status='published' AND (closes_at IS NULL OR closes_at >= date('now'))) live, SUM(status='draft') draft,
    SUM(status='expired' OR (closes_at IS NOT NULL AND closes_at < date('now'))) expired FROM jobs`);
  const subs = q.get('SELECT COUNT(*) n FROM subscribers').n, orgs = q.get('SELECT COUNT(*) n FROM organizations').n;
  const pending = q.get("SELECT COUNT(*) n FROM submissions WHERE status='pending'").n;
  const logs = q.all('SELECT * FROM import_log ORDER BY id DESC LIMIT 8');
  const srcs = q.get('SELECT COUNT(*) n, SUM(enabled) en FROM sources');
  const body = `
  ${hasDemo() ? `<div class="flash err"><b>Sample data is present.</b> The listings marked "Sample" are fictional placeholders. Remove them before launch: <form method="post" action="/admin/settings/clear-demo" style="display:inline"><button class="btn sm danger">Delete sample data</button></form></div>` : ''}
  <div class="grid g4" style="margin-bottom:28px">
    <div class="metric"><b>${c.live || 0}</b><span class="label">Live jobs</span></div>
    <div class="metric"><b>${c.draft || 0}</b><span class="label">Drafts</span></div>
    <div class="metric"><b>${pending}</b><span class="label">Pending submissions</span></div>
    <div class="metric"><b>${subs}</b><span class="label">Subscribers</span></div></div>
  <div class="grid g3" style="margin-bottom:32px">
    <a class="card" href="/admin/import"><span class="meta">Fastest</span><h3 style="font-size:19px;text-transform:uppercase;margin:8px 0">Bulk import jobs</h3><p class="muted" style="margin:0">Paste a spreadsheet, drop a CSV, or give a list of job page links.</p></a>
    <a class="card" href="/admin/sources"><span class="meta">Automated</span><h3 style="font-size:19px;text-transform:uppercase;margin:8px 0">Auto sources (${srcs.n})</h3><p class="muted" style="margin:0">Pull jobs from career pages, feeds and ATS boards on a schedule. ${srcs.en || 0} enabled.</p></a>
    <a class="card" href="/admin/jobs/new"><span class="meta">One at a time</span><h3 style="font-size:19px;text-transform:uppercase;margin:8px 0">Add a job</h3><p class="muted" style="margin:0">Use the form for a single posting.</p></a></div>
  <h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Recent imports</h2>
  ${logs.length ? `<table class="table"><tr><th>When</th><th>Source</th><th>Added</th><th>Updated</th><th>Skipped</th><th>Notes</th></tr>${logs.map((l) => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.source)}</td><td>${l.added}</td><td>${l.updated}</td><td>${l.skipped}</td><td class="muted">${esc((l.notes || '').slice(0, 120))}</td></tr>`).join('')}</table>` : '<p class="muted">No imports yet.</p>'}`;
  res.send(page(req, '/admin', 'Dashboard', body));
});

/* ---------- jobs list ---------- */
router.get('/jobs', (req, res) => {
  const { status = '', q: kw = '', source = '' } = req.query;
  const pg = Math.max(1, parseInt(req.query.page, 10) || 1), per = 50;
  const where = ['1=1'], p = [];
  if (status === 'live') where.push("status='published' AND (closes_at IS NULL OR closes_at >= date('now'))");
  else if (status === 'expired') where.push("(status='expired' OR (closes_at IS NOT NULL AND closes_at < date('now')))");
  else if (status) { where.push('status = ?'); p.push(status); }
  if (kw) { where.push('(title LIKE ? OR org_name LIKE ?)'); p.push(`%${kw}%`, `%${kw}%`); }
  if (source) { where.push('source = ?'); p.push(source); }
  const total = q.get(`SELECT COUNT(*) n FROM jobs WHERE ${where.join(' AND ')}`, ...p).n;
  const rows = q.all(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${per} OFFSET ${(pg - 1) * per}`, ...p);
  const sources = q.all('SELECT DISTINCT source FROM jobs WHERE source IS NOT NULL ORDER BY source').map((r) => r.source);
  const pages = Math.max(1, Math.ceil(total / per));
  const qs = (n) => `/admin/jobs?${new URLSearchParams({ status, q: kw, source, page: n }).toString()}`;
  const body = `<form method="get" class="bar"><input type="search" name="q" value="${esc(kw)}" placeholder="Search title or organization" style="max-width:280px">
    ${sel('', 'status', [['', 'All statuses'], ['live', 'Live now'], ['published', 'Published'], ['draft', 'Draft'], ['expired', 'Expired']], status)}
    ${sel('', 'source', [['', 'All sources'], ...sources], source)}<button class="btn sm">Filter</button><a class="btn sm sec2" href="/admin/jobs/new">+ Add job</a><a class="btn sm sec2" href="/admin/export.csv">Export CSV</a></form>
  <form method="post" action="/admin/jobs/bulk"><div class="bar" style="margin-top:14px"><b class="meta">${total} jobs</b>
    <select name="action" style="max-width:200px"><option value="">With selected…</option><option value="publish">Publish</option><option value="draft">Move to draft</option><option value="expire">Mark expired</option><option value="feature">Feature</option><option value="unfeature">Unfeature</option><option value="delete">Delete</option></select>
    <button class="btn sm" data-confirm-select>Apply</button></div>
  <table class="table"><tr><th><input type="checkbox" data-all></th><th>Title</th><th>Organization</th><th>Location</th><th>Status</th><th>Closes</th><th>Source</th></tr>
  ${rows.map((j) => { const exp = j.closes_at && j.closes_at < U.today(); return `<tr><td><input type="checkbox" name="ids" value="${j.id}"></td>
   <td><a href="/admin/jobs/${j.id}"><b>${esc(j.title)}</b></a> ${j.featured ? '<span class="chip">Featured</span>' : ''}<br><a class="meta-sm" href="/jobs/${esc(j.slug)}" target="_blank">view ↗</a></td>
   <td>${esc(j.org_name)}</td><td>${esc(j.location || '')}</td><td><span class="chip ${exp || j.status === 'expired' ? 'red' : j.status === 'draft' ? 'plain' : ''}">${exp && j.status === 'published' ? 'expired' : esc(j.status)}</span></td>
   <td>${esc(j.closes_at || '—')}</td><td class="muted">${esc(j.source || '')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No jobs match.</td></tr>'}</table></form>
  <div style="margin-top:20px">${require('../lib/views').pager(pg, pages, qs)}</div>`;
  res.send(page(req, '/admin/jobs', 'Jobs', body));
});

router.post('/jobs/bulk', (req, res) => {
  const ids = arr(req.body.ids).map(Number).filter(Boolean);
  const act = req.body.action;
  if (!ids.length || !act) return back(res, '/admin/jobs', 'Select jobs and an action first.', true);
  const ph = ids.map(() => '?').join(',');
  const sqls = {
    publish: "UPDATE jobs SET status='published', updated_at=CURRENT_TIMESTAMP", draft: "UPDATE jobs SET status='draft', updated_at=CURRENT_TIMESTAMP",
    expire: "UPDATE jobs SET status='expired', updated_at=CURRENT_TIMESTAMP", feature: 'UPDATE jobs SET featured=1', unfeature: 'UPDATE jobs SET featured=0',
  };
  if (act === 'delete') q.run(`DELETE FROM jobs WHERE id IN (${ph})`, ...ids);
  else if (sqls[act]) q.run(`${sqls[act]} WHERE id IN (${ph})`, ...ids);
  else return back(res, '/admin/jobs', 'Unknown action.', true);
  back(res, '/admin/jobs', `${ids.length} job(s) updated.`);
});

/* ---------- job form ---------- */
function jobForm(j = {}, action) {
  return `<form method="post" action="${action}" class="panel" style="background:#fff;max-width:900px">
  <div class="grid g2">${fld('Title *', 'title', j.title, 'required')}${fld('Organization *', 'org_name', j.org_name, 'required list="orglist"')}
  <datalist id="orglist">${q.all('SELECT name FROM organizations ORDER BY name').map((o) => `<option value="${esc(o.name)}">`).join('')}</datalist>
  ${sel('Discipline', 'category', CATEGORIES, j.category)}${sel('Work mode', 'work_mode', [['', '—'], ...U.WORK_MODES], j.work_mode)}
  ${fld('Location (City, ST)', 'location', j.location)}${sel('Status', 'status', ['published', 'draft', 'expired'], j.status || 'published')}
  ${fld('Salary min (number)', 'salary_min', j.salary_min)}${fld('Salary max (number)', 'salary_max', j.salary_max)}
  ${fld('Or salary text', 'salary_text', j.salary_text, 'placeholder="$95,000 – $115,000"')}${fld('Apply URL', 'apply_url', j.apply_url, 'placeholder="https://"')}
  ${fld('Apply email (if no URL)', 'apply_email', j.apply_email)}
  <label class="field"><span>Posted</span><input type="date" name="posted_at" value="${esc(j.posted_at || U.today())}"></label>
  <label class="field"><span>Closes (blank = open until filled)</span><input type="date" name="closes_at" value="${esc(j.closes_at || '')}"></label>
  <label class="field"><span>Featured</span><label class="chk" style="display:flex;gap:8px;align-items:center;font-family:var(--display);font-size:14px"><input type="checkbox" name="featured" value="1" ${j.featured ? 'checked' : ''}> Show first, with Featured tag</label></label></div>
  <label class="field"><span>Description</span><textarea name="description" rows="14">${esc(j.description)}</textarea><small>Blank line = new paragraph. Start lines with "-" for bullets.</small></label>
  <div style="display:flex;gap:10px"><button class="btn">Save job</button><a class="btn sec2" href="/admin/jobs">Cancel</a></div></form>`;
}
function saveJob(b, id) {
  const org = upsertOrg(String(b.org_name).trim(), { type: b.category, source: 'manual' });
  const loc = String(b.location || '').trim(); const sp = U.splitLocation(loc);
  let min = parseInt(String(b.salary_min).replace(/\D/g, ''), 10) || null, max = parseInt(String(b.salary_max).replace(/\D/g, ''), 10) || null;
  if (!min && !max) { const m = U.parseMoney(b.salary_text); min = m.min; max = m.max; }
  const vals = [b.title.trim(), org.id, org.name, CATEGORIES.includes(b.category) ? b.category : 'Other Civic & Nonprofit', sp.city, sp.state, loc,
    U.WORK_MODES.includes(b.work_mode) ? b.work_mode : '', min, max, b.salary_text || '', b.description || '', b.apply_url || '', b.apply_email || '',
    ['published', 'draft', 'expired'].includes(b.status) ? b.status : 'published', b.featured ? 1 : 0, U.parseDate(b.posted_at) || U.today(), U.parseDate(b.closes_at)];
  if (id) {
    q.run(`UPDATE jobs SET title=?, org_id=?, org_name=?, category=?, city=?, state=?, location=?, work_mode=?, salary_min=?, salary_max=?, salary_text=?, description=?, apply_url=?, apply_email=?, status=?, featured=?, posted_at=?, closes_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, ...vals, id);
    return id;
  }
  return Number(q.run(`INSERT INTO jobs(title, org_id, org_name, category, city, state, location, work_mode, salary_min, salary_max, salary_text, description, apply_url, apply_email, status, featured, posted_at, closes_at, slug, source, external_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...vals, uniqueJobSlug(b.title, org.name), 'manual', 'm:' + require('crypto').randomUUID()).lastInsertRowid);
}
router.get('/jobs/new', (req, res) => res.send(page(req, '/admin/jobs', 'Add job', jobForm({}, '/admin/jobs/new'))));
router.post('/jobs/new', (req, res) => {
  if (!req.body.title || !req.body.org_name) return back(res, '/admin/jobs/new', 'Title and organization are required.', true);
  const id = saveJob(req.body); back(res, `/admin/jobs/${id}`, 'Job created.');
});
router.get('/jobs/:id', (req, res, next) => {
  const j = q.get('SELECT * FROM jobs WHERE id = ?', req.params.id); if (!j) return next();
  res.send(page(req, '/admin/jobs', 'Edit job', jobForm(j, `/admin/jobs/${j.id}`) + `<form method="post" action="/admin/jobs/${j.id}/delete" style="margin-top:18px" onsubmit="return confirm('Delete this job permanently?')"><button class="btn sm danger">Delete job</button> <a class="btn sm sec2" href="/jobs/${esc(j.slug)}" target="_blank">View public page ↗</a></form>`));
});
router.post('/jobs/:id', (req, res, next) => {
  if (!q.get('SELECT 1 FROM jobs WHERE id = ?', req.params.id)) return next();
  saveJob(req.body, Number(req.params.id)); back(res, `/admin/jobs/${req.params.id}`, 'Saved.');
});
router.post('/jobs/:id/delete', (req, res) => { q.run('DELETE FROM jobs WHERE id = ?', req.params.id); back(res, '/admin/jobs', 'Job deleted.'); });

/* ---------- exports / template ---------- */
const TEMPLATE_HEADERS = ['title', 'organization', 'location', 'work_mode', 'salary', 'category', 'apply_url', 'closes_at', 'description', 'featured'];
router.get('/template.csv', (req, res) => {
  res.type('text/csv').attachment('placewell-jobs-template.csv').send(toCSV(TEMPLATE_HEADERS, [{
    title: 'Director of Economic Development', organization: 'Example Regional Partnership', location: 'Greenville, SC', work_mode: 'Hybrid',
    salary: '$110,000 - $130,000', category: 'Economic Development', apply_url: 'https://example.org/careers/director', closes_at: '2026-12-15',
    description: 'Lead regional business attraction and retention.', featured: 'no' }]));
});
router.get('/export.csv', (req, res) => {
  const h = ['id', 'title', 'org_name', 'category', 'location', 'work_mode', 'salary_min', 'salary_max', 'apply_url', 'status', 'featured', 'posted_at', 'closes_at', 'source'];
  res.type('text/csv').attachment('jobs-export.csv').send(toCSV(h, q.all('SELECT * FROM jobs ORDER BY id DESC')));
});

/* ---------- bulk import ---------- */
function previewTable(r) {
  return `<div class="flash">${r.added} new · ${r.updated} will update existing · ${r.skipped} skipped</div>
  ${r.errors.length ? `<div class="flash err"><b>Problems:</b><br>${r.errors.slice(0, 15).map(esc).join('<br>')}${r.errors.length > 15 ? `<br>…and ${r.errors.length - 15} more` : ''}</div>` : ''}
  <table class="table"><tr><th></th><th>Title</th><th>Organization</th><th>Location</th><th>Pay</th><th>Discipline</th><th>Closes</th></tr>
  ${r.preview.slice(0, 60).map((j) => `<tr><td><span class="chip ${j._exists ? 'plain' : ''}">${j._exists ? 'update' : 'new'}</span></td><td>${esc(j.title)}</td><td>${esc(j.org_name)}</td><td>${esc(j.location)}</td><td>${esc(U.salaryDisplay(j) || '—')}</td><td>${esc(j.category)}</td><td>${esc(j.closes_at || '—')}</td></tr>`).join('')}</table>
  ${r.preview.length > 60 ? `<p class="muted">Showing first 60 of ${r.preview.length}.</p>` : ''}`;
}
const confirmForm = (action, fields, label = 'Looks good — import these') =>
  `<form method="post" action="${action}" style="margin-top:20px">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}<input type="hidden" name="mode" value="import"><div style="display:flex;gap:10px"><button class="btn">${label}</button><a class="btn sec2" href="/admin/import">Start over</a></div></form>`;
const doneBox = (r) => `<div class="flash"><b>Done.</b> ${r.added} added · ${r.updated} updated · ${r.skipped} skipped.</div>${r.errors.length ? `<div class="flash err">${r.errors.slice(0, 15).map(esc).join('<br>')}</div>` : ''}<div style="display:flex;gap:10px"><a class="btn" href="/admin/jobs">Review jobs</a><a class="btn sec2" href="/admin/import">Import more</a></div>`;

router.get('/import', (req, res) => {
  const cats = CATEGORIES.map((c) => `<code>${esc(c)}</code>`).join(', ');
  const body = `
  <div class="tabs" id="tabs"><button data-tab="csv" class="on">Spreadsheet / CSV</button><button data-tab="urls">Job page links</button><button data-tab="feed">Website, feed or sheet link</button></div>

  <div data-pane="csv"><p class="muted" style="max-width:46em">Paste rows straight from Excel or Google Sheets (with the header row), or upload a .csv file. Column names are flexible — "Job Title", "Position", "Employer", "Company", "Link", "Deadline" etc. are all understood. Only <b>title</b> and <b>organization</b> are required.
  <a href="/admin/template.csv">Download the template</a>.</p>
  <form method="post" action="/admin/import/csv" class="panel" style="background:#fff">
    <label class="field"><span>Upload a CSV file</span><input type="file" accept=".csv,.tsv,.txt" data-fill="csvtext"></label>
    <label class="field"><span>…or paste your rows here</span><textarea id="csvtext" name="csv" class="mono" rows="10" placeholder="title,organization,location,salary,apply_url&#10;Director of Economic Development,Example Partnership,&quot;Greenville, SC&quot;,$110k-$130k,https://…"></textarea></label>
    <div class="grid g3"><label class="field"><span>Default organization (if column missing)</span><input type="text" name="default_org"></label>
    ${sel('Default discipline', 'default_category', [['', 'Auto-detect'], ...CATEGORIES], '')}
    ${sel('After import', 'publish', [['1', 'Publish immediately'], ['0', 'Save as drafts for review']], '1')}</div>
    <button class="btn" name="mode" value="preview">Preview import</button></form>
  <details style="margin-top:18px"><summary class="meta" style="cursor:pointer">Recognized columns</summary><p class="muted">${Object.entries(ALIASES).map(([k, v]) => `<b>${k}</b>: ${v.slice(0, 5).join(', ')}`).join('<br>')}</p><p class="muted">Disciplines: ${cats}. Unknown or blank disciplines are guessed from the organization and title.</p></details></div>

  <div data-pane="urls" hidden><p class="muted" style="max-width:46em">Paste links to individual job postings (one per line). We read each page's built-in job data (the same markup Google Jobs uses), which most career sites provide. Pages without it fall back to the page title and description.</p>
  <form method="post" action="/admin/import/urls" class="panel" style="background:#fff">
    <label class="field"><span>Job page URLs, one per line</span><textarea name="urls" class="mono" rows="8" placeholder="https://careers.example.org/jobs/123&#10;https://other.org/careers/director"></textarea></label>
    <div class="grid g3"><label class="field"><span>Default organization</span><input type="text" name="default_org"></label>${sel('Default discipline', 'default_category', [['', 'Auto-detect'], ...CATEGORIES], '')}${sel('After import', 'publish', [['1', 'Publish immediately'], ['0', 'Save as drafts']], '1')}</div>
    <button class="btn" name="mode" value="preview">Preview import</button></form></div>

  <div data-pane="feed" hidden><p class="muted" style="max-width:46em">One-time pull from a page or feed. For something that should update automatically, add it under <a href="/admin/sources">Auto sources</a> instead.</p>
  <form method="post" action="/admin/import/feed" class="panel" style="background:#fff">
    <div class="grid g2"><label class="field"><span>URL (careers page, RSS feed, JSON API, CSV or Google Sheet link)</span><input type="text" name="url" placeholder="https://…" required></label>
    ${sel('Type', 'type', Object.entries(IMP.SOURCE_TYPES), 'auto')}</div>
    <div class="grid g3"><label class="field"><span>Default organization</span><input type="text" name="default_org"></label>${sel('Default discipline', 'default_category', [['', 'Auto-detect'], ...CATEGORIES], '')}${sel('After import', 'publish', [['1', 'Publish immediately'], ['0', 'Save as drafts']], '1')}</div>
    <button class="btn" name="mode" value="preview">Preview import</button></form></div>`;
  res.send(page(req, '/admin/import', 'Bulk import', body));
});

const optsFrom = (b) => ({ source: 'bulk-import', autoPublish: b.publish !== '0', defaults: { org_name: b.default_org || '', category: b.default_category || '' } });
router.post('/import/csv', (req, res) => {
  const b = req.body; const rows = parseCSV(b.csv);
  if (!rows.length) return back(res, '/admin/import', 'No rows found. Include the header row and at least one job.', true);
  const dry = b.mode !== 'import';
  const r = importRecords(rows, { ...optsFrom(b), kind: 'csv', dryRun: dry });
  res.send(page(req, '/admin/import', dry ? 'Preview import' : 'Import complete', dry ? previewTable(r) + confirmForm('/admin/import/csv', { csv: b.csv, default_org: b.default_org || '', default_category: b.default_category || '', publish: b.publish || '1' }) : doneBox(r)));
});
router.post('/import/urls', async (req, res) => {
  const b = req.body; const urls = String(b.urls || '').split(/\s+/).filter((u) => /^https?:\/\//i.test(u)).slice(0, 100);
  if (!urls.length) return back(res, '/admin/import', 'Add at least one http(s) link.', true);
  const dry = b.mode !== 'import';
  const r = await IMP.importUrls(urls, { defaults: optsFrom(b).defaults, autoPublish: b.publish !== '0', dryRun: dry });
  res.send(page(req, '/admin/import', dry ? 'Preview import' : 'Import complete', dry ? previewTable(r) + confirmForm('/admin/import/urls', { urls: b.urls, default_org: b.default_org || '', default_category: b.default_category || '', publish: b.publish || '1' }) : doneBox(r)));
});
router.post('/import/feed', async (req, res) => {
  const b = req.body; const dry = b.mode !== 'import';
  try {
    const r = await IMP.importFromSource({ name: b.url, type: b.type || 'auto', url: b.url.trim(), default_org: b.default_org, default_category: b.default_category, auto_publish: b.publish !== '0' ? 1 : 0 }, { dryRun: dry });
    res.send(page(req, '/admin/import', dry ? 'Preview import' : 'Import complete', dry ? previewTable(r) + confirmForm('/admin/import/feed', { url: b.url, type: b.type || 'auto', default_org: b.default_org || '', default_category: b.default_category || '', publish: b.publish || '1' }) : doneBox(r)));
  } catch (e) { back(res, '/admin/import', 'Could not import: ' + e.message, true); }
});

/* ---------- auto sources ---------- */
function sourceForm(s = {}, action) {
  const cfg = typeof s.config === 'string' ? JSON.parse(s.config || '{}') : s.config || {};
  return `<form method="post" action="${action}" class="panel" style="background:#fff;max-width:900px">
  <div class="grid g2">${fld('Name *', 'name', s.name, 'required placeholder="Chamber careers page"')}${sel('Type', 'type', Object.entries(IMP.SOURCE_TYPES), s.type || 'auto')}</div>
  ${fld('URL / board token *', 'url', s.url, 'required placeholder="https://…  (Greenhouse: board token · Lever: company name)"')}
  <div class="grid g3">${fld('Default organization', 'default_org', s.default_org, 'placeholder="Used when the source has none"')}${sel('Default discipline', 'default_category', [['', 'Auto-detect'], ...CATEGORIES], s.default_category)}
  ${sel('Check every', 'interval_hours', [[6, '6 hours'], [12, '12 hours'], [24, 'Day'], [72, '3 days'], [168, 'Week']], s.interval_hours || 24)}
  ${sel('New jobs are', 'auto_publish', [['1', 'Published automatically'], ['0', 'Saved as drafts to review']], s.auto_publish === 0 ? '0' : '1')}${sel('Status', 'enabled', [['1', 'Enabled'], ['0', 'Paused']], s.enabled === 0 ? '0' : '1')}</div>
  <details ${cfg.item ? 'open' : ''}><summary class="meta" style="cursor:pointer;margin-bottom:12px">Only for type "HTML list page": CSS selectors</summary>
  <p class="muted" style="font-size:15px">Right-click a job on the page → Inspect to find these. <b>item</b> is the repeating job row; the others are searched inside each row.</p>
  <div class="grid g3">${fld('item *', 'cfg_item', cfg.item, 'placeholder=".job-listing"')}${fld('title', 'cfg_title', cfg.title, 'placeholder="h3"')}${fld('link', 'cfg_link', cfg.link, 'placeholder="a"')}${fld('organization', 'cfg_org', cfg.org)}${fld('location', 'cfg_location', cfg.location)}${fld('salary', 'cfg_salary', cfg.salary)}${fld('closing date', 'cfg_closes', cfg.closes)}${fld('description', 'cfg_description', cfg.description)}</div></details>
  <div style="display:flex;gap:10px;margin-top:10px"><button class="btn">Save source</button><a class="btn sec2" href="/admin/sources">Cancel</a></div></form>`;
}
const cfgFrom = (b) => JSON.stringify(Object.fromEntries(Object.entries({ item: b.cfg_item, title: b.cfg_title, link: b.cfg_link, org: b.cfg_org, location: b.cfg_location, salary: b.cfg_salary, closes: b.cfg_closes, description: b.cfg_description }).filter(([, v]) => v && String(v).trim())));
const srcVals = (b) => [b.name, b.type, b.url.trim(), cfgFrom(b), b.default_org || '', b.default_category || '', parseInt(b.interval_hours, 10) || 24, b.enabled === '0' ? 0 : 1, b.auto_publish === '0' ? 0 : 1];

router.get('/sources', (req, res) => {
  const rows = q.all('SELECT * FROM sources ORDER BY id DESC');
  const body = `<p class="muted" style="max-width:48em">Add a source once and Placewell re-checks it automatically. New postings are added, changed ones updated, and jobs past their closing date disappear on their own. Duplicates are never created.</p>
  <div class="bar"><a class="btn" href="/admin/sources/new">+ Add source</a><form method="post" action="/admin/sources/run-all" style="display:inline"><button class="btn sec2">Run all enabled now</button></form></div>
  ${rows.length ? `<table class="table" style="margin-top:16px"><tr><th>Name</th><th>Type</th><th>Every</th><th>Last run</th><th>Result</th><th></th></tr>${rows.map((s) => `<tr>
   <td><a href="/admin/sources/${s.id}"><b>${esc(s.name)}</b></a><br><span class="meta-sm">${esc(s.url.slice(0, 60))}</span></td><td>${esc(IMP.SOURCE_TYPES[s.type] || s.type)}</td><td>${s.interval_hours}h ${s.enabled ? '' : '<span class="chip plain">paused</span>'}</td>
   <td>${esc(s.last_run_at || 'never')}</td><td class="${/^Error/.test(s.last_status || '') ? '' : 'muted'}" style="max-width:280px">${esc((s.last_status || '').slice(0, 140))}</td>
   <td style="white-space:nowrap"><form method="post" action="/admin/sources/${s.id}/run" style="display:inline"><button class="btn sm">Run now</button></form> <form method="post" action="/admin/sources/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete this source? Jobs already imported stay.')"><button class="btn sm sec2">Delete</button></form></td></tr>`).join('')}</table>` : '<div class="empty" style="margin-top:20px"><h3>No sources yet</h3><p class="muted">Try a careers page link, an RSS feed, or a Google Sheet your team maintains.</p></div>'}
  <h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.1em;margin:34px 0 10px">What works best</h2>
  <ul class="muted" style="line-height:1.6"><li><b>Google Sheet</b> — keep a sheet (share: anyone with link can view), paste the link, set Type to CSV. Add rows anytime; they flow in.</li>
  <li><b>Career pages with Google job markup</b> — most modern employer sites; use "Auto-detect".</li><li><b>RSS / JSON feeds</b> — many association job boards offer one.</li>
  <li><b>Greenhouse / Lever</b> — enter the board token or company name only.</li><li><b>Plain HTML lists</b> — use CSS selectors (advanced).</li></ul>`;
  res.send(page(req, '/admin/sources', 'Auto sources', body));
});
router.get('/sources/new', (req, res) => res.send(page(req, '/admin/sources', 'Add source', sourceForm({}, '/admin/sources/new'))));
router.post('/sources/new', async (req, res) => {
  if (!req.body.name || !req.body.url) return back(res, '/admin/sources/new', 'Name and URL are required.', true);
  const id = Number(q.run('INSERT INTO sources(name, type, url, config, default_org, default_category, interval_hours, enabled, auto_publish) VALUES(?,?,?,?,?,?,?,?,?)', ...srcVals(req.body)).lastInsertRowid);
  const r = await IMP.runSource(id);
  back(res, '/admin/sources', `Source saved. First run: ${r.status === 'ok' ? r.message : 'error — ' + r.message}`, r.status !== 'ok');
});
router.get('/sources/:id', (req, res, next) => {
  const s = q.get('SELECT * FROM sources WHERE id = ?', req.params.id); if (!s) return next();
  res.send(page(req, '/admin/sources', 'Edit source', sourceForm(s, `/admin/sources/${s.id}`)));
});
router.post('/sources/run-all', async (req, res) => {
  let n = 0, bad = 0;
  for (const s of q.all('SELECT id FROM sources WHERE enabled = 1')) { const r = await IMP.runSource(s.id); r.status === 'ok' ? n++ : bad++; }
  back(res, '/admin/sources', `Ran ${n + bad} source(s): ${n} ok, ${bad} with errors.`, bad > 0);
});
router.post('/sources/:id/run', async (req, res) => { const r = await IMP.runSource(Number(req.params.id)); back(res, '/admin/sources', r.status === 'ok' ? r.message : 'Error: ' + r.message, r.status !== 'ok'); });
router.post('/sources/:id/delete', (req, res) => { q.run('DELETE FROM sources WHERE id = ?', req.params.id); back(res, '/admin/sources', 'Source deleted.'); });
router.post('/sources/:id', (req, res) => {
  q.run('UPDATE sources SET name=?, type=?, url=?, config=?, default_org=?, default_category=?, interval_hours=?, enabled=?, auto_publish=? WHERE id=?', ...srcVals(req.body), req.params.id);
  back(res, '/admin/sources', 'Source updated.');
});

/* ---------- submissions ---------- */
router.get('/submissions', (req, res) => {
  const rows = q.all("SELECT * FROM submissions ORDER BY status = 'pending' DESC, id DESC LIMIT 100");
  const body = rows.length ? rows.map((s) => { const d = JSON.parse(s.data); return `<div class="panel" style="background:#fff;margin-bottom:16px"><div class="panel-head"><span class="label" style="color:var(--ink)">${esc(d.org_name)} — ${esc(d.title)}</span><span class="chip ${s.status === 'pending' ? 'red' : 'plain'}">${esc(s.status)}</span></div>
   <div class="grid g3 muted" style="font-size:16px"><div><b>Contact</b><br>${esc(d.contact_name)} · <a href="mailto:${esc(d.contact_email)}">${esc(d.contact_email)}</a></div><div><b>Location / mode</b><br>${esc(d.location)} ${esc(d.work_mode || '')}</div><div><b>Pay / apply</b><br>${esc(d.salary)}<br>${esc(d.apply)}</div></div>
   <details style="margin:12px 0"><summary class="meta" style="cursor:pointer">Description</summary><div class="prose">${U.renderText(d.description)}</div></details>
   <div class="meta-sm">Submitted ${esc(s.created_at)} (UTC)</div>
   ${s.status === 'pending' ? `<div style="display:flex;gap:10px;margin-top:12px"><form method="post" action="/admin/submissions/${s.id}/approve"><button class="btn sm">Approve &amp; publish</button></form><form method="post" action="/admin/submissions/${s.id}/draft"><button class="btn sm sec2">Save as draft to edit</button></form><form method="post" action="/admin/submissions/${s.id}/reject"><button class="btn sm sec2">Reject</button></form></div>` : ''}</div>`; }).join('')
    : '<div class="empty"><h3>No submissions yet</h3><p class="muted">Employer submissions from the Post a Role form appear here for approval.</p></div>';
  res.send(page(req, '/admin/submissions', 'Employer submissions', body));
});
function createFromSubmission(s, status) {
  const d = JSON.parse(s.data); const isUrl = /^https?:\/\//i.test(d.apply.trim());
  const sp = U.splitLocation(d.location); const m = U.parseMoney(d.salary);
  const org = upsertOrg(d.org_name, { type: d.category, city: sp.city, state: sp.state, website: d.website, source: 'submission' });
  const id = Number(q.run(`INSERT INTO jobs(slug, title, org_id, org_name, category, city, state, location, work_mode, salary_min, salary_max, salary_text, description, apply_url, apply_email, source, external_id, status, posted_at, closes_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, uniqueJobSlug(d.title, org.name), d.title, org.id, org.name, CATEGORIES.includes(d.category) ? d.category : U.guessCategory(d.org_name + d.title), sp.city, sp.state, d.location, d.work_mode || '',
    m.min, m.max, d.salary, d.description, isUrl ? d.apply.trim() : '', !isUrl ? d.apply.trim() : '', 'employer-submission', 's:' + s.id, status, U.today(), U.parseDate(d.closes_at)).lastInsertRowid);
  q.run("UPDATE submissions SET status = 'approved' WHERE id = ?", s.id);
  return id;
}
router.post('/submissions/:id/approve', (req, res) => { const s = q.get('SELECT * FROM submissions WHERE id = ?', req.params.id); if (s) createFromSubmission(s, 'published'); back(res, '/admin/submissions', 'Approved and published.'); });
router.post('/submissions/:id/draft', (req, res) => { const s = q.get('SELECT * FROM submissions WHERE id = ?', req.params.id); if (!s) return back(res, '/admin/submissions', 'Not found', true); res.redirect('/admin/jobs/' + createFromSubmission(s, 'draft')); });
router.post('/submissions/:id/reject', (req, res) => { q.run("UPDATE submissions SET status = 'rejected' WHERE id = ?", req.params.id); back(res, '/admin/submissions', 'Rejected.'); });

/* ---------- organizations ---------- */
router.get('/orgs', (req, res) => {
  const rows = q.all('SELECT o.*, (SELECT COUNT(*) FROM jobs j WHERE j.org_id = o.id) n FROM organizations o ORDER BY o.name');
  res.send(page(req, '/admin/orgs', 'Organizations', `<table class="table"><tr><th>Name</th><th>Type</th><th>Location</th><th>Jobs</th><th>Verified</th></tr>${rows.map((o) => `<tr><td><a href="/admin/orgs/${o.id}"><b>${esc(o.name)}</b></a></td><td>${esc(o.type || '')}</td><td>${esc([o.city, o.state].filter(Boolean).join(', '))}</td><td>${o.n}</td><td>${o.verified ? '✓' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet — created automatically from jobs.</td></tr>'}</table>`));
});
router.get('/orgs/:id', (req, res, next) => {
  const o = q.get('SELECT * FROM organizations WHERE id = ?', req.params.id); if (!o) return next();
  res.send(page(req, '/admin/orgs', 'Edit organization', `<form method="post" class="panel" style="background:#fff;max-width:800px"><div class="grid g2">${fld('Name', 'name', o.name, 'required')}${fld('Short code (e.g. ULI)', 'abbr', o.abbr)}${sel('Type', 'type', ['', ...CATEGORIES], o.type)}${fld('Website', 'website', o.website)}${fld('City', 'city', o.city)}${fld('State', 'state', o.state)}</div>
  <label class="field"><span>Description</span><textarea name="description" rows="4">${esc(o.description)}</textarea></label>
  <label class="field"><label style="display:flex;gap:8px;align-items:center;font-family:var(--display)"><input type="checkbox" name="verified" value="1" ${o.verified ? 'checked' : ''}> Verified organization (shows a Verified badge)</label></label>
  <div style="display:flex;gap:10px"><button class="btn">Save</button><button class="btn danger" formaction="/admin/orgs/${o.id}/delete" onclick="return confirm('Delete organization? Its jobs stay but are unlinked.')">Delete</button></div></form>`));
});
router.post('/orgs/:id', (req, res) => {
  const b = req.body;
  try { q.run('UPDATE organizations SET name=?, abbr=?, type=?, website=?, city=?, state=?, description=?, verified=? WHERE id=?', b.name, b.abbr, b.type, b.website, b.city, b.state, b.description, b.verified ? 1 : 0, req.params.id);
    q.run('UPDATE jobs SET org_name = ? WHERE org_id = ?', b.name, req.params.id); back(res, '/admin/orgs', 'Saved.'); }
  catch (e) { back(res, `/admin/orgs/${req.params.id}`, 'Could not save: ' + e.message, true); }
});
router.post('/orgs/:id/delete', (req, res) => { q.run('DELETE FROM organizations WHERE id = ?', req.params.id); back(res, '/admin/orgs', 'Deleted.'); });

/* ---------- journal ---------- */
router.get('/posts', (req, res) => {
  const rows = q.all('SELECT * FROM posts ORDER BY published_at DESC');
  res.send(page(req, '/admin/posts', 'Journal', `<div class="bar"><a class="btn" href="/admin/posts/new">+ New essay</a></div><table class="table" style="margin-top:14px"><tr><th>Title</th><th>Status</th><th>Date</th></tr>${rows.map((p) => `<tr><td><a href="/admin/posts/${p.id}"><b>${esc(p.title)}</b></a></td><td>${esc(p.status)}</td><td>${esc(U.fmtDate(p.published_at))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No essays yet.</td></tr>'}</table>`));
});
const postForm = (p = {}, a) => `<form method="post" action="${a}" class="panel" style="background:#fff;max-width:900px">${fld('Title *', 'title', p.title, 'required')}<div class="grid g3">${fld('Kicker (e.g. Strategy dossier)', 'kicker', p.kicker)}${fld('Minutes to read', 'read_minutes', p.read_minutes || 5)}${sel('Status', 'status', ['published', 'draft'], p.status || 'published')}</div>${fld('Summary (one or two sentences)', 'summary', p.summary)}<label class="field"><span>Body</span><textarea name="body" rows="18">${esc(p.body)}</textarea><small>Blank line = new paragraph. "-" for bullets.</small></label><div style="display:flex;gap:10px"><button class="btn">Save</button>${p.id ? `<button class="btn danger" formaction="/admin/posts/${p.id}/delete" onclick="return confirm('Delete?')">Delete</button>` : ''}</div></form>`;
router.get('/posts/new', (req, res) => res.send(page(req, '/admin/posts', 'New essay', postForm({}, '/admin/posts/new'))));
router.post('/posts/new', (req, res) => {
  const b = req.body; let slug = U.slugify(b.title), n = 1; while (q.get('SELECT 1 FROM posts WHERE slug = ?', slug)) slug = U.slugify(b.title) + '-' + ++n;
  q.run('INSERT INTO posts(slug, title, kicker, summary, body, read_minutes, status) VALUES(?,?,?,?,?,?,?)', slug, b.title, b.kicker, b.summary, b.body, parseInt(b.read_minutes, 10) || 5, b.status === 'draft' ? 'draft' : 'published');
  back(res, '/admin/posts', 'Essay saved.');
});
router.get('/posts/:id', (req, res, next) => { const p = q.get('SELECT * FROM posts WHERE id = ?', req.params.id); if (!p) return next(); res.send(page(req, '/admin/posts', 'Edit essay', postForm(p, `/admin/posts/${p.id}`))); });
router.post('/posts/:id', (req, res) => { const b = req.body; q.run('UPDATE posts SET title=?, kicker=?, summary=?, body=?, read_minutes=?, status=? WHERE id=?', b.title, b.kicker, b.summary, b.body, parseInt(b.read_minutes, 10) || 5, b.status === 'draft' ? 'draft' : 'published', req.params.id); back(res, '/admin/posts', 'Saved.'); });
router.post('/posts/:id/delete', (req, res) => { q.run('DELETE FROM posts WHERE id = ?', req.params.id); back(res, '/admin/posts', 'Deleted.'); });

/* ---------- subscribers ---------- */
router.get('/subscribers', (req, res) => {
  const rows = q.all('SELECT * FROM subscribers ORDER BY id DESC LIMIT 500');
  res.send(page(req, '/admin/subscribers', 'Subscribers', `<div class="bar"><a class="btn sm" href="/admin/subscribers.csv">Export CSV</a><span class="meta">${q.get('SELECT COUNT(*) n FROM subscribers').n} total</span></div><table class="table" style="margin-top:14px"><tr><th>Email</th><th>Frequency</th><th>Joined</th><th></th></tr>${rows.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.frequency)}</td><td>${esc(s.created_at)}</td><td><form method="post" action="/admin/subscribers/${s.id}/delete"><button class="btn sm sec2">Remove</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet.</td></tr>'}</table>
  <p class="muted" style="margin-top:20px">Export the list and import it into your email tool (Mailchimp, Beehiiv, Constant Contact) to send the dispatches.</p>`));
});
router.get('/subscribers.csv', (req, res) => res.type('text/csv').attachment('subscribers.csv').send(toCSV(['email', 'frequency', 'created_at'], q.all('SELECT * FROM subscribers ORDER BY id'))));
router.post('/subscribers/:id/delete', (req, res) => { q.run('DELETE FROM subscribers WHERE id = ?', req.params.id); back(res, '/admin/subscribers', 'Removed.'); });

/* ---------- settings ---------- */
router.get('/settings', (req, res) => {
  const s = allSettings();
  const base = s.site_url || `${req.protocol}://${req.get('host')}`;
  res.send(page(req, '/admin/settings', 'Settings', `<form method="post" class="panel" style="background:#fff;max-width:800px"><div class="grid g2">${fld('Site name', 'site_name', s.site_name)}${fld('Tagline', 'tagline', s.tagline)}${fld('Contact email', 'contact_email', s.contact_email)}${fld('Public site URL (for SEO)', 'site_url', s.site_url, 'placeholder="https://placewell.com"')}${fld('Posting price ($)', 'post_price', s.post_price)}${fld('Payment link (Stripe / PayPal)', 'payment_link', s.payment_link, 'placeholder="https://buy.stripe.com/…"')}</div>${fld('Announcement bar (leave blank for none)', 'announcement', s.announcement)}<button class="btn">Save settings</button></form>
  <h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.1em;margin:34px 0 10px">Automation API key</h2>
  <p class="muted" style="max-width:46em">Use this key to push jobs from Zapier, Make, Google Apps Script or any script. See the <a href="/admin/help#api">how-to guide</a>.</p>
  <input type="text" readonly value="${esc(A.getApiKey())}" onclick="this.select()" style="max-width:560px;font-family:monospace"><p class="meta-sm">Endpoint: ${esc(base)}/api/import</p>
  <h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.1em;margin:34px 0 10px">Cleanup</h2>
  <div class="bar"><form method="post" action="/admin/settings/clear-demo" onsubmit="return confirm('Delete all sample listings?')"><button class="btn sm sec2">Delete sample data</button></form>
  <form method="post" action="/admin/settings/purge-expired" onsubmit="return confirm('Permanently delete jobs closed over 30 days ago?')"><button class="btn sm sec2">Delete jobs closed 30+ days ago</button></form></div>`));
});
router.post('/settings', (req, res) => { for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in req.body) setSetting(k, String(req.body[k]).trim()); back(res, '/admin/settings', 'Settings saved.'); });
router.post('/settings/clear-demo', (req, res) => back(res, '/admin', `Deleted ${clearDemo()} sample listings.`));
router.post('/settings/purge-expired', (req, res) => back(res, '/admin/settings', `Deleted ${q.run("DELETE FROM jobs WHERE closes_at IS NOT NULL AND closes_at < date('now', '-30 days')").changes} old jobs.`));

/* ---------- help ---------- */
router.get('/help', (req, res) => {
  const base = allSettings().site_url || `${req.protocol}://${req.get('host')}`;
  res.send(page(req, '/admin/help', 'How to add jobs', `<div class="prose">
  <h2 style="margin-top:0">The 4 ways to add jobs</h2>
  <h3>1. Spreadsheet (fastest for a batch)</h3><p>Go to <a href="/admin/import">Bulk import</a> → paste rows from Excel/Google Sheets (include the header row) or upload a CSV → <b>Preview</b> → confirm. Only <b>title</b> and <b>organization</b> are required; location, salary, link, deadline, description and discipline are all picked up automatically if present. Re-importing the same sheet updates existing jobs instead of duplicating them.</p>
  <h3>2. Job page links</h3><p>Bulk import → <b>Job page links</b>. Paste up to 100 links to individual postings, one per line.</p>
  <h3>3. Automatic sources (hands-off)</h3><p><a href="/admin/sources">Auto sources</a> → add a careers page, RSS feed, Greenhouse/Lever board or a Google Sheet link. It re-checks every 6–168 hours. Best setup for ongoing volume: <b>keep a Google Sheet</b>, share it as "anyone with the link can view", add it as a source (Type: CSV), and anyone on your team can add rows.</p>
  <h3>4. One at a time</h3><p><a href="/admin/jobs/new">Jobs → Add job</a>. Employers can also submit through <a href="/post-a-role">Post a Role</a>; those show up under <a href="/admin/submissions">Submissions</a> for approval.</p>
  <h2 id="api">Push jobs from other tools (API)</h2>
  <p>Send a POST to <code>${esc(base)}/api/import</code> with your API key (Settings page). Works with Zapier ("Webhooks by Zapier"), Make, Google Apps Script, or curl.</p>
  <pre style="background:#fff;border:1px solid var(--hair);padding:14px;overflow:auto;font-size:13px">curl -X POST ${esc(base)}/api/import \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"jobs":[{"title":"Director of Economic Development","organization":"Example Partnership","location":"Greenville, SC","salary":"$110,000 - $130,000","apply_url":"https://example.org/apply"}]}'</pre>
  <p>You can also POST raw CSV (<code>Content-Type: text/csv</code>). Add <code>?publish=0</code> to save as drafts.</p>
  <h2>Tips</h2><ul><li>Dates: any common format; "closes_at" hides the job automatically after that day.</li><li>Pay: "$120k–140k", "$120,000 - $140,000" are parsed into searchable ranges. Hourly pay is kept as text only.</li><li>Featured: put <code>yes</code> in a "featured" column to pin a job to the top.</li><li>Dedup: matched on the apply link, or title + organization + location.</li><li>Only scrape sources you have the right to use — prefer feeds, partner sheets and public job markup, and credit employers by linking to their apply page (this site always does).</li></ul></div>`));
});

module.exports = router;

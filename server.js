const express = require('express');
const path = require('path');
const { q } = require('./lib/db');
const A = require('./lib/auth');
const U = require('./lib/util');
const V = require('./lib/views');
const { importRecords, LIVE_SQL } = require('./lib/jobs');
const { parseCSV } = require('./lib/csv');
const IMP = require('./lib/importers');
const { seedDemo } = require('./lib/demo');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Public JSON feed of live jobs
app.get('/api/jobs.json', (req, res) => {
  const rows = q.all(`SELECT j.slug, j.title, j.location, j.work_mode, j.category, j.salary_min, j.salary_max, j.apply_url, j.posted_at, j.closes_at, o.name AS organization
    FROM jobs j LEFT JOIN organizations o ON o.id = j.org_id WHERE ${LIVE_SQL} ORDER BY j.posted_at DESC LIMIT 500`);
  res.json({ count: rows.length, jobs: rows });
});

// Authenticated bulk/automation endpoint: JSON array, {jobs:[...]}, or CSV body
app.post('/api/import', (req, res) => {
  if (!A.apiKeyOk(req)) return res.status(401).json({ error: 'Missing or invalid API key' });
  let records = [];
  const b = req.body;
  try {
    if (typeof b === 'string') records = parseCSV(b);
    else if (Array.isArray(b)) records = b;
    else if (b && Array.isArray(b.jobs)) records = b.jobs;
    else if (b && typeof b === 'object' && Object.keys(b).length) records = [b];
  } catch (e) { return res.status(400).json({ error: 'Could not parse body: ' + e.message }); }
  if (!records.length) return res.status(400).json({ error: 'No jobs found in request body' });
  const r = importRecords(records, { source: 'api', kind: 'api', autoPublish: req.query.publish !== '0' });
  res.json({ added: r.added, updated: r.updated, skipped: r.skipped, errors: r.errors.slice(0, 50) });
});

app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/public'));

app.use((req, res) => {
  res.status(404).send(V.layout({ title: 'Page not found', noindex: true, path: req.path, body:
    `<section class="wrap" style="padding:80px 0"><h1 class="h1">Page not found</h1><p class="lead">That page doesn't exist or the job has been filled.</p><p><a class="btn" href="/jobs">Browse open roles</a></p></section>` }));
});
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send(V.layout({ title: 'Something went wrong', noindex: true, path: req.path, body:
    `<section class="wrap" style="padding:80px 0"><h1 class="h1">Something went wrong</h1><p class="lead">Please try again in a moment.</p></section>` }));
});

if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === '1') {
  try { const n = seedDemo(); if (n) console.log(`Seeded ${n} sample listings (delete under Admin → Settings before launch).`); } catch (e) { console.error(e); }
}
IMP.startScheduler();
const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`Placewell running on http://localhost:${PORT}  (admin: /admin)`));
module.exports = app;

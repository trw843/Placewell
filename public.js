const express = require('express');
const { q, allSettings } = require('../lib/db');
const U = require('../lib/util');
const { LIVE_SQL } = require('../lib/jobs');
const V = require('../lib/views');
const { esc, CATEGORIES, CATEGORY_BLURBS } = U;

const router = express.Router();
const PER_PAGE = 20;

const median = (arr) => {
  const a = arr.filter((n) => n != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};
const num = (n) => Number(n || 0).toLocaleString('en-US');

// tiny in-memory rate limiter for public forms
const hits = new Map();
function limited(req, key, max = 6, windowMs = 3600e3) {
  const k = key + ':' + (req.ip || '');
  const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}

/* ------------------------------ HOME ------------------------------ */
router.get('/', (req, res) => {
  const s = allSettings();
  const stat = q.get(`SELECT COUNT(*) n, SUM(CASE WHEN salary_min IS NOT NULL THEN 1 ELSE 0 END) paid FROM jobs j WHERE ${LIVE_SQL}`);
  const orgCount = q.get(`SELECT COUNT(DISTINCT org_id) n FROM jobs j WHERE ${LIVE_SQL}`).n;
  const med = median(q.all(`SELECT salary_min FROM jobs j WHERE ${LIVE_SQL} AND salary_min IS NOT NULL`).map((r) => r.salary_min));
  const pct = stat.n ? Math.round((stat.paid / stat.n) * 100) : 0;
  const catCounts = Object.fromEntries(q.all(`SELECT category, COUNT(*) n FROM jobs j WHERE ${LIVE_SQL} GROUP BY category`).map((r) => [r.category, r.n]));
  const featured = q.all(`SELECT * FROM jobs j WHERE ${LIVE_SQL} ORDER BY featured DESC, posted_at DESC, id DESC LIMIT 4`);
  const orgs = q.all(`SELECT o.*, COUNT(j.id) open FROM organizations o JOIN jobs j ON j.org_id = o.id AND ${LIVE_SQL} GROUP BY o.id ORDER BY open DESC, o.name LIMIT 4`);
  const posts = q.all("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 3");

  const body = `
<section class="hero wrap"><div class="max g12">
  <div class="c7">
    <span class="chip">National civic talent exchange</span>
    <h1 class="display">Good Work.<br>Great Places.</h1>
    <p class="lede" style="margin:0 0 40px">The career registry for economic development organizations, regional chambers, downtown stewards and community foundations.</p>
    <form class="searchbox" action="/jobs" method="get">
      <div class="cell"><label for="hq">Capability / Role</label><input id="hq" name="q" type="search" placeholder="e.g. Economic Development Director"></div>
      <div class="cell"><label for="hl">Geography</label><input id="hl" name="loc" type="search" placeholder="e.g. South Carolina, Remote"></div>
      <button class="btn" type="submit">Search roles →</button>
    </form>
    <div class="meta" style="margin-top:20px;display:flex;flex-wrap:wrap;gap:6px 14px"><b style="color:var(--ink)">Browse:</b>
      ${CATEGORIES.slice(0, 5).map((c) => `<a href="/jobs?category=${encodeURIComponent(c)}" style="text-underline-offset:4px">${esc(c)}</a>`).join('')}
    </div>
  </div>
  <div class="c5 panel">
    <div class="panel-head"><span class="label" style="color:var(--ink)">Architectural survey · Sheet 01</span><span class="label">Public sphere</span></div>
    <div class="plate">${V.HERO_SVG}</div>
    <div style="display:flex;justify-content:space-between;margin-top:20px" class="label"><span>Sector coverage</span><b style="color:var(--ink)">${CATEGORIES.length} disciplines</b></div>
    <p class="muted" style="margin:10px 0 0;font-size:17px">Serving the leadership teams responsible for capital formation, civic identity and main street resilience.</p>
  </div>
</div></section>

<section class="metrics wrap"><div class="max grid g4">
  <div class="metric"><b>${num(stat.n)}</b><span class="label">Open roles</span></div>
  <div class="metric"><b>${num(orgCount)}</b><span class="label">Hiring organizations</span></div>
  <div class="metric"><b>${med ? '$' + Math.round(med / 1000) + 'K' : '—'}</b><span class="label">Median salary floor</span></div>
  <div class="metric"><b>${pct}%</b><span class="label">Roles with disclosed pay</span></div>
</div></section>

<section class="sec wrap"><div class="max">
  <div class="sec-head"><div><span class="label" style="display:block;margin-bottom:6px">Registry taxonomy</span><h2 class="h-sec">Civic disciplines</h2></div>
  <p class="italic muted" style="font-size:21px;max-width:26em;margin:0">Structured career indexes spanning regional economic authorities, mercantile councils and philanthropic endowments.</p></div>
  <div class="tiles">
  ${CATEGORIES.slice(0, 6).map((c, i) => `<a class="tile" href="/jobs?category=${encodeURIComponent(c)}">
    <div class="meta" style="display:flex;justify-content:space-between"><span>Sec. 0${i + 1}</span><b style="color:var(--ink)">${catCounts[c] || 0} role${catCounts[c] === 1 ? '' : 's'}</b></div>
    <div><h3>${esc(c)}</h3><p>${esc(CATEGORY_BLURBS[c])}</p></div>
    <div class="foot meta" style="color:var(--ink)"><span>Open index</span><span>→</span></div></a>`).join('')}
  </div>
</div></section>

<section class="sec wrap"><div class="max">
  <div class="sec-head"><div><span class="label" style="display:block;margin-bottom:6px">${featured.length ? 'Latest &amp; featured' : 'Open roles'}</span><h2 class="h-sec">Executive dossiers</h2></div>
  <a class="label" style="color:var(--ink);text-underline-offset:4px" href="/jobs">Browse complete ledger →</a></div>
  ${featured.length ? `<div class="rows">${featured.map(V.jobRow).join('')}</div>` :
    `<div class="empty"><h3>New roles are being added</h3><p class="muted">Check back shortly, or set up an alert and we'll email you.</p><a class="btn" href="/alerts">Get job alerts</a></div>`}
</div></section>

${orgs.length ? `<section class="sec wrap band-sage"><div class="max">
  <div class="sec-head"><div><span class="label" style="display:block;margin-bottom:6px">Institutional roster</span><h2 class="h-sec">Hiring organizations</h2></div>
  <a class="label" style="color:var(--ink);text-underline-offset:4px" href="/organizations">All organizations →</a></div>
  <div class="grid g4">${orgs.map(orgCard).join('')}</div></div></section>` : ''}

<section class="sec wrap"><div class="max g12" style="align-items:stretch">
  <div class="c6 box" style="display:flex;flex-direction:column;justify-content:space-between">
    <div><span class="label" style="display:block;margin-bottom:8px">Intelligence briefing</span>
    <h2 class="h-sec" style="font-size:30px;margin-bottom:14px">Civic leadership vacancies delivered weekly.</h2>
    <p class="lede" style="font-size:21px;margin-bottom:28px">Curated dispatches of new executive openings across economic development, chambers, foundations and downtown organizations. No algorithmic clutter.</p></div>
    <form method="post" action="/subscribe"><label class="field"><span>Email address</span><input type="email" name="email" required placeholder="you@organization.org"></label>
      <div class="grid g3" style="gap:8px;margin-bottom:14px">
        ${['weekly:Weekly', 'biweekly:Bi-weekly', 'daily:Daily'].map((o, i) => { const [v, l] = o.split(':'); return `<label class="chip plain" style="padding:9px;text-align:center;cursor:pointer"><input type="radio" name="frequency" value="${v}" ${i === 0 ? 'checked' : ''} style="accent-color:#244637"> ${l}</label>`; }).join('')}
      </div>
      <input type="hidden" name="back" value="/"><button class="btn block" type="submit">Subscribe to leadership dispatch</button></form>
  </div>
  <div class="c6 callout" style="display:flex;flex-direction:column;justify-content:space-between">
    <div><span class="chip" style="background:var(--forest-dark);color:var(--sage);border-color:rgba(250,250,246,.25);margin-bottom:22px;display:inline-block">Employer placement desk</span>
    <h2>Recruiting leaders for your city or region?</h2>
    <p>Put your opening in front of economic developers, chamber executives and place managers who are specifically looking for places worth investing in.</p>
    <ul><li>Reaches civic professionals across the sector</li><li>Review within one business day</li><li>Flat, published pricing</li></ul></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;border-top:1px solid rgba(250,250,246,.2);padding-top:22px">
      <a class="btn light" href="/post-a-role">Post an opening ($${esc(s.post_price)})</a><a class="btn ghost-light" href="/employers">How it works</a></div>
  </div>
</div></section>

${posts.length ? `<section class="sec wrap" style="border-bottom:0"><div class="max">
  <div class="sec-head"><div><span class="label" style="display:block;margin-bottom:6px">The journal</span><h2 class="h-sec">Civic practice &amp; essays</h2></div>
  <a class="label" style="color:var(--ink)" href="/journal">Complete archive →</a></div>
  <div class="grid g3 articles">${posts.map(postCard).join('')}</div></div></section>` : ''}
`;
  res.send(V.layout({ title: '', body, active: '/', path: '/' }));
});

function orgCard(o) {
  return `<a class="org" href="/organizations/${esc(o.slug)}"><div><div class="head"><b class="display" style="font-size:15px;letter-spacing:0">${esc(o.abbr || '')}</b><span class="label" style="color:var(--forest)">${o.verified ? 'Verified' : esc(o.type || 'Organization')}</span></div>
  <h3>${esc(o.name)}</h3><p>${esc((o.description || [o.city, o.state].filter(Boolean).join(', ') || '').slice(0, 130))}</p></div>
  <div class="foot meta"><b style="color:var(--ink)">${o.open ?? 0} open role${o.open === 1 ? '' : 's'}</b><span style="text-decoration:underline;text-underline-offset:4px">View roster</span></div></a>`;
}
function postCard(p) {
  return `<article><div><div class="plate-sm"><div class="meta-sm" style="display:flex;justify-content:space-between"><span>${esc(U.fmtDate(p.published_at))}</span><span>${esc(p.kicker || '')}</span></div>
  <svg viewBox="0 0 200 30" style="height:28px;width:100%" fill="none" stroke="#171A17" stroke-width="1.2"><line x1="10" x2="190" y1="25" y2="25"/><polygon points="100,4 62,18 138,18"/><line x1="72" x2="72" y1="18" y2="25"/><line x1="90" x2="90" y1="18" y2="25"/><line x1="110" x2="110" y1="18" y2="25"/><line x1="128" x2="128" y1="18" y2="25"/></svg></div>
  <div class="meta" style="display:flex;justify-content:space-between"><span>${esc(p.kicker || 'Essay')}</span><span>${p.read_minutes} min read</span></div>
  <h3><a href="/journal/${esc(p.slug)}" style="text-decoration:none">${esc(p.title)}</a></h3><p>${esc(p.summary || '')}</p></div>
  <a class="meta" style="color:var(--ink);border-top:1px solid var(--hair);padding-top:14px;text-decoration:none" href="/journal/${esc(p.slug)}">Read essay →</a></article>`;
}

/* ------------------------------ JOBS ------------------------------ */
router.get('/jobs', (req, res) => {
  const { q: kw = '', loc = '', category = '', mode = '', min = '', sort = 'recent', paid = '' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const where = [LIVE_SQL], params = [];
  if (kw.trim()) {
    for (const w of kw.trim().split(/\s+/).slice(0, 5)) {
      where.push('(j.title LIKE ? OR j.org_name LIKE ? OR j.description LIKE ? OR j.category LIKE ?)');
      params.push(...Array(4).fill(`%${w}%`));
    }
  }
  if (loc.trim()) { where.push('(j.location LIKE ? OR j.state LIKE ? OR j.city LIKE ? OR j.work_mode LIKE ?)'); params.push(...Array(4).fill(`%${loc.trim()}%`)); }
  if (CATEGORIES.includes(category)) { where.push('j.category = ?'); params.push(category); }
  if (U.WORK_MODES.includes(mode)) { where.push('j.work_mode = ?'); params.push(mode); }
  const minN = parseInt(min, 10);
  if (minN) { where.push('COALESCE(j.salary_max, j.salary_min) >= ?'); params.push(minN); }
  if (paid) where.push('j.salary_min IS NOT NULL');
  const order = { recent: 'j.featured DESC, j.posted_at DESC, j.id DESC', salary: 'COALESCE(j.salary_max, j.salary_min, 0) DESC, j.id DESC', deadline: 'j.closes_at IS NULL, j.closes_at ASC, j.id DESC' }[sort] || 'j.featured DESC, j.posted_at DESC';
  const W = where.join(' AND ');
  const total = q.get(`SELECT COUNT(*) n FROM jobs j WHERE ${W}`, ...params).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = q.all(`SELECT * FROM jobs j WHERE ${W} ORDER BY ${order} LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, ...params);

  const qs = (over = {}) => {
    const p = new URLSearchParams();
    const cur = { q: kw, loc, category, mode, min, sort, paid, ...over };
    Object.entries(cur).forEach(([k, v]) => { if (v && !(k === 'sort' && v === 'recent') && !(k === 'page' && v == 1)) p.set(k, v); });
    const s = p.toString(); return '/jobs' + (s ? '?' + s : '');
  };
  const body = `
<section class="wrap" style="border-bottom:1px solid var(--ink);padding-top:28px;padding-bottom:28px"><div class="max">
  <form class="searchbox" action="/jobs" method="get" style="box-shadow:none">
    <div class="cell"><label for="jq">Position, organization or keyword</label><input id="jq" name="q" type="search" value="${esc(kw)}" placeholder="Economic development director"></div>
    <div class="cell"><label for="jl">Location</label><input id="jl" name="loc" type="search" value="${esc(loc)}" placeholder="State, city or Remote"></div>
    <button class="btn" type="submit">Search</button>
  </form>
</div></section>
<section class="wrap" style="padding-top:40px;padding-bottom:72px"><div class="max g12" style="gap:40px">
  <aside class="c4" style="grid-column:span 3">
    <form class="filters" method="get" action="/jobs">
      <input type="hidden" name="q" value="${esc(kw)}"><input type="hidden" name="loc" value="${esc(loc)}">
      <h4>Filter roles</h4>
      <div class="grp"><span class="label" style="display:block;margin-bottom:8px;color:var(--ink)">Discipline</span>
        <label class="chk"><input type="radio" name="category" value="" ${!category ? 'checked' : ''}> All</label>
        ${CATEGORIES.map((c) => `<label class="chk"><input type="radio" name="category" value="${esc(c)}" ${category === c ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
      <div class="grp"><span class="label" style="display:block;margin-bottom:8px;color:var(--ink)">Work mode</span>
        <label class="chk"><input type="radio" name="mode" value="" ${!mode ? 'checked' : ''}> Any</label>
        ${U.WORK_MODES.map((m) => `<label class="chk"><input type="radio" name="mode" value="${m}" ${mode === m ? 'checked' : ''}> ${m}</label>`).join('')}</div>
      <div class="grp"><label class="field" style="margin:0"><span>Minimum salary</span><select name="min">
        ${[['', 'Any'], ['60000', '$60,000+'], ['80000', '$80,000+'], ['100000', '$100,000+'], ['125000', '$125,000+'], ['150000', '$150,000+'], ['200000', '$200,000+']].map(([v, l]) => `<option value="${v}" ${String(min) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="chk" style="margin-top:10px"><input type="checkbox" name="paid" value="1" ${paid ? 'checked' : ''}> Disclosed pay only</label></div>
      <label class="field"><span>Sort by</span><select name="sort"><option value="recent" ${sort === 'recent' ? 'selected' : ''}>Most recent</option><option value="salary" ${sort === 'salary' ? 'selected' : ''}>Highest pay</option><option value="deadline" ${sort === 'deadline' ? 'selected' : ''}>Closing soonest</option></select></label>
      <button class="btn block" type="submit">Apply filters</button>
      <a class="meta" style="display:block;text-align:center;margin-top:12px" href="/jobs">Reset</a>
    </form>
    <p class="muted" style="font-size:16px;margin-top:20px">Don't see the right role? <a href="/alerts">Set up a job alert</a>.</p>
  </aside>
  <section style="grid-column:span 9">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:22px;border-bottom:1px solid var(--ink);padding-bottom:14px">
      <h1 class="h-sec" style="font-size:22px">${num(total)} open role${total === 1 ? '' : 's'}${category ? ` · ${esc(category)}` : ''}</h1>
      <span class="meta">Page ${page} of ${pages}</span></div>
    ${rows.length ? `<div class="rows">${rows.map(V.jobRow).join('')}</div>` :
      `<div class="empty"><h3>No roles match these filters</h3><p class="muted">Try removing a filter, or get an email when something matching is posted.</p><div style="display:flex;gap:10px;justify-content:center"><a class="btn sec2" href="/jobs">Reset search</a><a class="btn" href="/alerts">Create alert</a></div></div>`}
    <div style="margin-top:32px;border-top:1px solid var(--ink);padding-top:22px">${V.pager(page, pages, (n) => qs({ page: n }))}</div>
  </section>
</div></section>`;
  res.send(V.layout({ title: category ? `${category} jobs` : 'Find jobs', desc: `Browse ${total} open civic leadership roles.`, body, active: '/jobs', path: '/jobs', noindex: !!(kw || loc || mode || min || paid || page > 1) }));
});

router.get('/jobs/:slug', (req, res, next) => {
  const j = q.get("SELECT * FROM jobs WHERE slug = ? AND status != 'draft'", req.params.slug);
  if (!j) return next();
  const org = j.org_id ? q.get('SELECT * FROM organizations WHERE id = ?', j.org_id) : null;
  const closed = j.status === 'expired' || (j.closes_at && j.closes_at < U.today());
  const related = q.all(`SELECT * FROM jobs j WHERE ${LIVE_SQL} AND j.category = ? AND j.id != ? ORDER BY j.posted_at DESC LIMIT 3`, j.category, j.id);
  const pay = U.salaryDisplay(j);
  const applyBtn = closed ? '<div class="chip red" style="display:block;text-align:center;padding:12px">This posting has closed</div>'
    : j.apply_url ? `<a class="btn block" rel="noopener nofollow" target="_blank" href="${esc(j.apply_url)}">Apply on employer site →</a>`
    : j.apply_email ? `<a class="btn block" href="mailto:${esc(j.apply_email)}?subject=${encodeURIComponent('Application: ' + j.title)}">Apply by email →</a>`
    : '<p class="muted" style="margin:0">Contact the organization directly to apply.</p>';
  const body = `
<section class="wrap" style="border-bottom:1px solid var(--hair);padding-top:12px;padding-bottom:12px"><div class="max" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
  <a class="crumb" href="/jobs">← Back to active postings</a>
  <span class="meta-sm">Role #${String(j.id).padStart(5, '0')} · Posted ${esc(U.fmtDate(j.posted_at))}</span></div></section>
<section class="wrap" style="border-bottom:1px solid var(--ink);padding-top:44px;padding-bottom:44px"><div class="max">
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px"><span class="chip dark">${esc(j.category || 'Civic')}</span>${j.work_mode ? `<span class="chip plain">${esc(j.work_mode)}</span>` : ''}${j.featured ? '<span class="chip">Featured</span>' : ''}${V.chipDeadline(j.closes_at)}</div>
  <h1 class="display" style="font-size:clamp(32px,4.6vw,52px);line-height:1.04;max-width:20em">${esc(j.title)}</h1>
  <p style="margin:14px 0 0;font-size:22px"><b class="display" style="font-size:15px;letter-spacing:.04em;text-transform:uppercase">${org ? `<a href="/organizations/${esc(org.slug)}" style="text-decoration:none">${esc(j.org_name)}</a>` : esc(j.org_name)}</b>${j.location ? ` <span class="muted">—</span> <span class="italic muted">${esc(j.location)}</span>` : ''}</p>
  <div class="dl">
    <div><span class="meta">Compensation</span><b>${pay ? esc(pay) : 'Not disclosed'}</b></div>
    <div><span class="meta">Location</span><b>${esc(j.location || '—')}</b></div>
    <div><span class="meta">Work mode</span><b>${esc(j.work_mode || 'See posting')}</b></div>
    <div><span class="meta">Discipline</span><b>${esc(j.category || '—')}</b></div>
    <div><span class="meta">Posted</span><b>${esc(U.fmtDate(j.posted_at) || '—')}</b></div>
    <div><span class="meta">Apply by</span><b>${esc(U.fmtDate(j.closes_at) || 'Open until filled')}</b></div>
  </div>
</div></section>
<section class="wrap" style="padding-top:48px;padding-bottom:72px"><div class="max g12">
  <article class="c8 prose">
    ${closed ? '<div class="flash err">This role has closed. <a href="/jobs">Browse open roles</a>.</div>' : ''}
    <h2 style="margin-top:0">About the role</h2>
    ${j.description ? U.renderText(j.description) : `<p>${esc(j.org_name)} is hiring a ${esc(j.title)}. Use the apply link for the full position description.</p>`}
    <div style="margin-top:40px;padding-top:24px;border-top:1px solid var(--hair)" class="noprint">${applyBtn}</div>
    <p class="muted" style="font-size:15px;margin-top:24px">Always confirm details with the hiring organization. ${esc(allSettings().site_name)} never charges candidates and will never ask for payment or personal financial information.</p>
  </article>
  <aside class="c4 side noprint">
    <div class="panel" style="background:#fff"><div class="panel-head"><span class="label">Apply</span><span class="label" style="color:var(--forest)">${closed ? 'Closed' : 'Open'}</span></div>
      ${applyBtn}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button class="btn sec2 sm" data-save="${esc(j.slug)}" type="button">☆ Save</button>
        <button class="btn sec2 sm" type="button" onclick="window.print()">Print</button></div>
      <button class="btn sec2 sm block" style="margin-top:8px" type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href).then(function(){this.textContent='Link copied'}.bind(this))">Copy link</button></div>
    ${org ? `<div class="panel" style="background:#fff"><div class="panel-head"><span class="label">Organization</span><span class="label" style="color:var(--ink)">${esc([org.city, org.state].filter(Boolean).join(', '))}</span></div>
      <h3 style="font-size:16px;text-transform:uppercase;margin-bottom:6px">${esc(org.name)}</h3>
      ${org.description ? `<p class="muted" style="font-size:16px;margin:0 0 12px">${esc(org.description.slice(0, 180))}</p>` : ''}
      <a class="label" style="color:var(--forest)" href="/organizations/${esc(org.slug)}">All roles from this organization →</a>
      ${org.website ? `<br><a class="label" style="color:var(--forest)" rel="noopener" target="_blank" href="${esc(org.website)}">Website ↗</a>` : ''}</div>` : ''}
  </aside>
</div></section>
${related.length ? `<section class="wrap band-sage" style="padding-top:56px;padding-bottom:56px;border-top:1px solid var(--hair)"><div class="max"><h2 class="h-sec" style="font-size:24px;margin-bottom:24px">Related roles</h2><div class="rows">${related.map(V.jobRow).join('')}</div></div></section>` : ''}`;
  res.send(V.layout({ title: `${j.title} — ${j.org_name}`, desc: (j.description || '').replace(/\s+/g, ' ').slice(0, 155) || `${j.title} at ${j.org_name}`, body, active: '/jobs', path: '/jobs/' + j.slug, jsonld: closed ? '' : V.jobPostingLd(j) }));
});

router.get('/api/jobs-html', (req, res) => {
  const slugs = String(req.query.slugs || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!slugs.length) return res.send('');
  const rows = q.all(`SELECT * FROM jobs j WHERE ${LIVE_SQL} AND j.slug IN (${slugs.map(() => '?').join(',')})`, ...slugs);
  res.send(rows.length ? `<div class="rows">${rows.map(V.jobRow).join('')}</div>` : '');
});

router.get('/saved', (req, res) => {
  const body = `<section class="wrap" style="padding-top:56px;padding-bottom:80px"><div class="max"><span class="label">Your shortlist</span><h1 class="h-sec" style="margin:6px 0 8px">Saved roles</h1>
  <p class="muted" style="margin:0 0 32px">Saved roles are stored in this browser — no account needed.</p><div id="saved-list"></div></div></section>`;
  res.send(V.layout({ title: 'Saved roles', body, path: '/saved', noindex: true }));
});

/* ------------------------------ ORGS ------------------------------ */
router.get('/organizations', (req, res) => {
  const kw = String(req.query.q || '').trim();
  const params = [];
  let where = `1=1`;
  if (kw) { where += ' AND (o.name LIKE ? OR o.city LIKE ? OR o.state LIKE ?)'; params.push(...Array(3).fill(`%${kw}%`)); }
  const orgs = q.all(`SELECT o.*, (SELECT COUNT(*) FROM jobs j WHERE j.org_id = o.id AND ${LIVE_SQL}) open FROM organizations o WHERE ${where} ORDER BY open DESC, o.name LIMIT 200`, ...params);
  const body = `<section class="wrap" style="padding-top:56px;padding-bottom:80px"><div class="max">
  <div class="sec-head"><div><span class="label" style="display:block;margin-bottom:6px">Institutional roster</span><h1 class="h-sec">Organizations</h1></div>
  <form method="get" style="display:flex;gap:8px"><input type="search" name="q" value="${esc(kw)}" placeholder="Search organizations" style="width:260px"><button class="btn" type="submit">Search</button></form></div>
  ${orgs.length ? `<div class="grid g4">${orgs.map(orgCard).join('')}</div>` : '<div class="empty"><h3>No organizations found</h3></div>'}</div></section>`;
  res.send(V.layout({ title: 'Organizations', desc: 'Economic development organizations, chambers, foundations and civic institutions that are hiring.', body, active: '/organizations', path: '/organizations' }));
});

router.get('/organizations/:slug', (req, res, next) => {
  const o = q.get('SELECT * FROM organizations WHERE slug = ?', req.params.slug);
  if (!o) return next();
  const jobs = q.all(`SELECT * FROM jobs j WHERE ${LIVE_SQL} AND j.org_id = ? ORDER BY j.featured DESC, j.posted_at DESC`, o.id);
  const body = `<section class="wrap" style="border-bottom:1px solid var(--ink);padding-top:48px;padding-bottom:40px"><div class="max">
  <a class="crumb" href="/organizations">← All organizations</a>
  <div style="display:flex;gap:8px;margin:18px 0 12px">${o.type ? `<span class="chip dark">${esc(o.type)}</span>` : ''}${o.verified ? '<span class="chip">Verified</span>' : ''}</div>
  <h1 class="display" style="font-size:clamp(30px,4.4vw,52px);line-height:1.05">${esc(o.name)}</h1>
  <p class="muted" style="margin:10px 0 0;font-size:20px">${esc([o.city, o.state].filter(Boolean).join(', '))}${o.website ? ` · <a href="${esc(o.website)}" rel="noopener" target="_blank">Website ↗</a>` : ''}</p>
  ${o.description ? `<p class="prose" style="margin:18px 0 0;font-size:20px">${esc(o.description)}</p>` : ''}</div></section>
  <section class="wrap" style="padding-top:44px;padding-bottom:80px"><div class="max"><h2 class="h-sec" style="font-size:24px;margin-bottom:22px">${jobs.length} open role${jobs.length === 1 ? '' : 's'}</h2>
  ${jobs.length ? `<div class="rows">${jobs.map(V.jobRow).join('')}</div>` : '<div class="empty"><p class="muted">No open roles right now. <a href="/alerts">Get alerts</a> for new postings.</p></div>'}</div></section>`;
  res.send(V.layout({ title: o.name, desc: `Open roles at ${o.name}.`, body, active: '/organizations', path: '/organizations/' + o.slug }));
});

/* ------------------------------ JOURNAL ------------------------------ */
router.get('/journal', (req, res) => {
  const posts = q.all("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC");
  const body = `<section class="wrap" style="padding-top:56px;padding-bottom:80px"><div class="max">
  <div class="sec-head"><div><span class="label" style="display:block;margin-bottom:6px">The journal</span><h1 class="h-sec">Civic practice &amp; essays</h1></div></div>
  ${posts.length ? `<div class="grid g3 articles">${posts.map(postCard).join('')}</div>` : '<div class="empty"><h3>Essays are on the way</h3><p class="muted">Get new pieces and job alerts by email.</p><a class="btn" href="/alerts">Subscribe</a></div>'}</div></section>`;
  res.send(V.layout({ title: 'Journal', body, active: '/journal', path: '/journal' }));
});
router.get('/journal/:slug', (req, res, next) => {
  const p = q.get("SELECT * FROM posts WHERE slug = ? AND status='published'", req.params.slug);
  if (!p) return next();
  const body = `<article class="wrap" style="padding-top:48px;padding-bottom:80px"><div class="max" style="max-width:820px">
  <a class="crumb" href="/journal">← Journal</a>
  <div class="meta" style="margin:22px 0 10px">${esc(p.kicker || 'Essay')} · ${esc(U.fmtDate(p.published_at))} · ${p.read_minutes} min read</div>
  <h1 class="display" style="font-size:clamp(30px,4.4vw,48px);line-height:1.06;margin-bottom:28px">${esc(p.title)}</h1>
  ${p.summary ? `<p class="lede italic" style="margin-bottom:28px">${esc(p.summary)}</p>` : ''}
  <div class="prose">${U.renderText(p.body)}</div></div></article>`;
  res.send(V.layout({ title: p.title, desc: p.summary, body, active: '/journal', path: '/journal/' + p.slug }));
});

/* ------------------------------ EMPLOYERS / POST ------------------------------ */
router.get('/employers', (req, res) => {
  const s = allSettings();
  const body = `<section class="hero wrap" style="padding-top:64px;padding-bottom:64px"><div class="max g12"><div class="c7">
  <span class="chip">For employers</span><h1 class="display" style="font-size:clamp(38px,6vw,72px);margin:20px 0">Hire civic leaders.</h1>
  <p class="lede">Reach economic developers, chamber executives, foundation officers and place managers — without wading through generic job-board noise.</p>
  <div style="display:flex;gap:12px;margin-top:30px;flex-wrap:wrap"><a class="btn" href="/post-a-role">Post a role — $${esc(s.post_price)}</a>${s.contact_email ? `<a class="btn sec2" href="mailto:${esc(s.contact_email)}">Talk to us</a>` : ''}</div></div>
  <div class="c5 panel"><div class="panel-head"><span class="label" style="color:var(--ink)">Standard posting</span><span class="label">30 days</span></div>
  <div class="display num" style="font-size:54px;margin:8px 0 14px">$${esc(s.post_price)}</div>
  <ul style="padding-left:20px;margin:0 0 20px"><li>Listed in search, category pages and your organization page</li><li>Google-for-Jobs structured data for extra reach</li><li>Included in the next job-alert dispatch</li><li>Edits and early close on request</li></ul>
  <a class="btn block" href="/post-a-role">Start your posting</a></div></div></section>
  <section class="sec wrap" style="border-bottom:0"><div class="max"><div class="sec-head"><h2 class="h-sec">How it works</h2></div>
  <div class="grid g3">${[['01', 'Submit', 'Tell us about the role in about five minutes. Pay ranges are required — it is how candidates here expect to see jobs.'], ['02', 'Review', 'We review every posting, usually within one business day, and may reach out with edits.'], ['03', 'Go live', 'Your role is published, sent to subscribers and indexed for search. Candidates apply directly on your site.']].map(([n, t, d]) => `<div class="card"><span class="meta">Step ${n}</span><h3 style="font-size:22px;text-transform:uppercase;margin:10px 0">${t}</h3><p class="muted" style="margin:0">${d}</p></div>`).join('')}</div>
  <p class="muted" style="margin-top:30px">Have many openings? Send us a spreadsheet or your careers-page link and we'll load them in bulk${s.contact_email ? ` — <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>` : ''}.</p></div></section>`;
  res.send(V.layout({ title: 'For employers', desc: 'Post a civic leadership role.', body, active: '/employers', path: '/employers' }));
});

const postForm = (v = {}, err = '') => `
<section class="wrap" style="padding-top:56px;padding-bottom:80px"><div class="max" style="max-width:860px">
  <span class="label">For employers</span><h1 class="h-sec" style="margin:6px 0 10px">Post a role</h1>
  <p class="muted" style="margin:0 0 30px">Submit your opening for review. We'll email you within one business day. Standard posting: <b>$${esc(allSettings().post_price)}</b> for 30 days.</p>
  ${err ? `<div class="flash err">${esc(err)}</div>` : ''}
  <form method="post" action="/post-a-role" class="panel" style="background:#fff;padding:36px">
    <input type="text" name="website_url" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.14em;border-bottom:1px solid var(--ink);padding-bottom:10px;margin-bottom:20px">Your organization</h3>
    <div class="grid g2"><label class="field"><span>Organization name *</span><input type="text" name="org_name" required value="${esc(v.org_name)}"></label>
    <label class="field"><span>Organization website</span><input type="url" name="website" placeholder="https://" value="${esc(v.website)}"></label>
    <label class="field"><span>Your name *</span><input type="text" name="contact_name" required value="${esc(v.contact_name)}"></label>
    <label class="field"><span>Your email *</span><input type="email" name="contact_email" required value="${esc(v.contact_email)}"></label></div>
    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.14em;border-bottom:1px solid var(--ink);padding-bottom:10px;margin:14px 0 20px">The role</h3>
    <label class="field"><span>Job title *</span><input type="text" name="title" required value="${esc(v.title)}"></label>
    <div class="grid g3"><label class="field"><span>Location *</span><input type="text" name="location" required placeholder="City, ST" value="${esc(v.location)}"></label>
    <label class="field"><span>Work mode</span><select name="work_mode">${['', ...U.WORK_MODES].map((m) => `<option ${v.work_mode === m ? 'selected' : ''} value="${m}">${m || 'Select'}</option>`).join('')}</select></label>
    <label class="field"><span>Discipline</span><select name="category">${CATEGORIES.map((c) => `<option ${v.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label class="field"><span>Salary range *</span><input type="text" name="salary" required placeholder="$95,000 – $115,000" value="${esc(v.salary)}"></label>
    <label class="field"><span>Apply by</span><input type="date" name="closes_at" value="${esc(v.closes_at)}"></label>
    <label class="field"><span>Apply link or email *</span><input type="text" name="apply" required placeholder="https://… or jobs@org.org" value="${esc(v.apply)}"></label></div>
    <label class="field"><span>Description *</span><textarea name="description" required rows="10" placeholder="Responsibilities, qualifications, how to apply…">${esc(v.description)}</textarea><small>Plain text. Blank line = new paragraph; start lines with "-" for bullets.</small></label>
    <button class="btn" type="submit">Submit for review</button>
  </form></div></section>`;

router.get('/post-a-role', (req, res) => res.send(V.layout({ title: 'Post a role', body: postForm(), active: '/employers', path: '/post-a-role' })));
router.post('/post-a-role', (req, res) => {
  const b = req.body || {};
  if (b.website_url) return res.redirect('/post-a-role/thanks'); // honeypot
  if (limited(req, 'post', 5)) return res.status(429).send(V.layout({ title: 'Slow down', body: '<div class="wrap" style="padding:80px 0"><div class="max"><h1 class="h-sec">Too many submissions</h1><p>Please try again later.</p></div></div>', path: '/post-a-role' }));
  const need = ['org_name', 'contact_name', 'contact_email', 'title', 'location', 'salary', 'apply', 'description'];
  const missing = need.filter((k) => !String(b[k] || '').trim());
  if (missing.length || !/@/.test(b.contact_email)) return res.status(400).send(V.layout({ title: 'Post a role', body: postForm(b, 'Please fill in all required fields with a valid email.'), active: '/employers', path: '/post-a-role' }));
  q.run('INSERT INTO submissions(data) VALUES(?)', JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v).slice(0, 20000)]))));
  res.redirect('/post-a-role/thanks');
});
router.get('/post-a-role/thanks', (req, res) => {
  const s = allSettings();
  const body = `<section class="wrap" style="padding-top:80px;padding-bottom:100px"><div class="max" style="max-width:720px;text-align:center"><span class="chip">Received</span><h1 class="h-sec" style="margin:18px 0 14px">Thank you — your posting is in review.</h1>
  <p class="lede" style="margin:0 auto 26px">We'll email you within one business day.${s.payment_link ? ' To publish, please complete payment below.' : ''}</p>
  ${s.payment_link ? `<a class="btn" rel="noopener" href="${esc(s.payment_link)}">Pay $${esc(s.post_price)} to publish →</a>` : ''}
  <p style="margin-top:30px"><a href="/jobs">Browse jobs</a></p></div></section>`;
  res.send(V.layout({ title: 'Submission received', body, path: '/post-a-role/thanks', noindex: true }));
});

/* ------------------------------ ALERTS ------------------------------ */
router.get('/alerts', (req, res) => {
  const ok = req.query.ok;
  const body = `<section class="wrap" style="padding-top:64px;padding-bottom:90px"><div class="max" style="max-width:720px">
  <span class="label">Job alerts</span><h1 class="display" style="font-size:clamp(34px,5vw,58px);margin:12px 0 18px">Leadership vacancies, delivered.</h1>
  <p class="lede" style="margin-bottom:28px">Curated email dispatches of new roles across civic and economic development. Unsubscribe anytime.</p>
  ${ok ? '<div class="flash">You\'re on the list — thank you.</div>' : ''}${req.query.err ? '<div class="flash err">Please enter a valid email address.</div>' : ''}
  <form method="post" action="/subscribe" class="panel" style="background:#fff"><label class="field"><span>Email address</span><input type="email" name="email" required></label>
  <div class="grid g3" style="gap:8px;margin-bottom:16px">${[['weekly', 'Weekly'], ['biweekly', 'Bi-weekly'], ['daily', 'Daily']].map(([v, l], i) => `<label class="chip plain" style="padding:10px;text-align:center;cursor:pointer"><input type="radio" name="frequency" value="${v}" ${i === 0 ? 'checked' : ''} style="accent-color:#244637"> ${l}</label>`).join('')}</div>
  <input type="hidden" name="back" value="/alerts"><button class="btn block" type="submit">Subscribe</button></form></div></section>`;
  res.send(V.layout({ title: 'Job alerts', body, path: '/alerts' }));
});
router.post('/subscribe', (req, res) => {
  const { email = '', frequency = 'weekly', back = '/alerts' } = req.body || {};
  const e = String(email).trim().toLowerCase();
  const dest = /^\/[a-z0-9/_-]*$/i.test(back) ? back : '/alerts';
  const sep = (u) => (u.includes('?') ? '&' : '?');
  if (limited(req, 'sub', 10) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.redirect('/alerts?err=1');
  q.run('INSERT INTO subscribers(email, frequency) VALUES(?, ?) ON CONFLICT(email) DO UPDATE SET frequency = excluded.frequency', e, ['weekly', 'biweekly', 'daily'].includes(frequency) ? frequency : 'weekly');
  res.redirect('/alerts?ok=1');
});

/* ------------------------------ SALARY ------------------------------ */
router.get('/salary', (req, res) => {
  const rows = q.all(`SELECT category, salary_min, salary_max FROM jobs j WHERE ${LIVE_SQL} AND salary_min IS NOT NULL`);
  const by = {};
  rows.forEach((r) => { (by[r.category || 'Other'] ||= []).push(r); });
  const stats = Object.entries(by).map(([c, a]) => ({ c, n: a.length, lo: median(a.map((x) => x.salary_min)), hi: median(a.map((x) => x.salary_max || x.salary_min)) })).sort((a, b) => b.hi - a.hi);
  const maxHi = Math.max(1, ...stats.map((s) => s.hi || 0));
  const body = `<section class="wrap" style="padding-top:56px;padding-bottom:80px"><div class="max" style="max-width:980px">
  <span class="label">Salary census</span><h1 class="h-sec" style="margin:6px 0 10px">What civic roles pay</h1>
  <p class="muted" style="margin:0 0 30px">Median disclosed pay range by discipline, calculated live from ${rows.length} currently open roles that publish a salary. Small samples vary — treat as a directional guide.</p>
  ${stats.length ? `<div class="bars">${stats.map((s) => `<div class="bar"><div><b>${esc(s.c)}</b><div class="meta-sm">${s.n} role${s.n === 1 ? '' : 's'}</div></div><div class="track"><div class="fill" style="width:${Math.round((s.hi / maxHi) * 100)}%"></div></div><div class="num"><b>$${Math.round(s.lo / 1000)}K–$${Math.round(s.hi / 1000)}K</b></div></div>`).join('')}</div>` : '<div class="empty"><p class="muted">Not enough roles with disclosed pay yet.</p></div>'}
  </div></section>`;
  res.send(V.layout({ title: 'Salary census', desc: 'Median pay for civic and economic development leadership roles.', body, path: '/salary' }));
});

/* ------------------------------ STATIC PAGES ------------------------------ */
const simple = (title, html, path) => (req, res) => res.send(V.layout({ title, body: `<section class="wrap" style="padding-top:56px;padding-bottom:90px"><div class="max prose"><span class="label">${esc(title)}</span><h1 class="h-sec" style="margin:6px 0 24px">${esc(title)}</h1>${html}</div></section>`, path }));
const site = () => esc(allSettings().site_name);
router.get('/about', (req, res, next) => simple('About', `<p>${site()} is a career registry for the people who build and steward places: economic developers, chamber and association executives, community-foundation officers, downtown and Main Street managers, and community-capital leaders.</p><p>We list roles with published pay ranges, link candidates directly to the employer's application, and never charge job seekers.</p><h2>Contact</h2><p>${allSettings().contact_email ? `<a href="mailto:${esc(allSettings().contact_email)}">${esc(allSettings().contact_email)}</a>` : 'Use the <a href="/post-a-role">employer form</a> to reach us.'}</p>`, '/about')(req, res, next));
router.get('/privacy', (req, res, next) => simple('Privacy', `<p><i>Last updated ${esc(U.fmtDate(U.today()))}.</i></p><h2>What we collect</h2><p>If you subscribe to job alerts we store your email address and frequency. If an employer submits a role we store the details they enter, including a contact name and email. Saved jobs are stored only in your own browser.</p><h2>How we use it</h2><p>Emails are used to send the alerts you requested and to respond to employers. We do not sell personal information.</p><h2>Your choices</h2><p>Ask us to remove your email at any time and we will do so promptly.</p><h2>Cookies</h2><p>The public site does not use advertising cookies. A session cookie is used only for administrators.</p>`, '/privacy')(req, res, next));
router.get('/terms', (req, res, next) => simple('Terms', `<p><i>Last updated ${esc(U.fmtDate(U.today()))}.</i></p><p>${site()} lists job postings supplied by employers and third-party sources. We do not guarantee the accuracy, availability or outcome of any posting. Always verify details with the hiring organization and never send payment or financial details to a prospective employer.</p><p>Employers are responsible for the accuracy and legality of their postings. We may edit or remove any posting at our discretion. Postings fees, once a role is published, are non-refundable except where we remove a posting for our own reasons.</p>`, '/terms')(req, res, next));

/* ------------------------------ SEO ------------------------------ */
router.get('/robots.txt', (req, res) => {
  const base = (allSettings().site_url || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
});
router.get('/sitemap.xml', (req, res) => {
  const base = (allSettings().site_url || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const urls = ['/', '/jobs', '/organizations', '/journal', '/employers', '/salary', '/alerts', '/about'].map((p) => ({ loc: p }));
  q.all(`SELECT slug, updated_at FROM jobs j WHERE ${LIVE_SQL}`).forEach((j) => urls.push({ loc: '/jobs/' + j.slug, last: j.updated_at }));
  q.all('SELECT slug FROM organizations').forEach((o) => urls.push({ loc: '/organizations/' + o.slug }));
  q.all("SELECT slug FROM posts WHERE status='published'").forEach((p) => urls.push({ loc: '/journal/' + p.slug }));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(base + u.loc)}</loc>${u.last ? `<lastmod>${esc(String(u.last).slice(0, 10))}</lastmod>` : ''}</url>`).join('')}</urlset>`);
});
router.get('/favicon.svg', (req, res) => res.type('image/svg+xml').send(V.FAVICON));

module.exports = router;

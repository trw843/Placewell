const { esc, salaryDisplay, daysUntil, fmtDate, CATEGORIES } = require('./util');
const { allSettings } = require('./db');

const FONTS = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700&family=Space+Grotesk:wght@400;500;600;700&display=swap';

function layout({ title, desc, body, active = '', path = '/', canonical, noindex = false, jsonld = '' }) {
  const s = allSettings();
  const site = s.site_name || 'Placewell';
  const fullTitle = title ? `${title} — ${site}` : `${site} — Careers for People Who Strengthen Communities`;
  const description = desc || 'The career registry for economic development, chambers of commerce, community foundations, downtown organizations and civic capital.';
  const base = (s.site_url || '').replace(/\/$/, '');
  const nav = [
    ['/jobs', 'Find Jobs'], ['/organizations', 'Organizations'], ['/journal', 'Journal'], ['/employers', 'For Employers'],
  ];
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
${base ? `<link rel="canonical" href="${esc(base + (canonical || path))}">` : ''}
<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website">
<meta name="theme-color" content="#244637">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/style.css">
${jsonld}
</head><body>
<a class="skip" href="#main">Skip to content</a>
${s.announcement ? `<div class="announce">${esc(s.announcement)}</div>` : ''}
<header class="hdr"><div class="hdr-in wrap">
  <a class="brand" href="/"><div class="logo">PW</div><div><div class="brand-name">${esc(site)}</div><div class="brand-sub">Civic Career Registry</div></div></a>
  <nav class="nav" id="nav" aria-label="Primary">
    ${nav.map(([h, l]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${l}</a>`).join('')}
  </nav>
  <div class="hdr-actions">
    <a class="nav-saved meta" href="/saved" style="text-decoration:none">Saved <span id="saved-count"></span></a>
    <a class="btn" href="/post-a-role">Post a Role</a>
    <button class="burger" id="burger" aria-label="Menu" aria-expanded="false">Menu</button>
  </div>
</div></header>
<main id="main">${body}</main>
<footer class="ftr wrap"><div class="max">
  <div class="cols">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div class="logo" style="width:28px;height:28px;font-size:11px">PW</div><span class="brand-name" style="font-size:20px">${esc(site)}</span></div>
      <p class="italic muted" style="font-size:21px;margin:0 0 10px">${esc(s.tagline)}</p>
      <p class="muted" style="max-width:26em;margin:0 0 22px;font-size:17px">The career platform for executives and practitioners shaping resilient towns, cities and regions across North America.</p>
      <span class="label" style="display:block;margin-bottom:6px">Job alerts</span>
      <form class="joinrow" method="post" action="/subscribe"><input type="email" name="email" placeholder="Your email" required aria-label="Email"><input type="hidden" name="back" value="${esc(path)}"><button class="btn sm" type="submit">Join</button></form>
    </div>
    <div><h5>Directory</h5><ul><li><a href="/jobs">All postings</a></li><li><a href="/alerts">Job alerts</a></li><li><a href="/salary">Salary census</a></li><li><a href="/journal">Journal</a></li><li><a href="/saved">Saved jobs</a></li></ul></div>
    <div><h5>Employers</h5><ul><li><a href="/post-a-role">Post a role</a></li><li><a href="/employers">Pricing &amp; services</a></li><li><a href="/organizations">Organizations</a></li><li><a href="/about">About</a></li></ul></div>
    <div><h5>Civic sectors</h5><ul>${CATEGORIES.slice(0, 6).map((c) => `<li><a href="/jobs?category=${encodeURIComponent(c)}">${esc(c)}</a></li>`).join('')}</ul></div>
  </div>
  <div class="base"><div>© ${new Date().getFullYear()} ${esc(site)}. Established for public service.</div>
    <div style="display:flex;gap:24px;flex-wrap:wrap"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/about">About</a><a href="/sitemap.xml">Sitemap</a></div></div>
</div></footer>
<script src="/app.js" defer></script>
</body></html>`;
}

function chipDeadline(closes) {
  const d = daysUntil(closes);
  if (d == null) return '';
  if (d < 0) return '<span class="chip red">Closed</span>';
  if (d <= 2) return `<span class="chip red">Closes in ${d <= 0 ? 'today' : d + ' day' + (d > 1 ? 's' : '')}</span>`;
  if (d <= 14) return `<span class="chip"><span class="dot"></span>${d} days left</span>`;
  return `<span class="meta-sm">Closes ${esc(fmtDate(closes))}</span>`;
}

function jobRow(j) {
  const pay = salaryDisplay(j);
  const fresh = j.posted_at && daysUntil(j.posted_at) != null && daysUntil(j.posted_at) > -4;
  return `<article class="job${j.featured ? ' feat' : ''}">
  <div style="flex:1;min-width:0">
    <div class="tops">
      ${j.featured ? '<span class="chip">Featured</span>' : ''}${fresh && !j.featured ? '<span class="chip plain">New</span>' : ''}
      <span class="meta-sm">${esc(j.category || '')}</span>${chipDeadline(j.closes_at) ? ' ' + chipDeadline(j.closes_at) : ''}
    </div>
    <h3><a href="/jobs/${esc(j.slug)}">${esc(j.title)}</a></h3>
    <div class="sub"><strong>${esc(j.org_name)}</strong>${j.location ? `<span>·</span><span>${esc(j.location)}</span>` : ''}${j.work_mode ? `<span class="chip plain">${esc(j.work_mode)}</span>` : ''}</div>
  </div>
  <div class="right">
    <div>${pay ? `<div class="pay num">${esc(pay)}</div><div class="meta-sm">Disclosed pay</div>` : '<div class="meta-sm">Pay not disclosed</div>'}</div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="save" data-save="${esc(j.slug)}" aria-label="Save job" title="Save job">☆</button>
      <a class="btn sm" href="/jobs/${esc(j.slug)}">View role</a>
    </div>
  </div>
</article>`;
}

function pager(page, pages, makeUrl) {
  if (pages <= 1) return '';
  const nums = new Set([1, pages, page - 1, page, page + 1]);
  const list = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = page > 1 ? `<a href="${makeUrl(page - 1)}">Prev</a>` : '<span class="dis">Prev</span>';
  let last = 0;
  for (const n of list) {
    if (n - last > 1) html += '<span class="dis">…</span>';
    html += n === page ? `<span class="cur">${n}</span>` : `<a href="${makeUrl(n)}">${n}</a>`;
    last = n;
  }
  html += page < pages ? `<a href="${makeUrl(page + 1)}">Next</a>` : '<span class="dis">Next</span>';
  return `<nav class="pager" aria-label="Pagination">${html}</nav>`;
}

function jobPostingLd(j, base) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: j.title, description: (j.description || j.title).replace(/\n/g, '<br>'),
    datePosted: j.posted_at, hiringOrganization: { '@type': 'Organization', name: j.org_name },
    employmentType: 'FULL_TIME',
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.city || undefined, addressRegion: j.state || undefined, addressCountry: 'US' } },
  };
  if (j.closes_at) ld.validThrough = j.closes_at;
  if (j.work_mode === 'Remote') ld.jobLocationType = 'TELECOMMUTE';
  if (j.salary_min) ld.baseSalary = { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: j.salary_min, maxValue: j.salary_max || j.salary_min, unitText: 'YEAR' } };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

// An original architectural streetscape line drawing for the hero (inline SVG, no external image).
const HERO_SVG = `<svg viewBox="0 0 520 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Line drawing of a town main street with a civic hall, shops and street trees" fill="none" stroke="#171A17" stroke-width="1.3" stroke-linejoin="round">
  <rect x="0" y="0" width="520" height="360" fill="#FAFAF6" stroke="none"/>
  <g stroke="#E4E5DD"><path d="M0 300H520M0 330H520"/><path d="M60 0V360M130 0V360M200 0V360M270 0V360M340 0V360M410 0V360M480 0V360" stroke-dasharray="2 6"/></g>
  <path d="M0 300H520" stroke="#171A17"/>
  <!-- civic hall -->
  <g><path d="M170 300V170H350V300"/><path d="M150 170L260 100L370 170Z" fill="#E2ECCF"/><path d="M170 170H350"/>
  <path d="M190 300V190M215 300V190M240 300V190M280 300V190M305 300V190M330 300V190"/><rect x="236" y="236" width="48" height="64" fill="#FAFAF6"/><path d="M260 236V300"/>
  <circle cx="260" cy="140" r="14" fill="#FAFAF6"/><path d="M260 140V130M260 140H268"/><path d="M260 100V78M260 78H276V88H260" /></g>
  <!-- shops left -->
  <g><path d="M30 300V210H150V300"/><path d="M30 210H150"/><path d="M30 224H150" stroke-dasharray="3 3"/><rect x="44" y="244" width="30" height="40" fill="#E2ECCF"/><rect x="88" y="244" width="46" height="40" fill="#E2ECCF"/><path d="M26 210L90 190L154 210"/></g>
  <!-- shops right -->
  <g><path d="M370 300V200H490V300"/><path d="M366 200H494"/><rect x="384" y="226" width="26" height="34"/><rect x="424" y="226" width="26" height="34"/><rect x="458" y="250" width="22" height="50" fill="#E2ECCF"/><path d="M370 214H490" stroke-dasharray="3 3"/></g>
  <!-- trees -->
  <g><path d="M12 300V262"/><circle cx="12" cy="248" r="16" fill="#E2ECCF"/><path d="M158 300V274"/><circle cx="158" cy="264" r="12" fill="#E2ECCF"/><path d="M362 300V274"/><circle cx="362" cy="264" r="12" fill="#E2ECCF"/><path d="M508 300V262"/><circle cx="508" cy="248" r="16" fill="#E2ECCF"/></g>
  <!-- lamp -->
  <path d="M100 300V262M100 262H112" /><circle cx="114" cy="262" r="3" fill="#171A17"/>
  <g font-family="Space Grotesk,sans-serif" font-size="9" fill="#5B6358" stroke="none" letter-spacing="1.2"><text x="14" y="346">ELEVATION A — MAIN STREET</text><text x="388" y="346">SCALE 1:200</text></g>
</svg>`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#171A17"/><text x="16" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="14" fill="#FAFAF6">PW</text></svg>`;

module.exports = { layout, jobRow, pager, jobPostingLd, chipDeadline, HERO_SVG, FAVICON };

const crypto = require('crypto');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const slugify = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

const CATEGORIES = [
  'Economic Development',
  'Chambers of Commerce',
  'Community Foundations',
  'Place-Based Leadership',
  'CDFIs & Community Capital',
  'Higher Ed Civic Practice',
  'Other Civic & Nonprofit',
];

const CATEGORY_BLURBS = {
  'Economic Development': 'Regional alliances, county authorities, industrial recruitment',
  'Chambers of Commerce': 'Boards of trade, commercial associations, civic policy councils',
  'Community Foundations': 'Civic grantmaking, place capital endowments, regional trusts',
  'Place-Based Leadership': 'Main Street programs, downtown improvement districts, corridors',
  'CDFIs & Community Capital': 'Revolving development funds, housing trusts, debt funds',
  'Higher Ed Civic Practice': 'Anchor institution hubs, regional research institutes, community ties',
  'Other Civic & Nonprofit': 'Councils of government, planning organizations, civic nonprofits',
};

const WORK_MODES = ['On-site', 'Hybrid', 'Remote'];

function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  if (/chamber|board of trade|business council|business alliance/.test(t)) return 'Chambers of Commerce';
  if (/community foundation|foundation|philanthrop|grantmak|endowment/.test(t)) return 'Community Foundations';
  if (/cdfi|community development financ|loan fund|capital|housing trust|credit union/.test(t)) return 'CDFIs & Community Capital';
  if (/downtown|main street|place ?manage|improvement district|bid\b|placemaking/.test(t)) return 'Place-Based Leadership';
  if (/universit|college|higher ed|institute of|anchor institution/.test(t)) return 'Higher Ed Civic Practice';
  if (/economic development|edo\b|industrial|business attraction|site selection|recruitment|workforce|port authority|regional partnership/.test(t)) return 'Economic Development';
  return 'Other Civic & Nonprofit';
}

function parseWorkMode(text) {
  const t = String(text || '').toLowerCase();
  if (/hybrid/.test(t)) return 'Hybrid';
  if (/remote|work from home|telecommut/.test(t)) return 'Remote';
  if (/on[- ]?site|in[- ]person|onsite/.test(t)) return 'On-site';
  return '';
}

function parseMoney(text) {
  // "$120,000 - $140,000", "120k-140k", "$65/hr" (hourly ignored for annual figures)
  const s = String(text || '');
  if (!s.trim()) return { min: null, max: null };
  if (/\/\s*h(ou)?r|per hour|hourly/i.test(s)) return { min: null, max: null };
  const nums = [];
  const re = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?/gi;
  let m;
  while ((m = re.exec(s))) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1000 : 1e6;
    if (n >= 20000 && n <= 2000000) nums.push(Math.round(n));
  }
  if (!nums.length) return { min: null, max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

const money = (n) => (n == null ? '' : '$' + Number(n).toLocaleString('en-US'));
function salaryDisplay(j) {
  if (j.salary_min && j.salary_max && j.salary_min !== j.salary_max) return `${money(j.salary_min)} – ${money(j.salary_max)}`;
  if (j.salary_min) return money(j.salary_min);
  return j.salary_text || '';
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const ms = new Date(dateStr + 'T23:59:59').getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Render plain-text description to safe paragraphs / bullet lists.
function renderText(text) {
  const blocks = String(text || '').split(/\n{2,}/);
  return blocks
    .map((b) => {
      const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return '';
      if (lines.every((l) => /^[•\-*]\s+/.test(l))) {
        return '<ul>' + lines.map((l) => `<li>${esc(l.replace(/^[•\-*]\s+/, ''))}</li>`).join('') + '</ul>';
      }
      return `<p>${lines.map(esc).join('<br>')}</p>`;
    })
    .join('\n');
}

const US_STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };

function splitLocation(loc) {
  const s = String(loc || '').trim();
  if (!s) return { city: '', state: '' };
  const m = s.match(/^(.*?),\s*([A-Za-z]{2}|[A-Za-z .]+)\b\.?(?:,\s*(?:US|USA|United States))?$/);
  if (m) {
    let st = m[2].trim();
    const byName = Object.entries(US_STATES).find(([, n]) => n.toLowerCase() === st.toLowerCase());
    if (byName) st = byName[0];
    return { city: m[1].trim(), state: st.length === 2 ? st.toUpperCase() : st };
  }
  return { city: s, state: '' };
}

module.exports = {
  esc, slugify, sha1, CATEGORIES, CATEGORY_BLURBS, WORK_MODES,
  guessCategory, parseWorkMode, parseMoney, money, salaryDisplay,
  parseDate, today, daysUntil, fmtDate, stripHtml, renderText, splitLocation, US_STATES,
};

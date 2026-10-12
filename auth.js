const crypto = require('crypto');
const { getSetting, setSetting } = require('./db');

function ensureSecrets() {
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    pw = getSetting('generated_admin_password');
    if (!pw) {
      pw = crypto.randomBytes(9).toString('base64url');
      setSetting('generated_admin_password', pw);
    }
    console.warn('\n  ⚠  ADMIN_PASSWORD is not set. Using a generated password:\n     ' + pw + '\n     Set ADMIN_PASSWORD in your environment to choose your own.\n');
  }
  let key = process.env.API_KEY || getSetting('api_key');
  if (!key) { key = 'pw_' + crypto.randomBytes(18).toString('hex'); setSetting('api_key', key); }
  const secret = process.env.SESSION_SECRET || crypto.createHash('sha256').update('pw-session|' + pw).digest('hex');
  return { pw, key, secret };
}
const secrets = ensureSecrets();

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const sign = (v) => crypto.createHmac('sha256', secrets.secret).update(v).digest('hex');

function makeToken() {
  const exp = String(Date.now() + 12 * 3600e3);
  return exp + '.' + sign(exp);
}
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = String(t).split('.');
  return !!exp && !!sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now();
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const isAdmin = (req) => validToken(parseCookies(req).pw_admin);
const checkPassword = (p) => safeEq(p || '', secrets.pw);
const apiKeyOk = (req) => {
  const h = req.headers.authorization || '';
  const k = h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-api-key'] || req.query.key || '';
  return !!k && safeEq(k, secrets.key);
};
const getApiKey = () => secrets.key;

module.exports = { isAdmin, checkPassword, makeToken, apiKeyOk, getApiKey };

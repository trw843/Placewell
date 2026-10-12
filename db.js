const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'placewell.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  abbr TEXT, type TEXT, description TEXT, website TEXT,
  city TEXT, state TEXT,
  verified INTEGER DEFAULT 0,
  source TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  org_name TEXT,
  category TEXT,
  city TEXT, state TEXT, location TEXT,
  work_mode TEXT,
  salary_min INTEGER, salary_max INTEGER, salary_text TEXT,
  description TEXT,
  apply_url TEXT, apply_email TEXT,
  source TEXT,
  external_id TEXT UNIQUE,
  status TEXT DEFAULT 'published',
  featured INTEGER DEFAULT 0,
  posted_at TEXT, closes_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, posted_at);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  kicker TEXT, summary TEXT, body TEXT,
  read_minutes INTEGER DEFAULT 5,
  status TEXT DEFAULT 'published',
  published_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  frequency TEXT DEFAULT 'weekly',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  default_org TEXT, default_category TEXT,
  interval_hours INTEGER DEFAULT 24,
  enabled INTEGER DEFAULT 1,
  auto_publish INTEGER DEFAULT 1,
  last_run_at TEXT, last_status TEXT, last_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, kind TEXT,
  added INTEGER DEFAULT 0, updated INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// ---- helpers: node:sqlite rejects undefined, so coerce to null ----
const clean = (args) => args.map((a) => (a === undefined ? null : a));
const q = {
  all: (sql, ...args) => db.prepare(sql).all(...clean(args)),
  get: (sql, ...args) => db.prepare(sql).get(...clean(args)),
  run: (sql, ...args) => db.prepare(sql).run(...clean(args)),
  tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};

const DEFAULT_SETTINGS = {
  site_name: 'Placewell',
  tagline: 'Good Work. Great Places.',
  contact_email: '',
  post_price: '295',
  payment_link: '',
  site_url: '',
  announcement: '',
};
function getSetting(key) {
  const row = q.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : DEFAULT_SETTINGS[key] ?? '';
}
function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of q.all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  q.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

module.exports = { db, q, DATA_DIR, getSetting, setSetting, allSettings, DEFAULT_SETTINGS };

// Usage: npm run import -- path/to/jobs.csv   (or .json)
const fs = require('fs');
const { parseCSV } = require('../lib/csv');
const { importRecords } = require('../lib/jobs');
const f = process.argv[2];
if (!f) { console.error('Usage: npm run import -- jobs.csv'); process.exit(1); }
const txt = fs.readFileSync(f, 'utf8');
let recs;
if (f.endsWith('.json')) { const j = JSON.parse(txt); recs = Array.isArray(j) ? j : j.jobs; } else recs = parseCSV(txt);
const r = importRecords(recs, { source: 'cli', kind: 'cli', autoPublish: true });
console.log(`Added ${r.added}, updated ${r.updated}, skipped ${r.skipped}`);
r.errors.slice(0, 20).forEach((e) => console.log(' -', e));

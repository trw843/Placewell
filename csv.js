// Small, dependency-free CSV parser (RFC-4180-ish). Handles quotes, commas and newlines in fields,
// BOMs, and auto-detects comma / tab / semicolon delimiters (so Excel & Google Sheets paste works).
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCSV(input) {
  let text = String(input || '').replace(/^﻿/, '');
  if (!text.trim()) return [];
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = (headers, rows) =>
  [headers.map(csvCell).join(',')].concat(rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))).join('\r\n');

module.exports = { parseCSV, toCSV };

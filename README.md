# Placewell — civic careers job board

A complete, launch-ready job board: public site, employer "Post a Role" form, admin panel, bulk import, and automated imports from other websites. One small Node app, one SQLite file, no external services. Requires Node 22.13+.

## Run it (2 minutes)
```
npm install
ADMIN_PASSWORD=choose-a-password npm start
```
Open http://localhost:3000 — admin is at /admin. In development, 8 clearly-labeled "Sample" jobs load so you can see the design. **Delete them before launch:** Admin → Settings → remove sample data.

## Launch it
- **Render (easiest):** push this folder to GitHub → Render → New → Blueprint → pick the repo (`render.yaml` includes a persistent disk). Set `ADMIN_PASSWORD` when prompted. Point your domain at it, then set the real URL in Admin → Settings.
- **Docker / VPS / Railway / Fly:** `docker build -t placewell . && docker run -p 3000:3000 -v placewell-data:/data -e ADMIN_PASSWORD=... placewell`
- **Important:** the database lives in `DATA_DIR` (default `./data`). Keep it on a persistent disk/volume or jobs are lost on redeploy. Back up by downloading `placewell.db` or Admin → Jobs → Export CSV.

Environment variables: `ADMIN_PASSWORD` (set this), `API_KEY` (optional; else generated, shown in Admin → Settings), `SESSION_SECRET` (optional), `DATA_DIR`, `PORT`, `SEED_DEMO=1` (load samples in production), `NODE_ENV=production`.

## Adding jobs

1. **Employers (no login):** `/post-a-role`. Submissions appear in Admin → Submissions → Publish / Save as draft / Reject. Set price and payment link in Admin → Settings.
2. **Admin, one at a time:** Admin → Jobs → Add job.
3. **Admin, in bulk:** Admin → Bulk Import (preview before saving; re-importing updates, never duplicates).
   - *Spreadsheet/CSV:* download the template, or use any sheet — common headers (Job Title, Company, City, Pay, Link, Deadline) are recognized.
   - *Job page links:* one URL per line; pages with standard job data import with no setup.
   - *Website / feed / Google Sheet link:* careers page, RSS, JSON, Greenhouse, Lever, or a Google Sheet (share as "anyone with the link can view").
4. **Automated from particular websites:** Admin → Auto Sources → add a name, link, and frequency. Types: Auto-detect, Google Sheet/CSV (most reliable), job-posting data, RSS, JSON, Greenhouse, Lever, custom HTML selectors. "Run now" tests it. Jobs expire on their closing date.
   *Easiest:* a shared Google Sheet your team pastes jobs into, added as an Auto Source.
5. **Zapier / Make / scripts:** `POST /api/import` with your API key (Admin → Settings). JSON array, `{"jobs":[...]}`, or CSV (`Content-Type: text/csv`). `?publish=0` lands them as drafts.
```
curl -X POST https://YOURSITE/api/import -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '[{"title":"Director","organization":"Example Chamber","location":"Bluffton, SC","url":"https://example.org/apply"}]'
```
   CLI: `npm run import -- jobs.csv`.

Only import from sites you have permission to use.

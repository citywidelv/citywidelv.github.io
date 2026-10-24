# Kens Hub

Client-facing hub for Ken's Foods Las Vegas plant staff and the City Wide porters who work the plant on three
shifts. Live at https://citywidelv.github.io/kens-hub/ . Cloned from the Ovation Hub pattern, with its own data
model (one site, 22 areas on scheduled rounds, three shifts, no approval step) and its OWN Apps Script project.

| Page | Who | Gate |
|---|---|---|
| `index.html` | everyone | client passcode (script property `KH_PASSCODE`, kind `kh_auth`) |
| `client.html`, `report.html` | Ken's Foods staff | same |
| `porter.html`, `checklist.html`, `shift.html`, `porter-report.html`, `feed.html` | porters | same |
| `history.html` | every tier | sends the highest passcode the device holds; the backend scopes the rows |
| `manager.html`, `manager-supplies.html` | porter vendor's site manager | manager passcode (`KH_MGR_PASSCODE`, kind `kh_mgr_auth`) |
| `review.html` | City Wide | team passcode (cw-auth.js unlock, checked against `KH_TEAM_PASSCODE`) |

`kh-shared.js` carries the areas (keys match the plant's QR codes: `checklist.html?area=<key>`), the scheduled
rounds, the three shift stop lists, the gates, the post helper and the photo shrinker. Pages paint with no fetch.

Backend: `Kens.gs` in the standalone project **CW Kens Hub Backend** (prefix `kh_`). Storage: the "CW Kens Hub"
sheet (Checklists, Reports, Config) and Drive folder, created on first use. The plant's three Jotforms keep running;
their synced Google Sheets are read live and merged into the history.

Digests: `khDigestDaily` at 5:00 PM Pacific (separate client and vendor emails, City Wide copied on both, both link
back to the hub) and `khDigestWeekly` Monday 7:00 AM to City Wide. `Config!digest_live` starts FALSE (test mode:
everything goes to `cw_cc` only). Recipients live on the Config tab and on `review.html`.

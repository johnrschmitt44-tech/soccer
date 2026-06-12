# World Cup Pool 2026

Live standings site for a four-player World Cup draft pool. Results flow
automatically: football-data.org API -> GitHub Actions cron -> Google Sheet
-> this site. The sheet's formulas remain the only place scoring happens;
the automation writes raw W/D/L and knockout win counts, nothing else.

```
.github/workflows/update-sheet.yml   cron job, every 20 min during the tournament
updater/update_sheet.py              fetches results, writes counts to the sheet
docs/                                static site served by GitHub Pages
```

## One-time setup

### 0. Fix three bugs in the sheet first

The automation writes raw counts and trusts the sheet's formulas, so these
matter:

1. **Z20** is `=SUM(Z8:Z15)`. Change to `=SUM(Z8:Z19)` or Liz's last four
   teams never count.
2. **N18** is a hardcoded `0`. Change to `=MULTIPLY(K18,3)+L18` or New
   Zealand results never score.
3. **K23** and **L23** are hardcoded `0`. Change to `=H20` and `=V23` so
   Player 1's points flow into the RESULTS block like the other three.

### 0b. Add the third-place match (5 points)

The pool counts a third-place match win as 5 points. The sheet needs one
new column for it:

1. Put the header `3P` in **W22**, next to the `F` column of the KO Round
   Wins block. The updater writes win counts into **W23:W26**.
2. Amend the four Points formulas to include it:
   - **V23**: `=SUM((Q23*3),(R23*6),(S23*9),(T23*12),(U23*15),(W23*5))`
   - **V24**: `=SUM((Q24*3),(R24*6),(S24*9),(T24*12),(U24*15),(W24*5))`
   - **V25**: `=SUM((Q25*3),(R25*6),(S25*9),(T25*12),(U25*15),(W25*5))`
   - **V26**: `=SUM((Q26*3),(R26*6),(S26*9),(T26*12),(U26*15),(W26*5))`

Also note cell **A1** gets overwritten with a sync timestamp on every run.
Keep it empty of anything you care about.

### 1. football-data.org token

Register free at https://www.football-data.org/client/register. The World
Cup is in the free tier. Copy the API token.

### 2. Google service account

1. In https://console.cloud.google.com create a project (any name).
2. Enable the **Google Sheets API** (APIs & Services > Library).
3. Create a **service account** (IAM & Admin > Service Accounts), no roles
   needed.
4. On the service account, create a **JSON key** and download it.
5. In your Google Sheet, hit Share and add the service account's email
   (`something@project.iam.gserviceaccount.com`) as an **Editor**.

### 3. Publish the sheet for the site

Share > General access > **Anyone with the link: Viewer**. The site reads
the sheet anonymously through Google's public gviz endpoint; the service
account is only for writing.

### 4. Repo secrets

In the GitHub repo: Settings > Secrets and variables > Actions. Add:

| Secret                | Value                                          |
| --------------------- | ---------------------------------------------- |
| `FOOTBALL_DATA_TOKEN` | the API token from step 1                      |
| `SHEET_ID`            | the long ID from the sheet URL                 |
| `GSA_KEY_JSON`        | the entire contents of the JSON key from step 2 |

The sheet ID is the segment between `/d/` and `/edit` in the sheet's URL.

### 5. Point the site at the sheet

Edit `docs/config.js` and set `SHEET_ID` to the same ID.

### 6. Enable GitHub Pages

Settings > Pages > Source: **Deploy from a branch**, branch `main`,
folder `/docs`. The site appears at
`https://<username>.github.io/<repo>/` a minute later.

### 7. First run

Actions > "Update pool sheet" > **Run workflow** to trigger a manual sync
and confirm the sheet fills in. After that the cron handles it.

## How the updater works

Every run it pulls the full match list for the tournament, recomputes each
team's group-stage W/D/L and per-round knockout wins from scratch, and
batch-writes:

- W/D/L counts into each player's roster block (E:G, K:M, Q:S, W:Y,
  rows 8-19)
- knockout win counts per round into the KO Round Wins block (Q23:U26)
  and third-place match wins into W23:W26
- a sync timestamp into A1

Because it recomputes from zero each time, re-runs can never double-count,
and manual corrections in the sheet survive only until the next run; the
API is the source of truth for results, the sheet for ownership and
scoring rules.

Rosters are read from the sheet at runtime, so trading or renaming teams
in the sheet just works, as long as the name maps to an API team. The
updater warns in the Actions log if any roster name fails to match, and
the fix is one line in `SHEET_ALIASES` in `updater/update_sheet.py`.

## Decisions you still own

- **The bracket entry grid** (rows 30-79 in the sheet) is not touched by
  automation. Scoring runs entirely through the KO Round Wins counters.
  Fill it in by hand for flavor or ignore it.

## Running the updater locally

```bash
pip install -r updater/requirements.txt
export FOOTBALL_DATA_TOKEN=...
export SHEET_ID=...
export GSA_KEY_JSON="$(cat service-account.json)"
python updater/update_sheet.py
```

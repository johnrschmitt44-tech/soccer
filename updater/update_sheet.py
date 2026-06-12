"""Sync World Cup 2026 results from football-data.org into the pool spreadsheet.

Reads each player's drafted teams from the sheet, recomputes every team's
group-stage W/D/L and knockout-round win counts from the full match list,
and batch-writes the counts back. All scoring stays in the sheet's formulas.

Idempotent: recomputes from scratch on every run, so re-running never
double-counts.

Required environment variables:
  FOOTBALL_DATA_TOKEN   API token from football-data.org
  SHEET_ID              Google Sheet ID (from the sheet URL)
  GSA_KEY_JSON          Service account key JSON (the full JSON string)
"""

import json
import os
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build

TAB = "4 Players"

# Each player block: (roster read range, W/D/L write range)
PLAYER_BLOCKS = [
    (f"'{TAB}'!D8:D19", f"'{TAB}'!E8:G19"),
    (f"'{TAB}'!J8:J19", f"'{TAB}'!K8:M19"),
    (f"'{TAB}'!P8:P19", f"'{TAB}'!Q8:S19"),
    (f"'{TAB}'!V8:V19", f"'{TAB}'!W8:Y19"),
]

# KO Round Wins counters: rows 23-26 (players 1-4), cols Q-U = R32, R16, QF, SF, F
KO_RANGE = f"'{TAB}'!Q23:U26"
# Third-place match wins: column W, same rows. Worth 5 points via the sheet's
# amended Points formula (see README).
THIRD_RANGE = f"'{TAB}'!W23:W26"
TIMESTAMP_CELL = f"'{TAB}'!A1"

KO_STAGES = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL",
             "THIRD_PLACE"]

# Sheet spellings that won't match any API name even after normalization.
SHEET_ALIASES = {
    "AUSTRAILIA": "AUSTRALIA",            # sheet typo
    "TURKIYE": "TURKEY",
    "IVORY COAST": "COTE D IVOIRE",
    "UNITED STATES": "USA",
    "SOUTH KOREA": "KOREA REPUBLIC",
    "DR CONGO": "CONGO DR",
    "BOSNIA": "BOSNIA AND HERZEGOVINA",
    "CZECH REPUBLIC": "CZECHIA",
    "CAPE VERDE": "CABO VERDE",
}

# Extra keys to register for API teams whose common names differ from the
# name/shortName/tla the API exposes. Maps normalized API name -> extra keys.
API_EXTRA_KEYS = {
    "CZECHIA": ["CZECH REPUBLIC"],
    "TURKIYE": ["TURKEY"],
    "TURKEY": ["TURKIYE"],
    "COTE D IVOIRE": ["IVORY COAST"],
    "IVORY COAST": ["COTE D IVOIRE"],
    "KOREA REPUBLIC": ["SOUTH KOREA"],
    "SOUTH KOREA": ["KOREA REPUBLIC"],
    "CONGO DR": ["DR CONGO"],
    "DR CONGO": ["CONGO DR"],
    "CABO VERDE": ["CAPE VERDE"],
    "CAPE VERDE": ["CABO VERDE"],
    "UNITED STATES": ["USA"],
    "USA": ["UNITED STATES"],
}


def norm(name: str) -> str:
    """Uppercase, strip accents and punctuation, collapse whitespace."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = "".join(c if c.isalnum() or c.isspace() else " " for c in s)
    return " ".join(s.upper().split())


def fetch_matches(token: str) -> list:
    resp = requests.get(
        "https://api.football-data.org/v4/competitions/WC/matches",
        headers={"X-Auth-Token": token},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["matches"]


def build_name_index(matches: list) -> dict:
    """Map every normalized name variant -> API team id."""
    index = {}
    for m in matches:
        for side in (m["homeTeam"], m["awayTeam"]):
            tid = side.get("id")
            if tid is None:
                continue
            keys = set()
            for field in ("name", "shortName", "tla"):
                if side.get(field):
                    k = norm(side[field])
                    keys.add(k)
                    keys.update(API_EXTRA_KEYS.get(k, []))
            for k in keys:
                index[k] = tid
    return index


def compute_records(matches: list):
    """Return ({team_id: [W, D, L]}, {team_id: {stage: wins}})."""
    group = defaultdict(lambda: [0, 0, 0])
    ko = defaultdict(lambda: defaultdict(int))
    for m in matches:
        if m.get("status") != "FINISHED":
            continue
        stage = m.get("stage")
        winner = (m.get("score") or {}).get("winner")
        home, away = m["homeTeam"]["id"], m["awayTeam"]["id"]

        if stage == "GROUP_STAGE":
            if winner == "HOME_TEAM":
                group[home][0] += 1
                group[away][2] += 1
            elif winner == "AWAY_TEAM":
                group[away][0] += 1
                group[home][2] += 1
            elif winner == "DRAW":
                group[home][1] += 1
                group[away][1] += 1
        elif stage in KO_STAGES and winner in ("HOME_TEAM", "AWAY_TEAM"):
            win_id = home if winner == "HOME_TEAM" else away
            ko[win_id][stage] += 1
    return group, ko


def main():
    token = os.environ["FOOTBALL_DATA_TOKEN"]
    sheet_id = os.environ["SHEET_ID"]
    key_info = json.loads(os.environ["GSA_KEY_JSON"])

    creds = service_account.Credentials.from_service_account_info(
        key_info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    sheets = build("sheets", "v4", credentials=creds).spreadsheets()

    # 1. Rosters come from the sheet: it stays the source of truth for ownership.
    roster_resp = sheets.values().batchGet(
        spreadsheetId=sheet_id,
        ranges=[blk[0] for blk in PLAYER_BLOCKS],
    ).execute()
    rosters = [
        [row[0].strip() for row in vr.get("values", []) if row and row[0].strip()]
        for vr in roster_resp["valueRanges"]
    ]

    # 2. Fetch results, index names, tally records by team id.
    matches = fetch_matches(token)
    name_index = build_name_index(matches)
    group, ko = compute_records(matches)

    # 3. Build write payloads.
    unmatched = []
    data = []
    ko_grid = []
    for (_, wdl_range), teams in zip(PLAYER_BLOCKS, rosters):
        wdl_rows = []
        ko_counts = [0] * len(KO_STAGES)
        for team in teams:
            key = norm(team)
            key = SHEET_ALIASES.get(key, key)
            tid = name_index.get(key)
            if tid is None:
                unmatched.append(team)
                wdl_rows.append([0, 0, 0])
                continue
            wdl_rows.append(list(group[tid]))
            for i, stage in enumerate(KO_STAGES):
                ko_counts[i] += ko[tid][stage]
        while len(wdl_rows) < 12:  # overwrite stale rows if a roster shrank
            wdl_rows.append([0, 0, 0])
        data.append({"range": wdl_range, "values": wdl_rows})
        ko_grid.append(ko_counts)

    if unmatched and name_index:
        print(
            f"WARNING: no API match for sheet teams: {sorted(set(unmatched))}. "
            "Their counts were written as 0. Add a SHEET_ALIASES entry.",
            file=sys.stderr,
        )

    # First five stages go to Q:U; third place to its own column W.
    data.append({"range": KO_RANGE, "values": [row[:5] for row in ko_grid]})
    data.append({"range": THIRD_RANGE, "values": [[row[5]] for row in ko_grid]})
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    data.append({"range": TIMESTAMP_CELL, "values": [[f"Last sync: {stamp}"]]})

    sheets.values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()

    finished = sum(1 for m in matches if m.get("status") == "FINISHED")
    print(f"Synced {finished} finished matches at {stamp}.")


if __name__ == "__main__":
    main()

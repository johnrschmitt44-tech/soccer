// Pool site configuration.
const CONFIG = {
  SHEET_ID: "1z6nCh_KtBjf6IXKRtVlMyBO6ficaCio1ytegLJDPLqk",
  TAB: "4 Players",
  RANGE: "A1:AF26",
  FIXTURES_TAB: "Fixtures",
  FIXTURES_RANGE: "A1:J120",
  COMMENTS_TAB: "Comments",
  COMMENTS_RANGE: "A1:D1000",
  // Apps Script web app /exec URL. Comment posting stays hidden until set.
  COMMENTS_URL: "https://script.google.com/macros/s/AKfycbzmCYtcxGoYa2w0RgxBeV6i13Q-kJXIIKbLRUmSuFIZ7peQ8ev2EXBMBv2cmRGixgDb3Q/exec",

  // Column positions (zero-based, A=0). Rows are located by content anchors
  // in app.js because the gviz endpoint drops fully empty rows.
  PLAYER_COLS: [3, 9, 15, 21], // D, J, P, V: team name columns per player
  POT_LABEL_COL: 27, // AB: "TOTAL POT:" label, value sits one col right
  RESULTS_ANCHOR_COL: 9, // J: "RESULTS" label
  RESULTS_COLS: { gs: 10, ko: 11, total: 12 },
  KO_COLS: { start: 16, end: 20, points: 21, third: 22 },
  KO_LABELS: ["R32", "R16", "QF", "SF", "F", "3P"],
};

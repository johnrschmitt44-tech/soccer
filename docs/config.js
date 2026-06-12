// Pool site configuration. Edit SHEET_ID after publishing your sheet.
// Coordinates are zero-based [row, col] within the fetched range A1:AF26,
// so A1 = [0, 0] and D3 = [2, 3].

const CONFIG = {
  SHEET_ID: "PASTE_YOUR_SHEET_ID_HERE",
  TAB: "4 Players",
  RANGE: "A1:AF26",

  CELLS: {
    title: [2, 3], // D3
    pot: [2, 28], // AC3
    lastSync: [0, 0], // A1, written by the updater
  },

  // One entry per player block. nameCell holds "#1 - JOHN" style headers.
  PLAYERS: [
    { nameCell: [6, 3], teamCol: 3, resultsRow: 22 },
    { nameCell: [6, 9], teamCol: 9, resultsRow: 23 },
    { nameCell: [6, 15], teamCol: 15, resultsRow: 24 },
    { nameCell: [6, 21], teamCol: 21, resultsRow: 25 },
  ],

  // Roster rows 8-19 in the sheet.
  TEAM_ROWS: { start: 7, end: 18 },
  TOTALS_ROW: 19,

  // RESULTS block columns: GS, KO, TOTAL.
  RESULTS_COLS: { gs: 10, ko: 11, total: 12 },

  // KO Round Wins block columns Q-U, points V, third-place wins W.
  KO_COLS: { start: 16, end: 20, points: 21, third: 22 },
  KO_LABELS: ["R32", "R16", "QF", "SF", "F", "3P"],
};

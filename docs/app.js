"use strict";

function gvizUrl() {
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    tqx: "out:json",
    sheet: CONFIG.TAB,
    range: CONFIG.RANGE,
    headers: "0", // stop gviz consuming the first data row as column labels
  });
  return `${base}?${params}`;
}

async function fetchGrid() {
  const resp = await fetch(gvizUrl(), { cache: "no-store" });
  if (!resp.ok) throw new Error(`Sheet fetch failed (${resp.status})`);
  const text = await resp.text();
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (json.status === "error") {
    throw new Error(json.errors?.[0]?.detailed_message || "Sheet query error");
  }
  // Normalize to a dense 2D grid of raw values.
  return json.table.rows.map((row) =>
    (row.c || []).map((cell) => (cell && cell.v !== null ? cell.v : ""))
  );
}

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v) => String(v ?? "").trim();

function findRow(grid, col, predicate) {
  for (let r = 0; r < grid.length; r++) {
    if (predicate(str(grid[r]?.[col]))) return r;
  }
  return -1;
}

function parseSheet(grid) {
  // Anchor rows by content: gviz drops fully empty rows, so absolute row
  // numbers from the spreadsheet can't be trusted.
  const headerRow = findRow(grid, CONFIG.PLAYER_COLS[0], (s) => /^#\d/.test(s));
  const totalsRow = findRow(grid, CONFIG.PLAYER_COLS[0], (s) => /^totals$/i.test(s));
  const resultsRow = findRow(grid, CONFIG.RESULTS_ANCHOR_COL, (s) => /^results$/i.test(s));
  if (headerRow < 0 || totalsRow < 0 || resultsRow < 0) {
    throw new Error(
      "Sheet layout not recognized; expected '#1 -' headers, a Totals row, and a RESULTS block"
    );
  }

  const potRow = findRow(grid, CONFIG.POT_LABEL_COL, (s) => /^total pot/i.test(s));
  const syncRow = findRow(grid, 0, (s) => /^last sync/i.test(s));

  const meta = {
    title: potRow >= 0 ? str(grid[potRow][CONFIG.PLAYER_COLS[0]]) : "",
    pot: potRow >= 0 ? num(grid[potRow][CONFIG.POT_LABEL_COL + 1]) : 0,
    lastSync: syncRow >= 0 ? str(grid[syncRow][0]) : "",
  };

  const players = CONFIG.PLAYER_COLS.map((col, i) => {
    const rawName = str(grid[headerRow][col]);
    const name = rawName.includes("-")
      ? rawName.split("-").pop().trim()
      : rawName || `Player ${i + 1}`;

    const teams = [];
    for (let r = headerRow + 1; r < totalsRow; r++) {
      const team = str(grid[r]?.[col]);
      if (!team) continue;
      teams.push({
        team,
        w: num(grid[r][col + 1]),
        d: num(grid[r][col + 2]),
        l: num(grid[r][col + 3]),
        pts: num(grid[r][col + 4]),
      });
    }

    const totals = {
      w: num(grid[totalsRow]?.[col + 1]),
      d: num(grid[totalsRow]?.[col + 2]),
      l: num(grid[totalsRow]?.[col + 3]),
    };

    // Player N sits i+1 rows below the "RESULTS" anchor in both the
    // RESULTS block and the KO Round Wins block.
    const rr = resultsRow + 1 + i;
    const gs = num(grid[rr]?.[CONFIG.RESULTS_COLS.gs]);
    const ko = num(grid[rr]?.[CONFIG.RESULTS_COLS.ko]);
    const total = num(grid[rr]?.[CONFIG.RESULTS_COLS.total]);

    const koWins = [];
    for (let c = CONFIG.KO_COLS.start; c <= CONFIG.KO_COLS.end; c++) {
      koWins.push(num(grid[rr]?.[c]));
    }
    koWins.push(num(grid[rr]?.[CONFIG.KO_COLS.third]));

    return { name, teams, totals, gs, ko, total, koWins };
  });

  return { meta, players };
}


const FLAGS = {
  FRANCE: "\u{1F1EB}\u{1F1F7}", NETHERLANDS: "\u{1F1F3}\u{1F1F1}", BELGIUM: "\u{1F1E7}\u{1F1EA}",
  MEXICO: "\u{1F1F2}\u{1F1FD}", JAPAN: "\u{1F1EF}\u{1F1F5}", SCOTLAND: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  "CZECH REPUBLIC": "\u{1F1E8}\u{1F1FF}", "IVORY COAST": "\u{1F1E8}\u{1F1EE}", IRAN: "\u{1F1EE}\u{1F1F7}",
  "SOUTH AFRICA": "\u{1F1FF}\u{1F1E6}", QATAR: "\u{1F1F6}\u{1F1E6}", IRAQ: "\u{1F1EE}\u{1F1F6}",
  SPAIN: "\u{1F1EA}\u{1F1F8}", PORTUGAL: "\u{1F1F5}\u{1F1F9}", NORWAY: "\u{1F1F3}\u{1F1F4}",
  SWITZERLAND: "\u{1F1E8}\u{1F1ED}", CROATIA: "\u{1F1ED}\u{1F1F7}", TURKIYE: "\u{1F1F9}\u{1F1F7}",
  EGYPT: "\u{1F1EA}\u{1F1EC}", "SOUTH KOREA": "\u{1F1F0}\u{1F1F7}", BOSNIA: "\u{1F1E7}\u{1F1E6}",
  "CAPE VERDE": "\u{1F1E8}\u{1F1FB}", "NEW ZEALAND": "\u{1F1F3}\u{1F1FF}", CURACAO: "\u{1F1E8}\u{1F1FC}",
  ENGLAND: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", GERMANY: "\u{1F1E9}\u{1F1EA}",
  COLOMBIA: "\u{1F1E8}\u{1F1F4}", "UNITED STATES": "\u{1F1FA}\u{1F1F8}", ECUADOR: "\u{1F1EA}\u{1F1E8}",
  CANADA: "\u{1F1E8}\u{1F1E6}", GHANA: "\u{1F1EC}\u{1F1ED}", AUSTRIA: "\u{1F1E6}\u{1F1F9}",
  "DR CONGO": "\u{1F1E8}\u{1F1E9}", AUSTRAILIA: "\u{1F1E6}\u{1F1FA}", AUSTRALIA: "\u{1F1E6}\u{1F1FA}",
  UZBEKISTAN: "\u{1F1FA}\u{1F1FF}", JORDAN: "\u{1F1EF}\u{1F1F4}",
  ARGENTINA: "\u{1F1E6}\u{1F1F7}", BRAZIL: "\u{1F1E7}\u{1F1F7}", URUGUAY: "\u{1F1FA}\u{1F1FE}",
  MOROCCO: "\u{1F1F2}\u{1F1E6}", SENEGAL: "\u{1F1F8}\u{1F1F3}", SWEDEN: "\u{1F1F8}\u{1F1EA}",
  PARAGUAY: "\u{1F1F5}\u{1F1FE}", ALGERIA: "\u{1F1E9}\u{1F1FF}", "SAUDI ARABIA": "\u{1F1F8}\u{1F1E6}",
  TUNISIA: "\u{1F1F9}\u{1F1F3}", PANAMA: "\u{1F1F5}\u{1F1E6}", HAITI: "\u{1F1ED}\u{1F1F9}",
};
const flagFor = (team) => FLAGS[team.toUpperCase().trim()] || "";

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeader(meta) {
  document.getElementById("pool-title").textContent = meta.title || "World Cup Pool";
  document.getElementById("pot-value").textContent = meta.pot ? `$${meta.pot}` : "—";
  document.getElementById("last-sync").textContent =
    meta.lastSync || "Awaiting first sync";
}

function renderLeaderboard(players) {
  const board = document.getElementById("leaderboard");
  board.replaceChildren();
  const ranked = [...players].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...ranked.map((p) => p.total));
  const topScore = ranked[0].total;

  ranked.forEach((p, i) => {
    const isLeader = p.total === topScore && topScore > 0;
    const row = el("div", `lb-row${isLeader ? " leader" : ""}`);
    row.append(el("span", "lb-rank", String(i + 1)));

    const bar = el("div", "lb-bar");
    const fill = el("div", "lb-fill");
    fill.style.width = `${Math.max(8, (p.total / max) * 100)}%`;
    fill.append(el("span", "lb-name", p.name));
    if (isLeader) fill.append(el("span", "lb-pot-chip", "\u{1F3C6} POT"));
    bar.append(fill);
    row.append(bar);

    row.append(el("span", "lb-pts", String(p.total)));
    board.append(row);
  });
}

function renderRosters(players) {
  const grid = document.getElementById("rosters");
  grid.replaceChildren();
  const topScore = Math.max(...players.map((p) => p.total));

  players.forEach((p) => {
    const card = el("section", "card");

    const head = el("header", "card-head");
    head.append(el("h2", "card-name", p.name));
    const split = el("div", "card-split");
    split.append(chip("GS", p.gs), chip("KO", p.ko), chip("TOTAL", p.total, true));
    head.append(split);
    if (p.total === topScore && topScore > 0) card.classList.add("leading");
    card.append(head);

    const table = el("table", "roster");
    const thead = el("thead");
    const hr = el("tr");
    ["Team", "W", "D", "L", "Pts"].forEach((h, idx) =>
      hr.append(el("th", idx === 0 ? "col-team" : "col-num", h))
    );
    thead.append(hr);
    table.append(thead);

    const tbody = el("tbody");
    p.teams.forEach((t) => {
      const tr = el("tr");
      const teamCell = el("td", "col-team");
      const flag = flagFor(t.team);
      if (flag) teamCell.append(el("span", "flag", flag));
      teamCell.append(document.createTextNode(titleCase(t.team)));
      tr.append(teamCell);
      [t.w, t.d, t.l].forEach((v) => tr.append(el("td", "col-num", v ? String(v) : "·")));
      tr.append(el("td", "col-num col-pts", String(t.pts)));
      tbody.append(tr);
    });
    table.append(tbody);

    const tfoot = el("tfoot");
    const fr = el("tr");
    fr.append(el("td", "col-team", "Group totals"));
    [p.totals.w, p.totals.d, p.totals.l].forEach((v) =>
      fr.append(el("td", "col-num", String(v)))
    );
    fr.append(el("td", "col-num col-pts", String(p.gs)));
    tfoot.append(fr);
    table.append(tfoot);
    card.append(table);

    if (p.koWins.some((v) => v > 0)) {
      const koRow = el("div", "ko-row");
      koRow.append(el("span", "ko-label", "KO wins"));
      p.koWins.forEach((v, i) => {
        const cell = el("span", `ko-cell${v ? " hit" : ""}`);
        cell.append(el("b", null, CONFIG.KO_LABELS[i]), el("i", null, String(v)));
        koRow.append(cell);
      });
      card.append(koRow);
    }

    grid.append(card);
  });
}

function chip(label, value, strong) {
  const c = el("div", `chip${strong ? " strong" : ""}`);
  c.append(el("b", null, label), el("i", null, String(value)));
  return c;
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bDr\b/, "DR")
    .replace(/\bUsa\b/, "USA");
}

function showError(message) {
  const box = document.getElementById("error");
  box.textContent = message;
  box.hidden = false;
  document.getElementById("loading").hidden = true;
}

async function init() {
  if (CONFIG.SHEET_ID.startsWith("PASTE_")) {
    showError(
      "Set SHEET_ID in config.js to your published sheet's ID, then reload."
    );
    return;
  }
  try {
    const grid = await fetchGrid();
    const { meta, players } = parseSheet(grid);
    renderHeader(meta);
    renderLeaderboard(players);
    renderRosters(players);
    document.getElementById("loading").hidden = true;
    document.getElementById("content").hidden = false;
  } catch (err) {
    showError(
      `Couldn't load the sheet: ${err.message}. ` +
        "Check that the sheet is shared as 'Anyone with the link can view'."
    );
  }
}

init();
// Refresh standings every 5 minutes while the page stays open.
setInterval(init, 5 * 60 * 1000);

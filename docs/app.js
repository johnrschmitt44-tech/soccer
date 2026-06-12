"use strict";

function gvizUrl() {
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    tqx: "out:json",
    sheet: CONFIG.TAB,
    range: CONFIG.RANGE,
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

const at = (grid, [r, c]) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : "");
const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

function parsePlayers(grid) {
  return CONFIG.PLAYERS.map((p) => {
    const rawName = String(at(grid, p.nameCell));
    const name = rawName.includes("-")
      ? rawName.split("-").pop().trim()
      : rawName.trim() || "Player";

    const teams = [];
    for (let r = CONFIG.TEAM_ROWS.start; r <= CONFIG.TEAM_ROWS.end; r++) {
      const team = String(grid[r]?.[p.teamCol] ?? "").trim();
      if (!team) continue;
      teams.push({
        team,
        w: num(grid[r][p.teamCol + 1]),
        d: num(grid[r][p.teamCol + 2]),
        l: num(grid[r][p.teamCol + 3]),
        pts: num(grid[r][p.teamCol + 4]),
      });
    }

    const totals = {
      w: num(grid[CONFIG.TOTALS_ROW]?.[p.teamCol + 1]),
      d: num(grid[CONFIG.TOTALS_ROW]?.[p.teamCol + 2]),
      l: num(grid[CONFIG.TOTALS_ROW]?.[p.teamCol + 3]),
    };

    const rr = p.resultsRow;
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
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeader(grid) {
  document.getElementById("pool-title").textContent =
    String(at(grid, CONFIG.CELLS.title)) || "World Cup Pool";
  const pot = num(at(grid, CONFIG.CELLS.pot));
  document.getElementById("pot-value").textContent = pot ? `$${pot}` : "—";
  const sync = String(at(grid, CONFIG.CELLS.lastSync));
  document.getElementById("last-sync").textContent = sync || "Awaiting first sync";
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
    if (isLeader) fill.append(el("span", "lb-pot-chip", "POT"));
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
      tr.append(el("td", "col-team", titleCase(t.team)));
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
    renderHeader(grid);
    const players = parsePlayers(grid);
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

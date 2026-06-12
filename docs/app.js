"use strict";

const TZ = "America/Chicago";

const ROUNDS = {
  LAST_32: { label: "Round of 32", pts: 3, order: 1 },
  LAST_16: { label: "Round of 16", pts: 6, order: 2 },
  QUARTER_FINALS: { label: "Quarterfinals", pts: 9, order: 3 },
  SEMI_FINALS: { label: "Semifinals", pts: 12, order: 4 },
  THIRD_PLACE: { label: "Third place", pts: 5, order: 5 },
  FINAL: { label: "Final", pts: 15, order: 6 },
};

function gvizUrl(sheet, range) {
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    tqx: "out:json",
    sheet,
    range,
    headers: "0", // stop gviz consuming the first data row as column labels
  });
  return `${base}?${params}`;
}

async function fetchGrid(sheet, range) {
  const resp = await fetch(gvizUrl(sheet, range), { cache: "no-store" });
  if (!resp.ok) throw new Error(`Sheet fetch failed (${resp.status})`);
  const text = await resp.text();
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (json.status === "error") {
    throw new Error(json.errors?.[0]?.detailed_message || "Sheet query error");
  }
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

/* ---------- Pool sheet parsing (anchored) ---------- */

function parseSheet(grid) {
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

/* ---------- Fixtures tab parsing (header-keyed) ---------- */

function parseFixtures(grid) {
  // Columns are positional per the updater's fixed schema:
  // utcDate, stage, group, home, homeOwner, away, awayOwner, status, scoreHome, scoreAway.
  // (Header text can't be trusted: gviz nulls string headers in number-typed columns.)
  if (!grid.length || str(grid[0][0]) !== "utcDate") return [];

  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !str(row[0])) continue;
    out.push({
      date: new Date(str(row[0])),
      stage: str(row[1]),
      group: str(row[2]),
      home: str(row[3]),
      homeOwner: str(row[4]),
      away: str(row[5]),
      awayOwner: str(row[6]),
      status: str(row[7]),
      scoreHome: str(row[8]),
      scoreAway: str(row[9]),
    });
  }
  return out;
}

/* ---------- Comments ---------- */

const matchKey = (m) => `${m.date.toISOString()}|${m.home}|${m.away}`;

function parseComments(grid) {
  // Positional: timestamp, matchKey, name, comment (header text untrusted).
  if (!grid.length || str(grid[0][0]) !== "timestamp") return {};
  const byKey = {};
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !str(row[1])) continue;
    (byKey[str(row[1])] ||= []).push({ name: str(row[2]), text: str(row[3]) });
  }
  return byKey;
}

let COMMENTS = {};

async function postComment(key, name, text) {
  // no-cors: response is opaque, but the write goes through. Apps Script
  // doesn't answer preflight, so the body ships as text/plain.
  await fetch(CONFIG.COMMENTS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ matchKey: key, name, comment: text }),
  });
}

function commentPanel(m) {
  const key = matchKey(m);
  const panel = el("div", "cmt-panel");
  panel.hidden = true;

  const list = el("div", "cmt-list");
  const renderList = () => {
    list.replaceChildren();
    (COMMENTS[key] || []).forEach((c) => {
      const item = el("div", "cmt");
      item.append(el("b", null, c.name), document.createTextNode(c.text));
      list.append(item);
    });
  };
  renderList();
  panel.append(list);

  if (CONFIG.COMMENTS_URL) {
    const form = el("div", "cmt-form");
    const nameIn = el("input");
    nameIn.placeholder = "Name";
    nameIn.maxLength = 40;
    try { nameIn.value = localStorage.getItem("pool-name") || ""; } catch {}
    const textIn = el("textarea");
    textIn.placeholder = "Talk your talk";
    textIn.maxLength = 500;
    const btn = el("button", null, "Post");
    btn.addEventListener("click", async () => {
      const name = nameIn.value.trim();
      const text = textIn.value.trim();
      if (!name || !text) return;
      btn.disabled = true;
      try {
        await postComment(key, name, text);
        try { localStorage.setItem("pool-name", name); } catch {}
        (COMMENTS[key] ||= []).push({ name, text });
        renderList();
        textIn.value = "";
      } catch {
        btn.textContent = "Failed, retry";
      } finally {
        btn.disabled = false;
      }
    });
    form.append(nameIn, textIn, btn);
    panel.append(form);
  } else {
    panel.append(el("p", "cmt-note", "Comments open once the comment endpoint is wired up."));
  }
  return panel;
}

/* ---------- Flags ---------- */

const FLAGS = {
  FRANCE: "\u{1F1EB}\u{1F1F7}", NETHERLANDS: "\u{1F1F3}\u{1F1F1}", BELGIUM: "\u{1F1E7}\u{1F1EA}",
  MEXICO: "\u{1F1F2}\u{1F1FD}", JAPAN: "\u{1F1EF}\u{1F1F5}",
  SCOTLAND: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  "CZECH REPUBLIC": "\u{1F1E8}\u{1F1FF}", CZECHIA: "\u{1F1E8}\u{1F1FF}",
  "IVORY COAST": "\u{1F1E8}\u{1F1EE}", "COTE D'IVOIRE": "\u{1F1E8}\u{1F1EE}",
  "CÔTE D’IVOIRE": "\u{1F1E8}\u{1F1EE}", "CÔTE D'IVOIRE": "\u{1F1E8}\u{1F1EE}",
  IRAN: "\u{1F1EE}\u{1F1F7}", "SOUTH AFRICA": "\u{1F1FF}\u{1F1E6}",
  QATAR: "\u{1F1F6}\u{1F1E6}", IRAQ: "\u{1F1EE}\u{1F1F6}",
  SPAIN: "\u{1F1EA}\u{1F1F8}", PORTUGAL: "\u{1F1F5}\u{1F1F9}", NORWAY: "\u{1F1F3}\u{1F1F4}",
  SWITZERLAND: "\u{1F1E8}\u{1F1ED}", CROATIA: "\u{1F1ED}\u{1F1F7}",
  TURKIYE: "\u{1F1F9}\u{1F1F7}", "TÜRKIYE": "\u{1F1F9}\u{1F1F7}", TURKEY: "\u{1F1F9}\u{1F1F7}",
  EGYPT: "\u{1F1EA}\u{1F1EC}", "SOUTH KOREA": "\u{1F1F0}\u{1F1F7}", "KOREA REPUBLIC": "\u{1F1F0}\u{1F1F7}",
  BOSNIA: "\u{1F1E7}\u{1F1E6}", "BOSNIA-HERZEGOVINA": "\u{1F1E7}\u{1F1E6}",
  "CAPE VERDE": "\u{1F1E8}\u{1F1FB}", "CABO VERDE": "\u{1F1E8}\u{1F1FB}",
  "NEW ZEALAND": "\u{1F1F3}\u{1F1FF}", CURACAO: "\u{1F1E8}\u{1F1FC}", "CURAÇAO": "\u{1F1E8}\u{1F1FC}",
  ENGLAND: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  GERMANY: "\u{1F1E9}\u{1F1EA}", COLOMBIA: "\u{1F1E8}\u{1F1F4}",
  "UNITED STATES": "\u{1F1FA}\u{1F1F8}", USA: "\u{1F1FA}\u{1F1F8}",
  ECUADOR: "\u{1F1EA}\u{1F1E8}", CANADA: "\u{1F1E8}\u{1F1E6}", GHANA: "\u{1F1EC}\u{1F1ED}",
  AUSTRIA: "\u{1F1E6}\u{1F1F9}", "DR CONGO": "\u{1F1E8}\u{1F1E9}", "CONGO DR": "\u{1F1E8}\u{1F1E9}",
  AUSTRAILIA: "\u{1F1E6}\u{1F1FA}", AUSTRALIA: "\u{1F1E6}\u{1F1FA}",
  UZBEKISTAN: "\u{1F1FA}\u{1F1FF}", JORDAN: "\u{1F1EF}\u{1F1F4}",
  ARGENTINA: "\u{1F1E6}\u{1F1F7}", BRAZIL: "\u{1F1E7}\u{1F1F7}", URUGUAY: "\u{1F1FA}\u{1F1FE}",
  MOROCCO: "\u{1F1F2}\u{1F1E6}", SENEGAL: "\u{1F1F8}\u{1F1F3}", SWEDEN: "\u{1F1F8}\u{1F1EA}",
  PARAGUAY: "\u{1F1F5}\u{1F1FE}", ALGERIA: "\u{1F1E9}\u{1F1FF}", "SAUDI ARABIA": "\u{1F1F8}\u{1F1E6}",
  TUNISIA: "\u{1F1F9}\u{1F1F3}", PANAMA: "\u{1F1F5}\u{1F1E6}", HAITI: "\u{1F1ED}\u{1F1F9}",
};
const flagFor = (team) => FLAGS[team.toUpperCase().trim()] || "";

/* ---------- DOM helpers ---------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\bDr\b/, "DR")
    .replace(/\bUsa\b/, "USA");
}

function teamSpan(name, cls) {
  const span = el("span", cls || "match-team");
  const flag = flagFor(name);
  if (flag) span.append(el("span", "flag", flag));
  span.append(document.createTextNode(name ? titleCase(name) : "TBD"));
  return span;
}

function ownerChip(owner) {
  return owner ? el("span", "owner-chip", owner) : el("span", "owner-chip none", "—");
}

/* ---------- Header ---------- */

function renderHeader(meta) {
  document.getElementById("pool-title").textContent = meta.title || "World Cup Pool";
  document.getElementById("pot-value").textContent = meta.pot ? `$${meta.pot}` : "—";
  document.getElementById("last-sync").textContent =
    meta.lastSync || "Awaiting first sync";
}

/* ---------- Today's games ---------- */

const dayKey = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "short" }).format(d);
const kickoff = (d) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d);

function matchRow(m) {
  const row = el("div", "match-row");

  const time = el("span", "match-time");
  if (m.status === "FINISHED") {
    time.textContent = `FT ${m.scoreHome}–${m.scoreAway}`;
    time.classList.add("ft");
  } else if (m.status === "IN_PLAY" || m.status === "PAUSED") {
    time.textContent = `LIVE ${m.scoreHome || 0}–${m.scoreAway || 0}`;
    time.classList.add("live");
  } else {
    time.textContent = kickoff(m.date);
  }
  row.append(time);

  const teams = el("div", "match-teams");
  const home = el("div", "match-side");
  home.append(teamSpan(m.home), ownerChip(m.homeOwner));
  const away = el("div", "match-side");
  away.append(teamSpan(m.away), ownerChip(m.awayOwner));
  teams.append(home, el("span", "match-vs", "v"), away);
  row.append(teams);

  const count = (COMMENTS[matchKey(m)] || []).length;
  const toggle = el("button", `cmt-toggle${count ? " has" : ""}`,
    count ? `\u{1F4AC} ${count}` : "\u{1F4AC}");
  toggle.setAttribute("aria-label", "Comments");
  const panel = commentPanel(m);
  toggle.addEventListener("click", () => { panel.hidden = !panel.hidden; });
  row.append(toggle, panel);

  return row;
}

function renderToday(fixtures) {
  const box = document.getElementById("today");
  box.replaceChildren();
  const today = dayKey(new Date());
  const todays = fixtures.filter((m) => m.home && m.away && dayKey(m.date) === today);

  if (!todays.length) {
    const upcoming = fixtures.find((m) => m.date > new Date() && m.home && m.away);
    const next = upcoming
      ? `Next match day: ${new Intl.DateTimeFormat("en-US", {
          timeZone: TZ, weekday: "long", month: "long", day: "numeric",
        }).format(upcoming.date)}`
      : "";
    box.append(el("p", "status", `No matches today. ${next}`.trim()));
    return;
  }
  todays.forEach((m) => box.append(matchRow(m)));
}

/* ---------- Results (past match days) ---------- */

function renderResults(fixtures) {
  const section = document.getElementById("results-section");
  const today = dayKey(new Date());
  const past = fixtures.filter(
    (m) => m.home && m.away && m.status === "FINISHED" && dayKey(m.date) !== today
  );
  if (!past.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const box = document.getElementById("results");
  box.replaceChildren();

  const byDay = new Map();
  past.forEach((m) => {
    const k = dayKey(m.date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  });

  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  days.forEach(([k, ms], i) => {
    const det = document.createElement("details");
    if (i === 0) det.open = true;
    const sum = document.createElement("summary");
    sum.append(
      el("span", null, new Intl.DateTimeFormat("en-US", {
        timeZone: TZ, weekday: "short", month: "long", day: "numeric",
      }).format(ms[0].date)),
      el("span", "day-count", `${ms.length} match${ms.length > 1 ? "es" : ""}`)
    );
    det.append(sum);
    ms.sort((a, b) => a.date - b.date).forEach((m) => det.append(matchRow(m)));
    box.append(det);
  });
}

/* ---------- Standings ---------- */

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

/* ---------- Knockout stage ---------- */

function eliminationStatus(fixtures) {
  // A team is out once it loses a finished knockout match, except a semifinal
  // loser, who stays alive for the third-place match until that finishes.
  const out = new Set();
  const sfLosers = new Set();
  for (const m of fixtures) {
    if (m.status !== "FINISHED" || !ROUNDS[m.stage]) continue;
    const h = num(m.scoreHome), a = num(m.scoreAway);
    if (h === a) continue; // decided on penalties; sheet counts handle scoring
    const loser = h > a ? m.away : m.home;
    if (m.stage === "SEMI_FINALS") sfLosers.add(loser);
    else out.add(loser);
  }
  return { out, sfLosers };
}

function renderKnockout(fixtures, players) {
  const section = document.getElementById("ko-section");
  const koFixtures = fixtures.filter((m) => ROUNDS[m.stage] && m.home && m.away);
  if (!koFixtures.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const box = document.getElementById("knockout");
  box.replaceChildren();

  // Stakes legend
  const legend = el("div", "ko-legend");
  Object.values(ROUNDS)
    .sort((a, b) => a.order - b.order)
    .forEach((r) => {
      const item = el("span", "ko-legend-item");
      item.append(el("b", null, r.label), el("i", null, `${r.pts} pts`));
      legend.append(item);
    });
  box.append(legend);

  // Alive teams per player
  const { out } = eliminationStatus(fixtures);
  const koTeams = new Set();
  koFixtures.forEach((m) => { koTeams.add(m.home.toUpperCase()); koTeams.add(m.away.toUpperCase()); });

  const aliveWrap = el("div", "ko-alive");
  players.forEach((p) => {
    const owned = koFixtures.flatMap((m) =>
      [[m.home, m.homeOwner], [m.away, m.awayOwner]]
    ).filter(([, o]) => o === p.name).map(([t]) => t);
    const unique = [...new Set(owned.map((t) => t.toUpperCase()))];
    if (!unique.length) return;
    const row = el("div", "ko-alive-row");
    row.append(el("span", "ko-alive-name", p.name));
    unique.forEach((t) => {
      const dead = out.has(titleCase(t)) || out.has(t) ||
        [...out].some((o) => o.toUpperCase() === t);
      const chip = el("span", `ko-team-chip${dead ? " dead" : ""}`);
      const flag = flagFor(t);
      if (flag) chip.append(el("span", "flag", flag));
      chip.append(document.createTextNode(titleCase(t)));
      row.append(chip);
    });
    aliveWrap.append(row);
  });
  box.append(aliveWrap);

  // Rounds with their matches
  const byStage = {};
  koFixtures.forEach((m) => (byStage[m.stage] ||= []).push(m));
  Object.entries(byStage)
    .sort((a, b) => ROUNDS[a[0]].order - ROUNDS[b[0]].order)
    .forEach(([stage, ms]) => {
      const round = el("div", "ko-round");
      const head = el("div", "ko-round-head");
      head.append(el("h3", "ko-round-title", ROUNDS[stage].label));
      head.append(el("span", "ko-round-pts", `Win = ${ROUNDS[stage].pts} pts`));
      round.append(head);
      ms.sort((a, b) => a.date - b.date).forEach((m) => round.append(matchRow(m)));
      box.append(round);
    });
}

/* ---------- Tabbed rosters ---------- */

let activeTab = null;

function renderRosters(players) {
  const wrap = document.getElementById("rosters");
  wrap.replaceChildren();
  const topScore = Math.max(...players.map((p) => p.total));
  if (activeTab === null) {
    const leader = players.find((p) => p.total === topScore);
    activeTab = leader ? leader.name : players[0].name;
  }

  const tabbar = el("div", "tabbar");
  tabbar.setAttribute("role", "tablist");
  players.forEach((p) => {
    const tab = el("button", `tab${p.name === activeTab ? " active" : ""}`);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(p.name === activeTab));
    tab.append(el("span", "tab-name", p.name), el("span", "tab-pts", String(p.total)));
    tab.addEventListener("click", () => {
      activeTab = p.name;
      renderRosters(players);
    });
    tabbar.append(tab);
  });
  wrap.append(tabbar);

  const p = players.find((x) => x.name === activeTab) || players[0];
  wrap.append(rosterCard(p, p.total === topScore && topScore > 0));
}

function rosterCard(p, leading) {
  const card = el("section", "card");
  if (leading) card.classList.add("leading");

  const head = el("header", "card-head");
  head.append(el("h2", "card-name", p.name));
  const split = el("div", "card-split");
  split.append(chip("GS", p.gs), chip("KO", p.ko), chip("TOTAL", p.total, true));
  head.append(split);
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

  return card;
}

function chip(label, value, strong) {
  const c = el("div", `chip${strong ? " strong" : ""}`);
  c.append(el("b", null, label), el("i", null, String(value)));
  return c;
}

/* ---------- Boot ---------- */

function showError(message) {
  const box = document.getElementById("error");
  box.textContent = message;
  box.hidden = false;
  document.getElementById("loading").hidden = true;
}

async function init() {
  try {
    const [poolGrid, fixtureGrid, commentGrid] = await Promise.all([
      fetchGrid(CONFIG.TAB, CONFIG.RANGE),
      fetchGrid(CONFIG.FIXTURES_TAB, CONFIG.FIXTURES_RANGE).catch(() => []),
      fetchGrid(CONFIG.COMMENTS_TAB, CONFIG.COMMENTS_RANGE).catch(() => []),
    ]);
    const { meta, players } = parseSheet(poolGrid);
    const fixtures = parseFixtures(fixtureGrid);
    COMMENTS = parseComments(commentGrid);

    renderHeader(meta);
    renderToday(fixtures);
    renderResults(fixtures);
    renderLeaderboard(players);
    renderKnockout(fixtures, players);
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

#!/usr/bin/env node
// defrag-contributions: your GitHub contribution graph as a retro disk defragmenter.
//
// Every day is one cluster. The defragmenter sweeps the year from the first day to the
// last, moving every day you contributed to the front. The days you didn't contribute
// end up together at the end: free space.
//
// As a GitHub Action, it reads its inputs from the INPUT_* environment variables. Locally:
//
//   GITHUB_TOKEN=$(gh auth token) node src/index.js --user maximbilan --out out/defrag.svg
//   node src/index.js --user maximbilan --out out/still.svg --freeze 4.5   (a static frame at 4.5 s)
//
// No dependencies: Node 20's fetch and fs only.

"use strict";
const fs = require("fs");
const path = require("path");

// ---------- inputs ----------
function inputs() {
  const a = process.argv.slice(2);
  const arg = (name) => {
    const i = a.indexOf("--" + name);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const env = (name) => process.env["INPUT_" + name.toUpperCase()];
  return {
    user: arg("user") || env("github_user_name") || process.env.GITHUB_REPOSITORY_OWNER,
    out: arg("out") || env("output_path") || "dist/defrag.svg",
    token: arg("token") || env("github_token") || process.env.GITHUB_TOKEN,
    freeze: arg("freeze") !== undefined ? parseFloat(arg("freeze")) : undefined,
    data: arg("data"), // a saved calendar JSON, for offline work
    theme: arg("theme") || env("theme") || "classic",
  };
}

// ---------- the contribution calendar ----------
async function calendar(user, token) {
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date weekday contributionCount contributionLevel } }
        }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "defrag-contributions" },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GitHub API: " + json.errors.map((e) => e.message).join("; "));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) => w.contributionDays.map((d) => ({ date: d.date, weekday: d.weekday, count: d.contributionCount, level: LEVEL[d.contributionLevel] || 0 }))),
  };
}

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

// ---------- the look ----------
const C = {
  face: "#c0c0c0", light: "#ffffff", hilite: "#dfdfdf", shadow: "#808080", dark: "#000000",
  title0: "#000080", title1: "#1084d0", text: "#000000", muted: "#404040",
  free: "#ffffff", freeEdge: "#c6c6c6",
  read: "#00b000", write: "#e00000",
  // not yet optimized (cyan) and optimized (blue), by contribution level 1..4
  unopt: ["", "#b6f3fb", "#62dcef", "#1ab8d6", "#0590ad"],
  opt: ["", "#a9bdfc", "#5f80ee", "#2c48c6", "#0d2185"],
  edgeUnopt: "#2a8fa3", edgeOpt: "#0a1660",
};
// The dark theme, for profiles viewed in GitHub's dark mode: the same window, at night.
const DARK = {
  ...C,
  face: "#2d2d30", light: "#5a5a5e", hilite: "#3f3f44", shadow: "#1b1b1d", dark: "#0a0a0a",
  title0: "#2b3f9a", title1: "#3b6fb6", text: "#e8e8e8", muted: "#a0a0a0",
  free: "#0d1117", freeEdge: "#30363d",
  unopt: ["", "#0f4c5a", "#127487", "#1aa3bd"],
  opt: ["", "#26386e", "#3552a8", "#5277e0"],
  edgeUnopt: "#36c3dc", edgeOpt: "#8aa6ff",
};
const THEMES = { classic: C, dark: DARK };
// The palette the drawing helpers use. render() sets it from the theme.
let P = C;
const FONT = "Tahoma, 'MS Sans Serif', Verdana, Geneva, sans-serif";
const W = 880; // viewBox width
const CELL = 13, GAP = 3, PITCH = CELL + GAP;

// The animation, in seconds.
const T_START = 1.0;   // the map shows the year as it is, then the sweep starts
const SWEEP_MAX = 9.0; // the whole year is processed in at most this long
const HOLD = 4.5;      // the finished map and the dialog

// ---------- the defragmenter ----------
// days: in date order. Each used day (level > 0) moves to the front, keeping its order.
// Returns per-cell color schedules: [{t, fill, stroke}] in time order, starting at t = 0.
function defrag(days) {
  const used = days.map((d, i) => (d.level > 0 ? i : -1)).filter((i) => i >= 0);
  const U = used.length;
  const dt = U ? Math.min(0.045, SWEEP_MAX / U) : 0;
  const sched = days.map((d) =>
    [{ t: 0, fill: d.level ? P.unopt[d.level] : P.free, stroke: d.level ? P.edgeUnopt : P.freeEdge }]);
  const head = []; // where the read/write head is at each step, for the progress bar
  used.forEach((src, rank) => {
    const t = T_START + rank * dt, lv = days[src].level;
    if (src === rank) {
      // already in place: a quick read, then optimized
      sched[src].push({ t, fill: P.read, stroke: P.read });
      sched[src].push({ t: t + dt * 0.8, fill: P.opt[lv], stroke: P.edgeOpt });
    } else {
      sched[src].push({ t, fill: P.read, stroke: P.read });                        // read
      sched[src].push({ t: t + dt * 0.5, fill: P.free, stroke: P.freeEdge });      // now free
      sched[rank].push({ t: t + dt * 0.5, fill: P.write, stroke: P.write });       // write
      sched[rank].push({ t: t + dt * 1.3, fill: P.opt[lv], stroke: P.edgeOpt });   // optimized
    }
    head.push(t);
  });
  for (const s of sched) s.sort((a, b) => a.t - b.t);
  const end = T_START + U * dt + dt * 1.3;
  return { sched, end, U };
}

// ---------- SVG helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
// A raised (button, window) or sunken (panel) Windows 98 bevel.
function bevel(x, y, w, h, sunken, face = P.face) {
  const [o1, o2, i1, i2] = sunken ? [P.shadow, P.light, P.dark, P.hilite] : [P.light, P.dark, P.hilite, P.shadow];
  return [
    r(x, y, w, h, face),
    r(x, y, w, 1, o1), r(x, y, 1, h, o1), r(x, y + h - 1, w, 1, o2), r(x + w - 1, y, 1, h, o2),
    r(x + 1, y + 1, w - 2, 1, i1), r(x + 1, y + 1, 1, h - 2, i1), r(x + 1, y + h - 2, w - 2, 1, i2), r(x + w - 2, y + 1, 1, h - 2, i2),
  ].join("");
}
const text = (x, y, s, extra = "") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11"${/ fill=/.test(extra) ? "" : ` fill="${P.text}"`}${extra}>${esc(s)}</text>`;
function button(x, y, w, label, bold = false) {
  return bevel(x, y, w, 23, false) + text(x + w / 2, y + 15, label, ` text-anchor="middle"${bold ? ' font-weight="bold"' : ""}`);
}
// Title bar caption buttons: minimize, maximize, close.
function caption(x, y) {
  let s = "";
  [0, 1, 2].forEach((k) => {
    const bx = x + k * 16 + (k === 2 ? 2 : 0);
    s += bevel(bx, y, 16, 14, false);
    if (k === 0) s += r(bx + 4, y + 9, 6, 2, P.text);
    if (k === 1) s += r(bx + 3, y + 2, 9, 9, "none", ` stroke="${P.text}" stroke-width="1"`) + r(bx + 3, y + 2, 9, 2, P.text);
    if (k === 2) s += `<path d="M${bx + 4} ${y + 3}l7 7m0 -7l-7 7" stroke="${P.text}" stroke-width="1.6"/>`;
  });
  return s;
}
function titleBar(x, y, w, label, id) {
  return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${P.title0}"/><stop offset="1" stop-color="${P.title1}"/></linearGradient></defs>` +
    r(x, y, w, 18, `url(#${id})`) +
    // a little drive icon
    bevel(x + 3, y + 3, 14, 11, false, "#d8d8d8") + r(x + 12, y + 9, 2, 2, "#00c000") +
    text(x + 22, y + 13, label, ` fill="#ffffff" font-weight="bold"`) +
    caption(x + w - 52, y + 2);
}

// ---------- the picture ----------
// Escapes a string for use in SVG text and attributes.
function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(cal, user, freeze, theme = "classic") {
  P = THEMES[theme] || C;
  const days = cal.weeks.flat();
  const { sched, end, U } = defrag(days);
  const free = days.length - U;
  const L = end + HOLD; // loop length
  const pct = (t) => ((100 * t) / L).toFixed(3);

  // the cells sit on the calendar grid: column = week, row = weekday
  const pos = [];
  cal.weeks.forEach((w, wi) => w.forEach((d) => pos.push({ col: wi, row: d.weekday })));
  const cols = cal.weeks.length;
  const mapW = cols * PITCH - GAP, mapX = Math.round((W - mapW) / 2), mapY = 30;
  const panelH = 7 * PITCH - GAP + 16;

  // state at time t, for --freeze
  const at = (s, t) => s.reduce((cur, e) => (e.t <= t ? e : cur), s[0]);

  // Keyframes that hold each state and switch instantly, the way snk (the snake) does it:
  // linear timing with two stops per change, the old value just before and the new one at
  // the change. step-end over hundreds of animations drifted by seconds in real Chrome.
  // states: [{t, d}] in time order, d a CSS declaration block, states[0].t = 0.
  const keyframes = (states) => {
    let out = `0%{${states[0].d}}`, prev = 0;
    for (let k = 1; k < states.length; k++) {
      const p = (100 * states[k].t) / L;
      if (p >= 100) break;
      const before = Math.max(prev, p - 0.002);
      out += `${before.toFixed(4)}%{${states[k - 1].d}}${p.toFixed(4)}%{${states[k].d}}`;
      prev = p;
    }
    let last = states[0];
    for (const e of states) if ((100 * e.t) / L < 100) last = e;
    return out + `100%{${last.d}}`;
  };

  let css = "", cells = "";
  days.forEach((d, i) => {
    const p = pos[i], x = mapX + p.col * PITCH, y = mapY + 8 + p.row * PITCH, s = sched[i];
    if (freeze !== undefined) {
      const e = at(s, freeze);
      cells += r(x, y, CELL, CELL, e.fill, ` stroke="${e.stroke}" stroke-width="1"`);
      return;
    }
    if (s.length === 1) {
      cells += r(x, y, CELL, CELL, s[0].fill, ` stroke="${s[0].stroke}" stroke-width="1"`);
      return;
    }
    const frames = keyframes(s.map((e) => ({ t: e.t, d: `fill:${e.fill};stroke:${e.stroke}` })));
    css += `@keyframes c${i}{${frames}}.c${i}{animation:c${i} ${L.toFixed(3)}s linear infinite}`;
    cells += r(x, y, CELL, CELL, s[0].fill, ` class="c${i}" stroke="${s[0].stroke}" stroke-width="1"`);
  });

  // a show/hide window for an element, with a negative delay so it repeats every loop
  let showN = 0;
  const showBetween = (t0, t1, body) => {
    const id = "s" + showN++;
    if (freeze !== undefined) return freeze >= t0 && freeze < t1 ? body : "";
    // visibility, not opacity: it animates on the main thread everywhere (opacity can be
    // handed to the compositor)
    const st = t0 <= 0 ? [{ t: 0, d: "visibility:visible" }] : [{ t: 0, d: "visibility:hidden" }, { t: t0, d: "visibility:visible" }];
    if (t1 < L) st.push({ t: t1, d: "visibility:hidden" });
    css += `@keyframes ${id}{${keyframes(st)}}.${id}{visibility:hidden;animation:${id} ${L.toFixed(3)}s linear infinite}`;
    return `<g class="${id}">${body}</g>`;
  };

  // ---- the window ----
  const H = 300;
  let s = bevel(0, 0, W, H, false);
  s += titleBar(3, 3, W - 6, `Defragmenting github.com/${user}`, "tb");
  s += bevel(8, mapY, W - 16, panelH, true, P.free);
  s += cells;

  // status, progress bar, percentage
  const sy = mapY + panelH + 22;
  s += showBetween(0, T_START, text(10, sy, "Reading the contribution calendar…"));
  s += showBetween(T_START, end, text(10, sy, `Defragmenting github.com/${user}…`));
  s += showBetween(end, L + 1, text(10, sy, "Defragmentation is complete."));
  const barX = 10, barY = sy + 8, barW = 600, barH = 20;
  s += bevel(barX, barY, barW, barH, true);
  const chunks = Math.floor((barW - 6) / 10);
  for (let k = 0; k < chunks; k++) {
    const tk = T_START + ((k + 1) / chunks) * (end - T_START);
    s += showBetween(tk, L + 1, r(barX + 3 + k * 10, barY + 3, 8, barH - 6, P.title0));
  }
  for (let p = 0; p <= 100; p++) {
    const t0 = p === 0 ? 0 : T_START + (p / 100) * (end - T_START), t1 = p === 100 ? L + 1 : T_START + ((p + 1) / 100) * (end - T_START);
    s += showBetween(t0, t1, text(barX + barW + 12, barY + 14, `${p}% Complete`));
  }
  // buttons
  const by = barY + barH + 12;
  s += button(10, by, 75, "Stop") + button(93, by, 75, "Pause") + button(176, by, 75, "Legend") + button(259, by, 95, "Hide Details");
  // legend
  const ly = by + 42;
  const legend = [[P.opt[3], P.edgeOpt, "Optimized: days you contributed"], [P.unopt[3], P.edgeUnopt, "Not optimized yet"],
    [P.read, P.read, "Reading"], [P.write, P.write, "Writing"], [P.free, P.freeEdge, "Free space: days off"]];
  let lx = 10;
  legend.forEach(([f, e, label]) => {
    s += r(lx, ly - 10, 11, 11, f, ` stroke="${e}" stroke-width="1"`) + text(lx + 17, ly, label);
    lx += 17 + label.length * 6.1 + 22;
  });
  s += text(10, ly + 20, "Each box represents one day.", ` fill="${P.muted}"`);

  // the dialog at the end
  const dw = 380, dh = 128, dx = (W - dw) / 2, dy = 70;
  // Days, not the contribution total: the total depends on who asks (your token, a
  // logged-out visitor and the Action's token each see a different number), the days don't.
  let dlg = bevel(dx, dy, dw, dh, false) + titleBar(dx + 3, dy + 3, dw - 6, "Defrag", "tb2");
  // an "i" icon
  dlg += `<circle cx="${dx + 30}" cy="${dy + 50}" r="14" fill="#ffffff" stroke="${P.title0}" stroke-width="2"/>` +
    `<text x="${dx + 30}" y="${dy + 56}" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="17" fill="${P.title0}">i</text>`;
  dlg += text(dx + 56, dy + 42, `Defragmentation of github.com/${user} is complete.`);
  dlg += text(dx + 56, dy + 59, `${U} days of contributions. ${free} days of free space.`);
  dlg += text(dx + 56, dy + 80, "Take a day off?", ` font-weight="bold"`);
  dlg += button(dx + dw / 2 - 84, dy + dh - 34, 75, "Yes", true) + button(dx + dw / 2 + 9, dy + dh - 34, 75, "No");
  s += showBetween(end + 0.7, L + 1, dlg);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(user)}'s GitHub contributions, defragmented: ${U} days of contributions, ${free} days of free space">` +
    `<title>${escapeXml(`Defragmenting github.com/${user}`)}</title>` +
    (css ? `<style>${css}</style>` : "") + s + `</svg>\n`;
}

// ---------- main ----------
(async () => {
  try {
    const o = inputs();
    if (!o.user) throw new Error("no user: pass --user or the github_user_name input");
    let cal;
    if (o.data) cal = JSON.parse(fs.readFileSync(o.data, "utf8"));
    else {
      if (!o.token) throw new Error("no token: set GITHUB_TOKEN or the github_token input");
      cal = await calendar(o.user, o.token);
    }
    const svg = render(cal, o.user, o.freeze, o.theme);
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, svg);
    const days = cal.weeks.flat();
    console.log(`wrote ${o.out}: ${days.length} days, ${days.filter((d) => d.level > 0).length} with contributions, ${(svg.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.error("defrag-contributions: " + e.message);
    process.exit(1);
  }
})();

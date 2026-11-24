const test = require("node:test");
const assert = require("node:assert/strict");
const { defrag, render, C, DARK } = require("../src/index.js");

const day = (level, i = 0) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, weekday: i % 7, count: level * 2, level });
const year = (levels) => {
  const days = levels.map((level, i) => day(level, i));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return { total: 0, weeks };
};

test("counts the days with contributions", () => {
  const { U } = defrag([day(0, 0), day(2, 1), day(0, 2), day(1, 3), day(4, 4)]);
  assert.equal(U, 3);
});

test("moves every day with contributions to the front, in order", () => {
  const { sched } = defrag([day(0, 0), day(2, 1), day(0, 2), day(3, 3)]);
  const final = sched.map((s) => s[s.length - 1].fill);
  assert.deepEqual(final, [C.opt[2], C.opt[3], C.free, C.free]);
});

test("the dialog reports the days of contributions and of free space", () => {
  const svg = render(year([0, 1, 2, 0, 3, 4, 0]), "octocat", 3);
  assert.match(svg, /4 days of contributions\. 3 days of free space\./);
});

test("the dark palette has a color for every contribution level", () => {
  assert.equal(DARK.unopt.length, 5);
  assert.equal(DARK.opt.length, 5);
});

test("renders the dark theme", () => {
  const svg = render(year([0, 1, 2, 0, 3, 4, 0]), "octocat", 3, "dark");
  assert.match(svg, /#0d1117/);
});

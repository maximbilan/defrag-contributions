const test = require("node:test");
const assert = require("node:assert/strict");
const { defrag, render, fetchWithRetry, C, DARK, LEVEL } = require("../src/index.js");

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
  const levels = Object.keys(LEVEL).length; // NONE, then levels 1..4
  assert.equal(DARK.unopt.length, levels);
  assert.equal(DARK.opt.length, levels);
});

test("renders the dark theme", () => {
  const svg = render(year([0, 1, 2, 0, 3, 4, 0]), "octocat", 3, "dark");
  assert.match(svg, /#0d1117/);
  assert.doesNotMatch(svg, /undefined/);
});

test("defrag doesn't depend on the theme of the last render", () => {
  render(year([0, 1, 2, 0, 3, 4, 0]), "octocat", 3, "dark");
  const { sched } = defrag([day(4, 0)]);
  assert.equal(sched[0][sched[0].length - 1].fill, C.opt[4]);
});

test("an unknown theme falls back to the classic one", () => {
  const svg = render(year([0, 1, 2, 0, 3, 4, 0]), "octocat", 3, "constructor");
  assert.match(svg, new RegExp(C.face));
  assert.doesNotMatch(svg, /undefined/);
});

// fetchWithRetry against a fake fetch that answers with the given statuses in turn.
const withFetch = async (statuses, fn) => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => new Response("body", { status: statuses[Math.min(calls++, statuses.length - 1)] });
  try {
    return await fn(() => calls);
  } finally {
    globalThis.fetch = real;
  }
};

test("retries a 502 until GitHub answers", () =>
  withFetch([502, 503, 200], async (calls) => {
    const res = await fetchWithRetry("https://example.invalid", {}, { delay: 0 });
    assert.equal(res.status, 200);
    assert.equal(calls(), 3);
  }));

test("gives up after the retries with a transient error", () =>
  withFetch([502], async (calls) => {
    await assert.rejects(fetchWithRetry("https://example.invalid", {}, { delay: 0 }), (e) => e.transient === true);
    assert.equal(calls(), 4);
  }));

test("doesn't retry a bad token", () =>
  withFetch([401], async (calls) => {
    const res = await fetchWithRetry("https://example.invalid", {}, { delay: 0 });
    assert.equal(res.status, 401);
    assert.equal(calls(), 1);
  }));

import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";

export const expectedCases = Object.freeze([
  {
    file: "electronics-simulation.spec.ts",
    suites: [],
    title:
      "ELECTRONICS-E01 AFTER denied local storage never claims a durable local copy",
  },
  ...["390x844", "568x320"].flatMap((viewport) =>
    [
      "original280 tap four-to-five",
      "cancellation stays deliberate",
      "native tap and held wire Save reopen",
    ].map((scenario) => ({
      file: "electronics-simulation.spec.ts",
      suites: [],
      title: `MOBILE-ADD-CONNECT ${scenario} ${viewport}`,
    })),
  ),
  ...[1024, 1440].map((width) => ({
    file: "electronics-simulation.spec.ts",
    suites: [],
    title: `MOBILE-ADD-CONNECT desktop placement cue regression ${width}`,
  })),
]);
const files = [...new Set(expectedCases.map(({ file }) => `e2e/${file}`))];
const key = ({ file, suites, title }) => JSON.stringify([file, suites, title]);
const expectedKeys = new Set(expectedCases.map(key));
const fail = (message) => {
  throw new Error(`Scoped Electronics qualification: ${message}`);
};

export function casesFromReport(report) {
  if (!Array.isArray(report.suites) || (report.errors?.length ?? 0) !== 0) {
    fail("missing suites or report-level errors");
  }
  const cases = [];
  function visit(suite, parents = []) {
    // The public JSON reporter's outer suite is the file, not a describe block.
    const suites = parents.length ? parents.slice(1) : [];
    for (const spec of suite.specs ?? []) {
      cases.push({
        file: spec.file,
        suites: [...suites, ...(parents.length ? [suite.title] : [])],
        title: spec.title,
        spec,
      });
    }
    for (const child of suite.suites ?? [])
      visit(child, [...parents, suite.title]);
  }
  for (const suite of report.suites) visit(suite);
  return cases;
}

export function validateReport(report, execution = false, selectedOnly = true) {
  const cases = casesFromReport(report);
  const selected = cases.filter((entry) => expectedKeys.has(key(entry)));
  if (selected.length !== 9 || (selectedOnly && cases.length !== 9))
    fail("exactly nine selected cases required");
  const seen = new Set();
  for (const entry of selected) {
    const identity = key(entry);
    if (seen.has(identity)) fail("duplicate case identity");
    seen.add(identity);
    const tests = entry.spec.tests;
    if (!Array.isArray(tests) || tests.length !== 1)
      fail("exactly one project/attempt identity required");
    const test = tests[0];
    if (
      test.expectedStatus !== "passed" ||
      (test.annotations ?? []).some(({ type }) =>
        ["skip", "fixme", "fail"].includes(type),
      )
    ) {
      fail("skipped or expected-failure case");
    }
    if (
      execution &&
      (test.status !== "expected" ||
        test.results?.length !== 1 ||
        test.results[0].status !== "passed" ||
        test.results[0].retry !== 0)
    ) {
      fail("each case must pass on its only attempt");
    }
  }
  if (
    execution &&
    (report.stats?.expected !== 9 ||
      report.stats?.unexpected !== 0 ||
      report.stats?.flaky !== 0 ||
      report.stats?.skipped !== 0)
  ) {
    fail("execution totals must be nine passed and zero other outcomes");
  }
  return selected;
}

export function selectorFor(cases) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the full leaf title at the end; discovery separately freezes file and describe identities.
  return `(?:${cases.map(({ title }) => escape(title)).join("|")})$`;
}

export function runQualification() {
  if (process.argv.length !== 2) fail("no filters or extra arguments accepted");
  if (process.env.NX_SKIP_NX_CACHE !== "true")
    fail("uncached evidence required");
  if (process.env.ASA_E2E_EXTERNAL !== "true")
    fail("existing isolated CI stack required");
  if (!/^[0-9a-f]{40}$/.test(process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? ""))
    fail("exact expected source SHA required");
  const playwrightCli = createRequire(import.meta.url).resolve(
    "@playwright/test/cli",
  );
  if (
    process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE &&
    process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE !== "strict-real-time"
  ) {
    fail("this scoped gate preserves strict product/test semantics");
  }
  if (process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT)
    fail("alternate qualification entrypoint forbidden");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = resolve(root, "reports/electronics-868-nine");
  mkdirSync(directory, { recursive: true });
  const invoke = (args, env = process.env, stdio = "pipe") =>
    spawnSync(process.execPath, [playwrightCli, "test", ...files, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      stdio,
      maxBuffer: 32 * 1024 * 1024,
    });
  const discover = (suffix, args = []) => {
    const child = invoke(["--list", "--reporter=json", ...args]);
    writeFileSync(resolve(directory, `${suffix}.json`), child.stdout ?? "");
    if (child.error || child.status !== 0)
      fail(`discovery failed: ${child.error?.message ?? child.stderr}`);
    return JSON.parse(child.stdout);
  };
  const all = validateReport(discover("discovery-all"), false, false);
  const grep = selectorFor(all);
  validateReport(discover("discovery-nine", ["--grep", grep]));
  const resultPath = resolve(directory, "execution.json");
  const child = invoke(
    ["--grep", grep, "--workers=1", "--retries=0", "--reporter=list,json"],
    {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: resultPath,
    },
    "inherit",
  );
  let failure;
  try {
    if (child.error || child.status !== 0)
      fail(`browser process failed: ${child.error?.message ?? child.status}`);
    validateReport(JSON.parse(readFileSync(resultPath, "utf8")), true);
  } catch (error) {
    failure = error;
  }
  writeFileSync(
    resolve(directory, "qualification.json"),
    `${JSON.stringify(
      {
        scope: "electronics-868-nine-cases",
        fullElectronicsQualification: false,
        expectedSourceSha: process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? null,
        cases: expectedCases,
        conclusion: failure ? "FAIL_OR_INCOMPLETE" : "PASS",
        error: failure?.message ?? null,
      },
      null,
      2,
    )}\n`,
  );
  if (failure) throw failure;
  console.log(
    "Scoped Electronics 868 qualification: nine cases PASS; full Electronics suite NOT_RUN by this command.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runQualification();

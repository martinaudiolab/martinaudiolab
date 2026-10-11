// Runs every *.test.mjs in this folder, each in its own process, and reports pass/fail.
// Usage: npm test   (from tests/)   or   node tests/run-all.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const tests = fs.readdirSync(here).filter((f) => f.endsWith(".test.mjs") && (!only || f.includes(only))).sort();
let failed = 0;
for (const test of tests) {
  const run = spawnSync(process.execPath, [path.join(here, test)], { encoding: "utf8", cwd: here });
  const ok = run.status === 0;
  console.log((ok ? "pass  " : "FAIL  ") + test);
  if (!ok) {
    failed++;
    console.log((run.stdout + run.stderr).split("\n").filter((l) => !l.startsWith("    at ")).slice(-14).map((l) => "      " + l).join("\n"));
  }
}
console.log(failed ? failed + " of " + tests.length + " failed" : "all " + tests.length + " passed");
process.exit(failed ? 1 : 0);

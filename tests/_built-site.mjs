// The site as it is deployed: a copy of the repository's site with the build run over it (the deploy workflow runs
// the same build before publishing). Tests that check "every page has X" read this, not the committed files: the
// publisher commits a post before the build has added everything to it, and that is correct, not a failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./_root.mjs";

let built = null;

/** The path of the built site/ folder (built once per test file, removed when the process exits). */
export function builtSite() {
  if (built) return built;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-built-"));
  for (const dir of ["site", "build", "shared", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });
  execFileSync(process.execPath, [path.join(work, "build/build-site.mjs")], { cwd: work, stdio: "pipe" });
  process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
  built = path.join(work, "site");
  return built;
}

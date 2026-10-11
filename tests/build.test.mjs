// The site build: global fields, nav script handling, robots.txt / sitemap.xml, and the 404 setup.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ROOT } from "./_root.mjs";
import { applyGlobals } from "../scripts/site-render.mjs";
import { normalizeContent } from "../scripts/site-content.mjs";

const content = normalizeContent({});

// 1. applying the global fields never doubles the navigation script, whichever way the tag is spelled
{
  const page = (tag) => '<!DOCTYPE html><html lang="en"><head></head><body><header class="site"><a class="brand" href="../index.html">X</a><nav></nav></header><main></main>' + tag + "</body></html>";
  const count = (html) => (html.match(/nav\.js/g) || []).length;
  assert.equal(count(applyGlobals(page('<script src="../nav.js" defer></script>'), content, "radio/index.html")), 1, "template spelling");
  assert.equal(count(applyGlobals(page('<script src="../nav.js" defer=""></script>'), content, "radio/index.html")), 1, "Worker spelling (defer=\"\")");
  assert.equal(count(applyGlobals(page(""), content, "radio/index.html")), 1, "added when missing");
  assert.equal(count(applyGlobals(page('<script src="../nav.js" defer=""></script><script src="../nav.js" defer></script>'), content, "radio/index.html")), 1, "an existing duplicate is removed");
  const once = applyGlobals(page('<script src="../nav.js" defer=""></script>'), content, "radio/index.html");
  assert.equal(applyGlobals(once, content, "radio/index.html"), once, "idempotent");
  console.log("ok 1: navigation script is never duplicated");
}

// 2. a full build in a scratch copy: robots.txt, sitemap.xml, idempotence, admin kept out
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-build-"));
  try {
    for (const dir of ["site", "scripts", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });
    const run = (env) => spawnSync(process.execPath, [path.join(work, "scripts", "build-site.mjs")], { cwd: work, encoding: "utf8", env: { ...process.env, ...env } });

    let r = run({ SITE_URL: "" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(work, "site", "sitemap.xml")), "no sitemap without a public address");
    let robots = fs.readFileSync(path.join(work, "site", "robots.txt"), "utf8");
    assert.ok(robots.includes("Disallow: /admin") && !robots.includes("Sitemap:"));

    r = run({ SITE_URL: "https://example.test/" });
    assert.equal(r.status, 0, r.stderr);
    robots = fs.readFileSync(path.join(work, "site", "robots.txt"), "utf8");
    assert.ok(robots.includes("Sitemap: https://example.test/sitemap.xml"));
    const sitemap = fs.readFileSync(path.join(work, "site", "sitemap.xml"), "utf8");
    const locs = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    for (const wanted of ["https://example.test/", "https://example.test/shop/", "https://example.test/about", "https://example.test/request", "https://example.test/stereo/"]) {
      assert.ok(locs.includes(wanted), "sitemap lists " + wanted);
    }
    assert.ok(locs.every((u) => !/admin|404|\.html$/.test(u)), "no admin, 404 or .html urls");
    assert.equal(new Set(locs).size, locs.length, "no duplicates");

    // a second build changes nothing
    const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort()
      .map((f) => f + ":" + fs.statSync(path.join(dir, f)).size).join("|");
    const before = snapshot(path.join(work, "site"));
    r = run({ SITE_URL: "https://example.test/" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(snapshot(path.join(work, "site")), before, "second build is a no-op");
    console.log("ok 2: robots.txt and sitemap.xml, idempotent build");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 3. the 404 page is wired up and works from any depth
{
  const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"not_found_handling":\s*"404-page"/);
  const page = fs.readFileSync(path.join(ROOT, "site", "404.html"), "utf8");
  assert.ok(page.includes('<base href="/">'), "relative links resolve from the site root");
  assert.ok(page.includes('name="robots" content="noindex"'));
  console.log("ok 3: 404 page configured");
}

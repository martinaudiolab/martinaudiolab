// Every internal link and file reference on the built site resolves to a real file, and the address
// helpers behave. This is the safety net for moving files around.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "./_root.mjs";
import { absolutizeAssets, assetUrl, pageUrl } from "../scripts/site-urls.mjs";

const SITE = ROOT + "site/";

// 1. address helpers
{
  assert.equal(pageUrl("index.html"), "/");
  assert.equal(pageUrl("shop/index.html"), "/shop/");
  assert.equal(pageUrl("about.html"), "/about");
  assert.equal(pageUrl("stereo/some-post.html"), "/stereo/some-post");
  assert.equal(pageUrl("about.html#top"), "/about#top");
  assert.equal(pageUrl("https://example.com/x"), "https://example.com/x");
  assert.equal(pageUrl("mailto:a@b.co"), "mailto:a@b.co");
  assert.equal(pageUrl("/already/absolute"), "/already/absolute");
  assert.equal(assetUrl("images/shop/a.jpg"), "/images/shop/a.jpg");
  assert.equal(assetUrl("../images/a.jpg"), "/images/a.jpg");
  assert.equal(assetUrl("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg");
  assert.equal(assetUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  console.log("ok 1: address helpers");
}

// 2. older pages are brought up to date, and running it again changes nothing
{
  const old = '<link rel="stylesheet" href="../style.css"><a class="brand" href="../index.html">X</a><img src="../images/a.jpg">' +
    '<script src="../lightbox.js" defer></script><script src="nav.js" defer=""></script><link rel="stylesheet" href="style.css">';
  const fixed = absolutizeAssets(old);
  assert.ok(!/\.\.\/|href="style\.css"|src="nav\.js"/.test(fixed), fixed);
  assert.ok(fixed.includes('href="/assets/css/style.css"') && fixed.includes('src="/assets/js/lightbox.js"') && fixed.includes('src="/assets/js/nav.js"'));
  assert.ok(fixed.includes('<a class="brand" href="/">') && fixed.includes('src="/images/a.jpg"'));
  assert.equal(absolutizeAssets(fixed), fixed);
  console.log("ok 2: legacy relative references rewritten, idempotent");
}

// 3. the real site
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const pages = walk(SITE).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 10);
  const exists = (rel) => fs.existsSync(path.join(SITE, rel));
  /** Does a root-absolute address serve something? (clean URLs: /x -> x.html, /x/ -> x/index.html) */
  const resolves = (url) => {
    const p = decodeURIComponent(url.split("#")[0].split("?")[0]).replace(/^\//, "");
    if (p === "") return exists("index.html");
    if (p.endsWith("/")) return exists(p + "index.html");
    return exists(p) || exists(p + ".html") || exists(p + "/index.html");
  };
  const problems = [];
  for (const file of pages) {
    const rel = path.relative(SITE, file).split(path.sep).join("/");
    const html = fs.readFileSync(file, "utf8");
    for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const url = m[1].replace(/&amp;/g, "&");
      if (/^(https?:|mailto:|data:|#|javascript:)/i.test(url)) continue;
      if (url.startsWith("/")) {
        if (!resolves(url)) problems.push(rel + " -> " + url + " (missing)");
      } else if (/(^|\/)(style\.css|nav\.js|lightbox\.js|hero\.js|forsale\.js|reveal\.js|request\.js)$/.test(url) || /^(\.\.\/)+images\//.test(url)) {
        problems.push(rel + " -> " + url + " (relative site asset)");
      } else {
        // sibling links inside a section/shop page (slug.html, index.html) must exist next to the page
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), url.split("#")[0]));
        if (url.split("#")[0] && !exists(target)) problems.push(rel + " -> " + url + " (missing sibling)");
      }
    }
  }
  assert.deepEqual(problems, [], "unresolved references:\n" + problems.join("\n"));

  // the moved files exist where the pages say they do, and not at the old addresses
  for (const f of ["assets/css/style.css", "assets/js/nav.js", "assets/js/hero.js", "assets/js/forsale.js", "assets/js/reveal.js",
    "assets/js/lightbox.js", "assets/js/request.js", "admin/index.html", "admin/admin.js", "admin/shop-builder.js", "admin/post-builder.js", "admin/heic.js"]) {
    assert.ok(exists(f), f + " exists");
  }
  for (const f of ["style.css", "nav.js", "admin.html", "admin.js"]) assert.ok(!exists(f), f + " no longer at the site root");
  assert.ok(fs.readFileSync(SITE + "_redirects", "utf8").includes("/admin.html /admin/ 301"), "old admin address redirects");
  console.log("ok 3: " + pages.length + " pages, every reference resolves");
}

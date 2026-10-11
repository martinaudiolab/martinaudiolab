// Every internal link and file reference on the built site resolves to a real file, and the address
// helpers behave. This is the safety net for moving files around.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { ROOT } from "./_root.mjs";
import { absolutizeAssets, assetUrl, pageUrl } from "../shared/site-urls.mjs";

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

// 3. the site as the deploy builds it. The committed files are not the whole story: pages such as the
// Restoration Blog listing and each post's older/newer links are generated at build time, so after a
// post is deleted in the admin the committed copies can lag until the next build.
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-links-"));
  process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
  for (const dir of ["site", "build", "shared", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });
  const built = spawnSync(process.execPath, [path.join(work, "build", "build-site.mjs")], { cwd: work, encoding: "utf8", env: { ...process.env, SITE_URL: "" } });
  assert.equal(built.status, 0, built.stderr);
  const SITE = path.join(work, "site") + "/";
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

// 4. deleting a post (page and listing removed, as the admin does) leaves no dangling link once built,
// even though the committed Restoration Blog page and the neighbours' older/newer links still name it
{
  const { SECTIONS } = await import("../shared/sections.mjs");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-delete-"));
  process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
  for (const dir of ["site", "build", "shared", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });
  const run = () => spawnSync(process.execPath, [path.join(work, "build", "build-site.mjs")], { cwd: work, encoding: "utf8", env: { ...process.env, SITE_URL: "" } });
  assert.equal(run().status, 0);   // a fully built baseline, as it would be after a normal deploy

  // a section with at least two posts; remove one of them the way deletePost does
  const posts = (s) => fs.readdirSync(path.join(work, "site", s.folder)).filter((n) => n !== "index.html" && n.endsWith(".html"));
  const section = SECTIONS.find((s) => posts(s).length >= 2);
  if (!section) {
    console.log("skipped 4: no section has two posts to delete from");
  } else {
    const dir = path.join(work, "site", section.folder);
    const slug = posts(section)[0].replace(/\.html$/, "");
    fs.rmSync(path.join(dir, slug + ".html"));
    const indexFile = path.join(dir, "index.html");
    const article = new RegExp('<article class="post[^"]*">(?:(?!</article>)[\\s\\S])*?href="[^"]*' + slug + '(?:\\.html)?"[\\s\\S]*?</article>');
    const index = fs.readFileSync(indexFile, "utf8").replace(article, "");
    fs.writeFileSync(indexFile, index);
    assert.ok(!index.includes(slug + ".html"), "the listing is gone");
    assert.ok(fs.readFileSync(path.join(work, "site", "blog", "index.html"), "utf8").includes("/" + section.folder + "/" + slug), "the committed blog page still lists it (stale)");

    assert.equal(run().status, 0);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    // inside the section a post is linked by file name or by address; elsewhere only by its address
    // (another section can have a post with the same file name)
    const sameSection = new RegExp('href="(?:/' + section.folder + '/)?' + slug + '(?:\.html)?"');
    const elsewhere = new RegExp('href="/' + section.folder + '/' + slug + '(?:\.html)?"');
    const stale = walk(path.join(work, "site")).filter((f) => f.endsWith(".html")).filter((f) => {
      const inSection = path.dirname(f) === dir;
      return (inSection ? sameSection : elsewhere).test(fs.readFileSync(f, "utf8"));
    });
    assert.deepEqual(stale.map((f) => path.relative(work, f)), [], "no page still links to the deleted post");
    console.log("ok 4: a deleted post leaves no dangling links after a build");
  }
}

// 5. the site icon: files exist and are real images, and every page links them (so browsers never ask for a missing /favicon.ico)
{
  const { FAVICON_LINKS } = await import("../shared/site-urls.mjs");
  const png = fs.readFileSync(ROOT + "site/apple-touch-icon.png");
  assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "apple-touch-icon is a PNG");
  assert.equal(png.readUInt32BE(16), 180);
  const ico = fs.readFileSync(ROOT + "site/favicon.ico");
  assert.equal(ico.readUInt16LE(2), 1, "favicon.ico is an icon file");
  assert.equal(ico.readUInt16LE(4), 1, "with one image");
  assert.deepEqual(Array.from(ico.subarray(22, 30)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "holding a PNG");
  assert.ok(fs.readFileSync(ROOT + "site/favicon.svg", "utf8").startsWith("<svg"));
  assert.ok(FAVICON_LINKS.includes('href="/favicon.svg"') && FAVICON_LINKS.includes('href="/favicon.ico"') && FAVICON_LINKS.includes('apple-touch-icon'));

  // every page of the built site declares an icon
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-icon-"));
  process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
  for (const dir of ["site", "build", "shared", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });
  const built = spawnSync(process.execPath, [path.join(work, "build", "build-site.mjs")], { cwd: work, encoding: "utf8", env: { ...process.env, SITE_URL: "" } });
  assert.equal(built.status, 0, built.stderr);
  const without = walk(path.join(work, "site")).filter((f) => f.endsWith(".html"))
    .filter((f) => !/rel="icon"/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(work, f));
  assert.deepEqual(without, [], "pages without an icon link");
  console.log("ok 5: site icon files and links");
}

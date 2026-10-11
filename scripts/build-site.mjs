#!/usr/bin/env node
// Builds every page that depends on the editable site content.
//   - site/index.html, site/request.html, site/about.html   (generated)
//   - site/shop/*.html                                       (generated from shop-data/items.json)
//   - every other page under site/                           (site name and navigation applied)
// Sources: site-data/site-content.json and shop-data/items.json.
// Usage, from the repository root:  node scripts/build-site.mjs
// The deploy workflow runs this before publishing, so edits saved in /admin go live.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_PATH, normalizeContent } from "./site-content.mjs";
import { renderAbout, renderHome, renderRequest, applyGlobals } from "./site-render.mjs";
import { SHOP_MARK, renderShop, validateShop } from "./shop-render.mjs";
import { addPostHero, addThumbnails, applyPostChrome, listingsOf } from "./site-posts.mjs";
import { BLOG_HUB, SECTIONS } from "./sections.mjs";
import { renderBlogHub } from "./site-blog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const GENERATED = new Set(["index.html", "request.html", "about.html", BLOG_HUB.href]);

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") return fallback;
    console.error("Could not read " + rel + ": " + error.message);
    process.exit(1);
  }
}

function writeIfChanged(file, html) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const normalized = existing === null ? null : existing.split("\r\n").join("\n");
  if (normalized === html) return false;
  fs.writeFileSync(file, html);
  return true;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith(".html") ? [full] : [];
  });
}

const content = normalizeContent(readJson(CONTENT_PATH, {}));
let written = 0;

// 1. Shop pages and feed
const shopData = readJson("shop-data/items.json", { shop: {}, items: [] });
const check = validateShop(shopData, (p) => fs.existsSync(path.join(SITE, p)));
if (check.errors.length) {
  console.error("Shop not built. Fix these problems in shop-data/items.json:\n - " + check.errors.join("\n - "));
  process.exit(1);
}
const shopDir = path.join(SITE, "shop");
fs.mkdirSync(shopDir, { recursive: true });
const shopFiles = renderShop(shopData, { content });
for (const f of fs.readdirSync(shopDir)) {
  const p = path.join(shopDir, f);
  if (f.endsWith(".html") && !(f in shopFiles) && fs.readFileSync(p, "utf8").includes(SHOP_MARK)) fs.unlinkSync(p);
}
for (const [name, html] of Object.entries(shopFiles)) if (writeIfChanged(path.join(shopDir, name), html)) written++;

// 2. Pages generated from the content file
const generated = { "index.html": renderHome(content), "request.html": renderRequest(content), "about.html": renderAbout(content) };
for (const [name, html] of Object.entries(generated)) if (writeIfChanged(path.join(SITE, name), html)) written++;

// 3. Blog: section pages, post pages, the Restoration Blog landing page, and the admin's section dropdowns
const sectionIndexes = {};
for (const section of SECTIONS) {
  const folder = section.folder;
  const dir = path.join(SITE, folder);
  const file = path.join(dir, "index.html");
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  const before = crlf ? raw.split("\r\n").join("\n") : raw;
  let after = addThumbnails(before, folder, (p) => fs.existsSync(path.join(SITE, p)));
  after = after.replace("<body>", () => '<body class="navbar">');
  if (after !== before) fs.writeFileSync(file, crlf ? after.split("\n").join("\r\n") : after);
  sectionIndexes[folder] = after;
  const listings = listingsOf(after);

  // every post page: the picture under its title, the breadcrumb, and older/newer links
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/);
    if (!m) continue;
    const post = path.join(dir, name);
    const rawPost = fs.readFileSync(post, "utf8");
    const postCrlf = rawPost.includes("\r\n");
    const postBefore = postCrlf ? rawPost.split("\r\n").join("\n") : rawPost;
    let postAfter = addPostHero(postBefore, folder, m[1], (p) => fs.existsSync(path.join(SITE, p)));
    postAfter = applyPostChrome(postAfter, folder, m[1], listings);
    if (postAfter !== postBefore) fs.writeFileSync(post, postCrlf ? postAfter.split("\n").join("\r\n") : postAfter);
  }
}
fs.mkdirSync(path.join(SITE, BLOG_HUB.folder), { recursive: true });
if (writeIfChanged(path.join(SITE, BLOG_HUB.href), renderBlogHub(content, sectionIndexes))) written++;

{
  // The Post Builder and Manage Blog Posts dropdowns list the sections from sections.mjs.
  const adminFile = path.join(SITE, "admin.html");
  if (fs.existsSync(adminFile)) {
    const raw = fs.readFileSync(adminFile, "utf8");
    const crlf = raw.includes("\r\n");
    const before = crlf ? raw.split("\r\n").join("\n") : raw;
    const options = SECTIONS.map((s) => '<option value="' + s.key + '">' + s.name.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</option>").join("\n");
    const after = before
      .replace(/(<select id="category" required>)[\s\S]*?(<\/select>)/, (m, a, b) => a + "\n" + options + "\n" + b)
      .replace(/(<select id="manage-category">)[\s\S]*?(<\/select>)/, (m, a, b) => a + "\n" + options + "\n" + b);
    if (after !== before) fs.writeFileSync(adminFile, crlf ? after.split("\n").join("\r\n") : after);
  }
}

// 4. Everything else: apply the global fields
let applied = 0;
for (const file of walk(SITE)) {
  const rel = path.relative(SITE, file).split(path.sep).join("/");
  if (GENERATED.has(rel)) continue;
  const raw = fs.readFileSync(file, "utf8");
  if (raw.includes(SHOP_MARK)) continue;
  const crlf = raw.includes("\r\n");
  const before = crlf ? raw.split("\r\n").join("\n") : raw;
  const after = applyGlobals(before, content, rel);
  if (after !== before) {
    fs.writeFileSync(file, crlf ? after.split("\n").join("\r\n") : after);
    applied++;
  }
}

// 5. robots.txt and sitemap.xml (the sitemap needs the public address: set SITE_URL, e.g. https://martinaudiolabs.com)
const siteUrl = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const sectionFolders = SECTIONS.map((s) => s.folder);
const clean = [
  "/", "/shop/", "/blog/", "/about", "/request",
  ...Object.keys(shopFiles).filter((n) => n.endsWith(".html") && n !== "index.html").map((n) => "/shop/" + n.replace(/\.html$/, ""))
];
for (const folder of sectionFolders) {
  const dir = path.join(SITE, folder);
  if (!fs.existsSync(dir)) continue;
  clean.push("/" + folder + "/");
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.endsWith(".html") && name !== "index.html") clean.push("/" + folder + "/" + name.replace(/\.html$/, ""));
  }
}
const robots = "User-agent: *\nDisallow: /admin\nDisallow: /admin.html\n" + (siteUrl ? "\nSitemap: " + siteUrl + "/sitemap.xml\n" : "");
writeIfChanged(path.join(SITE, "robots.txt"), robots);
if (siteUrl) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    clean.map((u) => "  <url><loc>" + siteUrl + u + "</loc></url>").join("\n") + "\n</urlset>\n";
  writeIfChanged(path.join(SITE, "sitemap.xml"), xml);
}

console.log("Site built from " + CONTENT_PATH + ": " + written + " generated page(s) updated, global fields applied to " + applied + " other page(s).");
check.warnings.forEach((w) => console.log("Warning: " + w));

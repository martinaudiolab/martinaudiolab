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
import { addThumbnails } from "./site-posts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const GENERATED = new Set(["index.html", "request.html", "about.html"]);

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

// 3. Blog section pages: every listing gets a thumbnail (its own, else the section picture) and the nav bar
for (const folder of ["stereo", "radio", "test-equipment"]) {
  const file = path.join(SITE, folder, "index.html");
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  const before = crlf ? raw.split("\r\n").join("\n") : raw;
  let after = addThumbnails(before, folder, (p) => fs.existsSync(path.join(SITE, p)));
  after = after.replace("<body>", () => '<body class="navbar">');
  if (after !== before) fs.writeFileSync(file, crlf ? after.split("\n").join("\r\n") : after);
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

console.log("Site built from " + CONTENT_PATH + ": " + written + " generated page(s) updated, global fields applied to " + applied + " other page(s).");
check.warnings.forEach((w) => console.log("Warning: " + w));

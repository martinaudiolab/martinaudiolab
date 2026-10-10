#!/usr/bin/env node
// Builds the Shop pages (site/shop/*.html) from shop-data/items.json.
// Usage, from the repository root:  node scripts/build-shop.mjs
// The shop builder page (site/shop-builder.html) does the same thing in the
// browser through the publisher Worker; both share scripts/shop-render.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHOP_MARK, renderShop, validateShop } from "./shop-render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const OUT = path.join(SITE, "shop");

let data;
try {
  data = JSON.parse(fs.readFileSync(path.join(ROOT, "shop-data", "items.json"), "utf8"));
} catch (e) {
  console.error("Could not read shop-data/items.json: " + e.message);
  process.exit(1);
}

const { errors, warnings } = validateShop(data, (p) => fs.existsSync(path.join(SITE, p)));
if (errors.length) {
  console.error("Shop not built. Fix these problems in shop-data/items.json:\n - " + errors.join("\n - "));
  process.exit(1);
}

const files = renderShop(data);
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  const p = path.join(OUT, f);
  if (f.endsWith(".html") && fs.readFileSync(p, "utf8").includes(SHOP_MARK)) fs.unlinkSync(p);
}
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), html);

const items = data.items || [];
const samples = items.filter((i) => i.sample).length;
console.log("Built shop: " + items.length + " item" + (items.length === 1 ? "" : "s") + " + gallery page in site/shop/");
if (samples) console.log("NOTE: " + samples + " item(s) are marked sample. Remove them from shop-data/items.json before going live.");
warnings.forEach((w) => console.log("Warning: " + w));

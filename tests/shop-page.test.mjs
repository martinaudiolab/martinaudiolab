import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
const R = ROOT_URL + "";
const { normalizeContent, contentImages } = await import(R + "scripts/site-content.mjs");
const { renderShop } = await import(R + "scripts/shop-render.mjs");
const data = JSON.parse(fs.readFileSync(ROOT + "shop-data/items.json", "utf8"));
const content = normalizeContent({
  homepage: { hero: { slides: [{ image: "images/site/home-a.jpg" }] } },
  shop_hero: { slides: [{ image: "images/site/shop-a.jpg", alt: "Bench" }, { image: "javascript:x" }, { image: "images/site/shop-b.jpg" }] }
});
assert.deepEqual(content.shop_hero.slides.map((s) => s.image), ["images/site/shop-a.jpg", "images/site/shop-b.jpg"]);
assert.ok(contentImages(content).includes("images/site/shop-b.jpg"));
const files = renderShop(data, { content });
const idx = files["index.html"];
assert.ok(idx.includes('<body class="home">') && idx.includes('src="../images/site/shop-a.jpg"') && idx.includes('src="../images/site/shop-b.jpg"'));
assert.ok(!idx.includes("home-a.jpg"), "separate pool from the homepage");
assert.equal((idx.match(/<h1>/g) || []).length, 1);
assert.ok(idx.indexOf('class="hero"') < idx.indexOf(`class="forsale shop-list"`) && idx.includes('<script src="../hero.js" defer>'));
const detail = Object.entries(files).find(([n]) => n.endsWith(".html") && n !== "index.html")[1];
assert.ok(!detail.includes('class="hero"') && !detail.includes('<body class="home">'), "item pages keep the normal header");
console.log("ok: shop hero pool, markup, item pages unchanged");
{
  const sale = JSON.parse(JSON.stringify(data));
  sale.items[0].was = 999; sale.items[0].price = 500; sale.items[0].status = "pending";
  const html = renderShop(sale, { content })["index.html"];
  assert.ok(html.includes('<section class="forsale shop-list"') && html.includes('<div class="fs-grid">'));
  assert.ok(!html.includes("<main>"), "grid is full width, after the container");
  assert.ok(html.includes('class="fs-card"') && html.includes('<div class="fs-name">') && html.includes('<div class="fs-price">'));
  assert.ok(html.includes('<s>$999.00</s><span class="fs-sale">$500.00</span>') && html.includes('<span class="fs-badge">Sale pending</span>'));
  assert.ok(!html.includes("shop-card") && !html.includes("shop-grid"));
  console.log("ok: shop cards use the For Sale Now markup");
}

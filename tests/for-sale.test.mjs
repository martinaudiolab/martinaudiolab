import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderHome } from "../scripts/site-render.mjs";
import { normalizeContent } from "../scripts/site-content.mjs";
const R = ROOT + "";
const script = fs.readFileSync(R + "site/forsale.js", "utf8");
const css = fs.readFileSync(R + "site/style.css", "utf8");
const html = renderHome(normalizeContent({})).replace(/<script src="[^"]*"[^>]*><\/script>/g, "");

const feedOf = (n) => Array.from({ length: n }, (_, i) => ({
  slug: "item-" + i, title: "Item " + i, image: "images/shop/p" + i + ".jpg",
  price: "$" + (100 + i) + ".00", was: i === 1 ? "$250.00" : "", pending: i === 2
}));

async function boot(feed, { phone = false, reduced = false, respond } = {}) {
  const dom = new JSDOM(html, { url: "https://site.example/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const listeners = [];
  w.matchMedia = (q) => ({
    matches: /prefers-reduced-motion/.test(q) ? reduced : /max-width: 599px/.test(q) ? phone : false,
    addEventListener: (type, fn) => listeners.push(fn)
  });
  const intervals = [], timeouts = [];
  w.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  w.clearInterval = (id) => { if (intervals[id - 1]) intervals[id - 1].cleared = true; };
  w.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };
  const urls = [];
  w.fetch = async (url) => { urls.push(url); return respond ? respond() : { ok: true, json: async () => feed }; };
  w.eval(script);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const d = w.document;
  return {
    w, d, intervals, timeouts, urls, listeners,
    names: () => Array.from(d.querySelectorAll(".fs-name")).map((n) => n.textContent),
    grid: d.getElementById("fs-grid"), section: d.getElementById("forsale"),
    live: () => intervals.filter((i) => !i.cleared)
  };
}
const flush = (b) => { while (b.timeouts.length) b.timeouts.shift().fn(); };

// 1. cards: image, name, price, sale pricing, badge, link
{
  const b = await boot(feedOf(7));
  assert.deepEqual(b.urls, ["shop/feed.json"]);
  assert.equal(b.section.hidden, false);
  const cards = Array.from(b.d.querySelectorAll(".fs-card"));
  assert.equal(cards.length, 4, "four products in a row");
  assert.deepEqual(b.names(), ["Item 0", "Item 1", "Item 2", "Item 3"]);
  assert.equal(cards[0].getAttribute("href"), "shop/item-0.html");
  assert.equal(cards[0].querySelector(".fs-thumb img").getAttribute("src"), "images/shop/p0.jpg");
  assert.equal(cards[0].querySelector(".fs-price").textContent, "$100.00");
  assert.equal(cards[1].querySelector(".fs-price s").textContent, "$250.00", "original struck through");
  assert.equal(cards[1].querySelector(".fs-sale").textContent, "$101.00", "sale price in the accent colour");
  assert.equal(cards[2].querySelector(".fs-badge").textContent, "Sale pending");
  assert.equal(cards[0].querySelector(".fs-badge"), null);
  assert.equal(b.section.querySelectorAll("button, .fs-btn, .fs-track").length, 0, "no arrows or buttons");
  console.log("ok 1: cards, sale pricing, badge, links, no controls");
}

// 2. rotation every 30s with a fade, wrapping through the catalogue; hover pauses
{
  const b = await boot(feedOf(7));
  assert.equal(b.live().length, 1);
  assert.equal(b.live()[0].ms, 30000);
  const tick = b.live()[0].fn;
  tick();
  assert.ok(b.grid.classList.contains("fs-fade"), "fades out first");
  assert.equal(b.timeouts.length, 1);
  assert.ok(b.timeouts[0].ms >= 250 && b.timeouts[0].ms <= 350, "about 300ms each way, 600ms total");
  assert.deepEqual(b.names(), ["Item 0", "Item 1", "Item 2", "Item 3"], "set unchanged until the fade completes");
  flush(b);
  assert.deepEqual(b.names(), ["Item 4", "Item 5", "Item 6", "Item 0"], "next set wraps so it stays full");
  assert.ok(!b.grid.classList.contains("fs-fade"));
  tick(); flush(b);
  assert.deepEqual(b.names(), ["Item 1", "Item 2", "Item 3", "Item 4"]);
  // hovering holds the set
  b.grid.dispatchEvent(new b.w.MouseEvent("mouseenter"));
  tick(); assert.equal(b.timeouts.length, 0, "no change while hovering");
  b.grid.dispatchEvent(new b.w.MouseEvent("mouseleave"));
  tick(); flush(b);
  assert.deepEqual(b.names(), ["Item 5", "Item 6", "Item 0", "Item 1"]);
  // not while the tab is hidden
  Object.defineProperty(b.d, "hidden", { value: true, configurable: true });
  tick(); assert.equal(b.timeouts.length, 0);
  console.log("ok 2: 30s rotation, fade, wrap-around, hover pause, hidden tab");
}

// 3. fewer than five products: show all, never rotate
{
  for (const n of [1, 3, 4]) {
    const b = await boot(feedOf(n));
    assert.equal(b.d.querySelectorAll(".fs-card").length, n);
    assert.equal(b.live().length, 0, n + " products do not rotate");
  }
  const five = await boot(feedOf(5));
  assert.equal(five.live().length, 1, "five products rotate");
  const names = []; five.live()[0].fn(); flush(five); names.push(...five.names());
  assert.deepEqual(names, ["Item 4", "Item 0", "Item 1", "Item 2"]);
  console.log("ok 3: under five products stay still");
}

// 4. phones: one product at a time, still rotating; breakpoint changes re-render
{
  const b = await boot(feedOf(3), { phone: true });
  assert.deepEqual(b.names(), ["Item 0"]);
  assert.equal(b.live().length, 1);
  b.live()[0].fn(); flush(b);
  assert.deepEqual(b.names(), ["Item 1"]);
  b.listeners[0]();      // viewport crosses the breakpoint
  assert.deepEqual(b.names(), ["Item 0"]);
  console.log("ok 4: phone shows one at a time and rotates");
}

// 5. reduced motion, failures and empty feeds
{
  const reduced = await boot(feedOf(8), { reduced: true });
  assert.equal(reduced.d.querySelectorAll(".fs-card").length, 4);
  assert.equal(reduced.live().length, 0);
  const empty = await boot([]);
  assert.equal(empty.section.hidden, true);
  const failed = await boot(null, { respond: async () => ({ ok: false }) });
  assert.equal(failed.section.hidden, true);
  const thrown = await boot(null, { respond: async () => { throw new Error("offline"); } });
  assert.equal(thrown.section.hidden, true);
  console.log("ok 5: reduced motion, empty and failed feeds");
}

// 6. layout: centered label, view-all pill, grid columns per breakpoint
{
  const d = new JSDOM(html).window.document;
  assert.equal(d.querySelector(".fs-label").textContent, "For Sale Now");
  assert.equal(d.querySelector(".fs-viewall").textContent, "View All");
  assert.equal(d.querySelector(".fs-viewall").getAttribute("href"), "shop/index.html");
  assert.equal(d.querySelector(".fs-head, .fs-btn, .fs-track"), null, "old carousel markup is gone");
  const must = [
    ["four columns by default", /\.fs-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:4px/],
    ["two columns up to 1024px", /@media\(max-width:1024px\)\{\.fs-grid\{grid-template-columns:repeat\(2,/],
    ["one column under 600px", /@media\(max-width:599px\)\{\.fs-grid\{grid-template-columns:1fr\}\}/],
    ["spaced uppercase label", /\.fs-label\{[^}]*letter-spacing:3px;text-transform:uppercase/],
    ["image 4:3, square corners", /\.fs-thumb\{[^}]*aspect-ratio:4\/3;[^}]*border-radius:0/],
    ["subtle hover zoom", /\.fs-card:hover \.fs-thumb img[^{]*\{transform:scale\(1\.03\)\}/],
    ["badge top right", /\.fs-badge\{position:absolute;top:8px;right:8px/],
    ["view all pill like the nav", /\.fs-viewall\{[^}]*rgba\(0,0,0,\.55\);[^}]*backdrop-filter:blur\(4px\)/],
    ["full width", /.forsale{width:100%/],
    ["fade out and in", /\.fs-grid\.fs-fade\{opacity:0\}/]
  ];
  must.forEach(([name, re]) => assert.match(css, re, name));
  assert.ok(!/\.fs-track|\.fs-btn|\.fs-head/.test(css), "old carousel styles removed");
  console.log("ok 6: layout and styles");
}

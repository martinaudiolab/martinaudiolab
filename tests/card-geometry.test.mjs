// Real-browser check of the listing cards on the section and blog pages: a grid of compact cards (three to a row on
// wide screens, two on tablets, one on phones), and each card's sizes, weights and padding.
// Skipped, not failed, when no Chromium browser is installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_root.mjs";
import { cardHtml } from "../shared/site-posts.mjs";
import { blogChipsHtml } from "../shared/site-blog.mjs";

const candidates = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const browser = candidates.find((p) => fs.existsSync(p));
if (!browser) {
  console.log("skipped: no Chrome or Edge found (set CHROME_BIN to run the card geometry check)");
  process.exit(0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-card-"));
try {
  const css = pathToFileURL(path.join(ROOT, "site/assets/css/style.css")).href;
  const card = (n) => cardHtml({
    section: { folder: "stereo" }, slug: "x" + n, titleHtml: "A post title " + n, summary: "A subtitle line", date: "October 10, 2026",
    thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", excerpt: "Some excerpt text."
  });
  // a section page's <main>: the blog page buttons, then the listings
  const page = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="' + css + '"><body>' +
    '<main>' + blogChipsHtml("stereo") + [1, 2, 3, 4].map(card).join("") + "</main><pre id=\"out\"></pre>" +
    '<script>addEventListener("load",function(){var q=function(s){return document.querySelector(s)},c=function(s,p){return getComputedStyle(q(s))[p]};' +
    'var box=function(s){var r=(typeof s==="string"?q(s):s).getBoundingClientRect();return {w:r.width,x:r.left,y:r.top,h:r.height}};' +
    'var cards=[].slice.call(document.querySelectorAll("article.post-card"));' +
    'document.getElementById("out").textContent=JSON.stringify({' +
    'order:["h2",".card-sub",".card-date",".post-thumb",".card-excerpt",".card-foot"].map(function(s){return box(s).y}),' +
    'title:[c("h2","fontSize"),c("h2","fontWeight"),c("h2","textTransform")],kicker:[c(".card-sub","fontSize"),c(".card-sub","fontWeight"),c(".card-sub","textTransform"),c(".card-sub","letterSpacing")],' +
    'date:[c(".card-date","fontSize"),c(".card-date","fontWeight"),c(".card-date","textTransform")],excerpt:[c(".card-excerpt","fontSize"),c(".card-excerpt","lineHeight")],' +
    'more:[c(".more","fontWeight"),c(".more","textTransform")],' +
    'headPad:c(".card-head","padding"),radius:c(".post-card","borderRadius"),bg:c(".post-card","backgroundColor"),footBg:c(".card-foot","backgroundColor"),' +
    'thumb:{w:box(".post-thumb").w,h:box(".post-thumb").h,card:box(".post-card").w},' +
    'foot:{pad:c(".card-foot","padding"),w:box(".card-foot").w,card:box(".post-card").w},rule:{w:box(".card-rule").w,card:box(".post-card").w,top:c(".card-rule","borderTopWidth")},' +
    'tag:{pad:c(".card-tag","padding"),radius:c(".card-tag","borderRadius"),size:c(".card-tag","fontSize"),weight:c(".card-tag","fontWeight"),text:q(".card-tag").textContent},' +
    'tagLeft:box(".card-tag").x-box(".card-foot").x,' +
    'columns:cards.map(function(e){return Math.round(box(e).x)}),rows:cards.map(function(e){return Math.round(box(e).y)}),heights:cards.map(function(e){return Math.round(box(e).h)}),' +
    'chips:{w:box(".blog-sections").w,main:q("main").clientWidth-parseFloat(c("main","paddingLeft"))-parseFloat(c("main","paddingRight"))}});});</script>';
  fs.writeFileSync(path.join(work, "card.html"), page);

  const measure = (width) => {
    const run = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
      "--window-size=" + width + ",1400", "--virtual-time-budget=3000", "--user-data-dir=" + path.join(work, "p" + width),
      "--dump-dom", pathToFileURL(path.join(work, "card.html")).href], { encoding: "utf8", timeout: 60000 });
    const m = (run.stdout || "").match(/<pre id="out">([\s\S]*?)<\/pre>/);
    assert.ok(m, "no result at " + width + "px:\n" + (run.stderr || "").slice(0, 300));
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  };
  const distinct = (list) => [...new Set(list)].length;

  const d = measure(1280);
  // the grid: three to a row, the fourth card starts a new row, cards in a row share their height
  assert.equal(distinct(d.columns.slice(0, 3)), 3, "three cards side by side: " + d.columns);
  assert.equal(distinct(d.rows.slice(0, 3)), 1, "on one row");
  assert.ok(d.rows[3] > d.rows[0] && d.columns[3] === d.columns[0], "the fourth starts the next row");
  assert.equal(distinct(d.heights.slice(0, 3)), 1, "a row's cards are the same height");
  assert.ok(Math.abs(d.chips.w - d.chips.main) <= 2, "the blog page buttons span the whole row above the cards");
  // each card, top to bottom: title, subtitle, date, picture, excerpt, tag
  assert.ok(d.order.every((y, i) => i === 0 || y > d.order[i - 1]), "card order: " + d.order);
  assert.deepEqual(d.title, ["20px", "400", "uppercase"]);
  assert.deepEqual(d.kicker.slice(0, 3), ["12px", "600", "uppercase"]);
  assert.equal(d.kicker[3], "1.5px");
  assert.deepEqual(d.date, ["12px", "600", "uppercase"]);
  assert.equal(d.excerpt[0], "16px");
  assert.ok(Math.abs(parseFloat(d.excerpt[1]) - 16 * 1.6) < 0.6, "line height 1.6");
  assert.deepEqual(d.more, ["600", "uppercase"], "Read More is a small uppercase link after the excerpt");
  assert.ok(Math.abs(d.thumb.w - (d.thumb.card - 2)) <= 2, "the picture spans the card");
  assert.ok(Math.abs(d.thumb.w / d.thumb.h - 4 / 3) < 0.02, "pictures are cropped to 4:3, so cards line up");
  assert.equal(d.headPad, "20px 20px 0px");
  assert.equal(d.radius, "0px", "square, like the rest of the site");
  assert.equal(d.bg, "rgb(20, 20, 20)", "near-black, like the homepage rows");
  assert.equal(d.footBg, "rgba(0, 0, 0, 0)", "no coloured footer band: a rule above the tag instead");
  assert.equal(d.foot.pad, "14px 20px");
  assert.ok(Math.abs(d.foot.w - d.foot.card) <= 2, "footer is full-bleed");
  assert.ok(Math.abs(d.rule.w - d.rule.card) <= 2 && d.rule.top === "1px", "divider is full-bleed and 1px");
  assert.deepEqual([d.tag.pad, d.tag.radius, d.tag.size, d.tag.weight, d.tag.text], ["9px 16px", "0px", "12px", "600", "Stereo"]);
  assert.ok(Math.abs(d.tagLeft - 20) <= 1, "tag is left-aligned inside the footer padding");

  const tablet = measure(800);
  assert.equal(distinct(tablet.columns), 2, "two to a row on tablets: " + tablet.columns);
  const phone = measure(560);
  assert.equal(distinct(phone.columns), 1, "one to a row on phones: " + phone.columns);
  console.log("ok: listing cards form a 3 / 2 / 1 column grid and match the card spec (" + path.basename(browser) + ")");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

// Real-browser check that the listing card matches the card spec's geometry (sizes, weights, padding, columns).
// Skipped, not failed, when no Chromium browser is installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_root.mjs";
import { cardHtml } from "../shared/site-posts.mjs";

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
  const card = cardHtml({
    section: { folder: "stereo" }, slug: "x", titleHtml: "A post title", summary: "A subtitle line", date: "October 10, 2026",
    thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", excerpt: "Some excerpt text."
  });
  const page = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="' + css + '"><body><main style="max-width:1100px;padding:0 2rem"><div class="body">' + card + "</div></main><pre id=\"out\"></pre>" +
    '<script>addEventListener("load",function(){var q=function(s){return document.querySelector(s)},c=function(s,p){return getComputedStyle(q(s))[p]};' +
    'var box=function(s){var r=q(s).getBoundingClientRect();return {w:r.width,x:r.left,y:r.top,h:r.height}};' +
    'document.getElementById("out").textContent=JSON.stringify({' +
    'order:["h2",".card-sub",".card-date"].map(function(s){return box(s).y}),' +
    'title:[c("h2","fontSize"),c("h2","fontWeight")],kicker:[c(".card-sub","fontSize"),c(".card-sub","fontWeight"),c(".card-sub","textTransform"),c(".card-sub","letterSpacing")],' +
    'date:[c(".card-date","fontSize"),c(".card-date","fontWeight"),c(".card-date","textTransform")],excerpt:[c(".card-excerpt","fontSize"),c(".card-excerpt","lineHeight")],' +
    'more:[c(".more","fontWeight"),c(".more","fontSize"),c(".card-excerpt","fontSize")],' +
    'cols:c(".card-body","gridTemplateColumns"),gap:c(".card-body","columnGap"),bodyPad:c(".card-body","padding"),' +
    'headPad:c(".card-head","padding"),radius:c(".post-card","borderRadius"),imgRadius:c(".card-body img","borderRadius"),' +
    'foot:{pad:c(".card-foot","padding"),w:box(".card-foot").w,card:box(".post-card").w},rule:{w:box(".card-rule").w,card:box(".post-card").w,top:c(".card-rule","borderTopWidth")},' +
    'tag:{pad:c(".card-tag","padding"),radius:c(".card-tag","borderRadius"),size:c(".card-tag","fontSize"),weight:c(".card-tag","fontWeight"),text:q(".card-tag").textContent},' +
    'tagLeft:box(".card-tag").x-box(".card-foot").x});});</script>';
  fs.writeFileSync(path.join(work, "card.html"), page);

  const measure = (width) => {
    const run = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
      "--window-size=" + width + ",900", "--virtual-time-budget=3000", "--user-data-dir=" + path.join(work, "p" + width),
      "--dump-dom", pathToFileURL(path.join(work, "card.html")).href], { encoding: "utf8", timeout: 60000 });
    const m = (run.stdout || "").match(/<pre id="out">([\s\S]*?)<\/pre>/);
    assert.ok(m, "no result at " + width + "px:\n" + (run.stderr || "").slice(0, 300));
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  };

  const d = measure(1280);
  assert.ok(d.order[0] < d.order[1] && d.order[1] < d.order[2], "header order: title, subtitle, date");
  assert.deepEqual(d.title, ["30px", "700"]);
  assert.deepEqual(d.kicker.slice(0, 3), ["16px", "700", "uppercase"]);
  assert.equal(d.kicker[3], "1px");
  assert.deepEqual(d.date, ["14px", "700", "uppercase"]);
  assert.equal(d.excerpt[0], "19px");
  assert.ok(Math.abs(parseFloat(d.excerpt[1]) - 19 * 1.7) < 0.6, "line height 1.7");
  assert.equal(d.more[0], "700");
  assert.equal(d.more[1], d.more[2], "Read More is inline at the text size");
  assert.ok(/^420px /.test(d.cols), "image column is 420px: " + d.cols);
  assert.equal(d.gap, "48px");
  assert.equal(d.bodyPad, "28px");
  assert.equal(d.headPad, "24px 28px 0px");
  assert.equal(d.radius, "8px");
  assert.equal(d.imgRadius, "0px");
  assert.equal(d.foot.pad, "18px 28px");
  assert.ok(Math.abs(d.foot.w - d.foot.card) <= 2, "footer band is full-bleed");
  assert.ok(Math.abs(d.rule.w - d.rule.card) <= 2 && d.rule.top === "1px", "divider is full-bleed and 1px");
  assert.deepEqual([d.tag.pad, d.tag.radius, d.tag.size, d.tag.weight, d.tag.text], ["10px 18px", "8px", "15px", "700", "Stereo"]);
  assert.ok(Math.abs(d.tagLeft - 28) <= 1, "tag is left-aligned inside the footer padding");

  const phone = measure(700);
  assert.ok(!/^420px /.test(phone.cols) && phone.cols.split(" ").length === 1, "single column under 960px: " + phone.cols);
  assert.equal(phone.title[0], "24px");
  console.log("ok: listing card geometry matches the spec (" + path.basename(browser) + ")");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

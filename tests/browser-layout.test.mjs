// Real-browser check of the editor's gallery and photo sizing (jsdom cannot lay anything out).
// Runs the actual stylesheet and post-builder.js in headless Chrome or Edge at a desktop and a phone width.
// Skipped, not failed, when no Chromium browser is installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_root.mjs";

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
  console.log("skipped: no Chrome or Edge found (set CHROME_BIN to run the browser layout checks)");
  process.exit(0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-layout-"));
try {
  const cssUrl = pathToFileURL(path.join(ROOT, "site/assets/css/style.css")).href;
  const jsUrl = pathToFileURL(path.join(ROOT, "site/admin/post-builder.js")).href;
  let html = fs.readFileSync(path.join(ROOT, "site/admin/index.html"), "utf8");
  html = html.replace('href="/assets/css/style.css"', 'href="' + cssUrl + '"');
  html = html.replace(/<script src="\/admin\/[a-z-]+\.js"><\/script>\s*/g, "");
  html = html.replace(/<script src="\/assets\/js\/nav\.js"[^>]*><\/script>/, "");
  const probe = `
<script>window.AdminShell = { api: async function () { return {}; }, onSession: function (l) { l(true); }, expired: function () {} };</script>
<script src="${jsUrl}"></script>
<script>
window.addEventListener("load", function () {
  var $ = function (id) { return document.getElementById(id); };
  var out = {};
  document.querySelectorAll(".admin-panel").forEach(function (p) { p.hidden = p.dataset.panel !== "post-builder"; });
  $("admin-app").hidden = false;
  var editor = $("post-content");
  var px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAHCAYAAAAxrNxjAAAAFklEQVR4nGP8z8Dwn4EIwESMolGFlCkEAGB9AQ0J3wsiAAAAAElFTkSuQmCC";
  var sel = getSelection(), range = document.createRange();
  editor.focus(); range.selectNodeContents(editor); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
  document.execCommand("insertHTML", false, '<figure data-gallery="2"><img src="' + px + '" alt=""><img src="' + px + '" alt=""><img src="' + px + '" alt=""></figure><p><br></p>');
  var figure = editor.querySelector("figure");
  figure.querySelector("img").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  var set = function (id, value) { $(id).value = value; $(id).dispatchEvent(new Event("change", { bubbles: true })); };
  var box = function (el) { var r = el.getBoundingClientRect(); return { w: r.width, left: r.left }; };
  var editorBox = box(editor);
  var ecs = getComputedStyle(editor);
  out.editorWidth = editor.clientWidth - parseFloat(ecs.paddingLeft) - parseFloat(ecs.paddingRight);   // the space photos are laid out in
  out.controlsEnabled = !$("image-width").disabled && !$("image-align").disabled;
  set("image-width", "100"); set("image-align", "c");
  out.full = box(figure).w;
  set("image-width", "50");
  out.half = box(figure).w;
  out.halfMarginLeft = parseFloat(getComputedStyle(figure).marginLeft);
  out.halfMarginRight = parseFloat(getComputedStyle(figure).marginRight);
  set("image-width", "25"); out.quarter = box(figure).w;
  set("image-width", "75"); out.threeQuarter = box(figure).w;
  set("image-width", "50"); set("image-align", "l");
  out.leftFloat = getComputedStyle(figure).float;
  out.leftMarginRight = parseFloat(getComputedStyle(figure).marginRight);
  set("image-align", "r");
  out.rightFloat = getComputedStyle(figure).float;
  out.rightMarginLeft = parseFloat(getComputedStyle(figure).marginLeft);
  // a single photo
  var p = document.createElement("p"); editor.appendChild(p);
  var r2 = document.createRange(); r2.selectNodeContents(p); sel.removeAllRanges(); sel.addRange(r2);
  document.execCommand("insertHTML", false, '<img src="' + px + '" alt="" data-w="100" data-a="c">');
  var single = Array.from(editor.querySelectorAll("img")).filter(function (i) { return !i.closest("figure"); })[0];
  single.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  set("image-width", "50");
  out.singleHalf = box(single).w;
  out.singleControlsEnabled = !$("image-width").disabled;
  var pre = document.createElement("pre"); pre.id = "probe-out"; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
});
</script>`;
  fs.writeFileSync(path.join(work, "probe.html"), html.replace("</body>", probe + "</body>"));

  const measure = (width) => {
    const run = spawnSync(browser, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
      "--window-size=" + width + ",1000", "--virtual-time-budget=4000", "--user-data-dir=" + path.join(work, "profile-" + width),
      "--dump-dom", pathToFileURL(path.join(work, "probe.html")).href
    ], { encoding: "utf8", timeout: 60000 });
    const match = (run.stdout || "").match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
    assert.ok(match, "the probe page produced no result at " + width + "px:\n" + (run.stderr || "").slice(0, 400));
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  };
  const near = (value, expected, label) => assert.ok(Math.abs(value - expected) <= 3, label + ": got " + Math.round(value) + ", expected about " + Math.round(expected));

  for (const width of [1280, 480]) {
    const m = measure(width);
    const label = width + "px window";
    assert.equal(m.controlsEnabled, true, label + ": width and alignment are live for a gallery photo");
    near(m.full, m.editorWidth, label + " gallery at 100%");
    near(m.half, m.editorWidth * 0.5, label + " gallery at 50%");
    near(m.quarter, m.editorWidth * 0.25, label + " gallery at 25%");
    near(m.threeQuarter, m.editorWidth * 0.75, label + " gallery at 75%");
    // centred: equal margins either side
    near(m.halfMarginLeft, (m.editorWidth - m.half) / 2, label + " left margin when centred");
    near(m.halfMarginRight, (m.editorWidth - m.half) / 2, label + " right margin when centred");
    assert.equal(m.singleControlsEnabled, true, label + ": single photo controls live");
    near(m.singleHalf, m.editorWidth * 0.5, label + " single photo at 50%");
    if (width > 600) {
      assert.equal(m.leftFloat, "left", label + ": left floats");
      assert.equal(m.rightFloat, "right", label + ": right floats");
    } else {
      assert.equal(m.leftFloat, "none", label + ": no floating on a phone");
      assert.equal(m.rightFloat, "none");
      assert.ok(m.rightMarginLeft > 0, label + ": right alignment pushes to the right edge");
      assert.equal(m.leftMarginRight > 0, true, label + ": left alignment keeps the free space on the right");
    }
  }
  console.log("ok: gallery and photo sizing in a real browser (" + path.basename(browser) + ", desktop and phone widths)");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

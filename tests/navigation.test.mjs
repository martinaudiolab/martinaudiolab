import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const S = ROOT + "site/";
const navjs = fs.readFileSync(S + "assets/js/nav.js", "utf8");
function load(file, hover) {
  const html = fs.readFileSync(S + file, "utf8").replace(/<script src="[^"]*nav.js" defer><\/script>/, "").replace(/<script src="[^"]*(forsale|lightbox).js" defer><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://site.example/" + file, runScripts: "outside-only" });
  dom.window.matchMedia = () => ({ matches: hover });
  dom.window.eval(navjs);
  return dom.window;
}
// touch device: click toggles, outside click and Escape close
let w = load("index.html", false);
const dd = w.document.querySelector(".dd"), t = dd.querySelector(".dd-toggle");
t.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
assert.ok(dd.classList.contains("open")); assert.equal(t.getAttribute("aria-expanded"), "true");
w.document.body.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
assert.ok(!dd.classList.contains("open")); assert.equal(t.getAttribute("aria-expanded"), "false");
t.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
dd.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
assert.ok(!dd.classList.contains("open"));
// mouse device: hover opens, click keeps it open
w = load("index.html", true);
const d2 = w.document.querySelector(".dd");
d2.dispatchEvent(new w.MouseEvent("mouseenter"));
assert.ok(d2.classList.contains("open"));
d2.querySelector(".dd-toggle").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
assert.ok(d2.classList.contains("open"));
d2.dispatchEvent(new w.MouseEvent("mouseleave"));
assert.ok(!d2.classList.contains("open"));
// nav order and labels on several pages
const somePost = ["stereo", "radio", "test-equipment"].flatMap((d) => (fs.existsSync(S + d) ? fs.readdirSync(S + d).filter((n) => n !== "index.html" && n.endsWith(".html")).map((n) => d + "/" + n) : []))[0];
for (const f of ["index.html", "about.html", "request.html", "shop/index.html", "stereo/index.html"].concat(somePost ? [somePost] : [])) {
  const win = load(f, true);
  const labels = Array.from(win.document.querySelectorAll("nav > a, nav > .dd > .dd-toggle")).map((n) => n.textContent);
  assert.deepEqual(labels, ["Home", "Shop", "Request a Restoration", "Restoration Blog", "About Me"], f);
  assert.deepEqual(Array.from(win.document.querySelectorAll(".dd-menu a")).map((n) => n.textContent), ["All Posts", "Stereo Repair", "Radio Repair", "Test Equipment"]);
}
// homepage
w = load("index.html", true);
const main = w.document.querySelector("main");
assert.equal(main, null, "the homepage has no centered container");
const bodyKids = Array.from(w.document.body.children).map((n) => n.tagName + (n.className ? "." + n.className : ""));
assert.ok(bodyKids.indexOf("SECTION.hero") > bodyKids.indexOf("HEADER.site"));
assert.ok(bodyKids.indexOf("SECTION.forsale") > bodyKids.indexOf("SECTION.hero") && bodyKids.indexOf("DIV.cats") > bodyKids.indexOf("SECTION.forsale"), "hero, For Sale Now, then category rows, all full width");
assert.equal(w.document.body.className, "home");
assert.ok(!w.document.body.textContent.includes("My Philosophy"));
assert.equal(w.document.querySelector(".lead"), null, "intro paragraph removed");
const rows = Array.from(w.document.querySelectorAll(".cats .cat-row")).map((r) => [
  r.querySelector("h2").textContent, r.querySelector(".cat-cta").getAttribute("href"), r.querySelector(".cat-cta").textContent,
  !!r.querySelector(".cat-media img"), r.querySelector("p") ? true : false
]);
assert.deepEqual(rows, [
  ["Stereo Repair", "/stereo/", "See the work", true, true],
  ["Radio Repair", "/radio/", "See the work", true, true],
  ["Test Equipment", "/test-equipment/", "See the work", true, true]
]);
assert.equal(w.document.querySelector(".cats .cat-row .cat-media").nextElementSibling.className, "cat-text", "image then text in markup");
assert.equal(w.document.querySelectorAll(".cat-row img").length, 3);
// about page: five cards, the first heading is the page heading, every section's text kept
const about = load("about.html", true).document;
assert.equal(about.querySelectorAll("h1").length, 1);
assert.ok(about.querySelector(".about-cards .cat-row h1").textContent === "About Me");
const cards = Array.from(about.querySelectorAll(".about-cards .cat-row"));
assert.deepEqual(cards.map((c) => c.querySelector("h1, h2").textContent), ["About Me", "Philosophy", "Quality", "Skillset", "Sound Quality"]);
assert.ok(cards.every((c) => c.querySelector(".cat-media img")), "each card has a picture");
assert.ok(cards[4].textContent.includes("Every single modern high end audio products embraces new technology"));
console.log("ok: nav, dropdown behavior, homepage, about");
{
  const { renderHome } = await import(ROOT_URL + "shared/site-render.mjs");
  const { normalizeContent } = await import(ROOT_URL + "shared/site-content.mjs");
  const html = renderHome(normalizeContent({ theme: "light" }));
  assert.ok(!html.includes('id="th"') && !html.includes("data-theme") && !html.includes('getItem("th")'), "no theme toggle or theme script");
  const css = fs.readFileSync(ROOT + "site/assets/css/style.css", "utf8");
  assert.ok(!/prefers-color-scheme|data-theme|button\.theme/.test(css) && /:root\{color-scheme:dark;--bg:#141a19/.test(css), "dark palette only");
  assert.equal(normalizeContent({ theme: "light" }).theme, undefined);
  console.log("ok: theme toggle removed, dark palette only");
}

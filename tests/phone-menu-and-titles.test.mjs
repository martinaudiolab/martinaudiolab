// The phone menu button (nav.js) and the one title style used across the site.
import { ROOT } from "./_root.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const navjs = fs.readFileSync(ROOT + "site/assets/js/nav.js", "utf8");
const css = fs.readFileSync(ROOT + "site/assets/css/style.css", "utf8");

function boot(file) {
  const html = fs.readFileSync(ROOT + "site/" + file, "utf8").replace(/<script\b[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://site.example/", runScripts: "outside-only" });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.eval(navjs);
  const d = dom.window.document;
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const key = (k) => d.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  return { d, click, key, header: d.querySelector("header.site"), button: d.querySelector(".menu-toggle"), nav: d.querySelector("header.site nav") };
}

// ---- 1. the button: added after the brand, controls the navigation, closed to start ------------------------------
for (const file of ["index.html", "request.html", "about.html", "shop/index.html", "stereo/index.html", "404.html"]) {
  const { header, button, nav } = boot(file);
  assert.ok(header.classList.contains("has-menu"), file + ": header marked as having the menu");
  assert.ok(button && button.previousElementSibling.classList.contains("brand"), file + ": button follows the brand");
  assert.equal(button.getAttribute("aria-controls"), nav.id);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-label"), "Menu");
  assert.equal(button.type, "button");
}
console.log("ok 1: every page gets a menu button");

// ---- 2. opening and closing -------------------------------------------------------------------------------------
{
  const { d, click, key, header, button, nav } = boot("request.html");
  click(button);
  assert.ok(header.classList.contains("menu-open") && button.getAttribute("aria-expanded") === "true" && button.getAttribute("aria-label") === "Close menu");
  click(button);
  assert.ok(!header.classList.contains("menu-open"), "the button toggles");
  click(button); click(nav.querySelector("a"));
  assert.ok(!header.classList.contains("menu-open"), "choosing a page closes it");
  click(button); key("Escape");
  assert.ok(!header.classList.contains("menu-open") && d.activeElement === button, "Escape closes and returns focus");
  click(button); click(d.querySelector("main"));
  assert.ok(!header.classList.contains("menu-open"), "tapping outside closes it");
  click(button); click(nav.querySelector(".dd-toggle"));
  assert.ok(header.classList.contains("menu-open"), "the blog heading inside the menu does not close it");
  console.log("ok 2: menu opens and closes");
}

// ---- 3. styles: only phones with the button hide the bar; the open menu lists the blog sections ------------------
{
  assert.match(css, /\.menu-toggle\{display:none\}/, "hidden on wider screens");
  const phone = css.slice(css.indexOf(".menu-toggle{display:none}"));
  assert.match(phone, /@media\(max-width:700px\)\{[\s\S]*header\.site\.has-menu nav\{display:none\}/, "the bar hides only under the menu button, on phones");
  assert.match(phone, /header\.site\.has-menu\.menu-open nav\{display:flex;flex-direction:column/);
  assert.match(phone, /header\.site\.has-menu\.menu-open \.dd-menu\{display:block;position:static/, "blog sections listed in place");
  assert.ok(!/(^|[}\s])header\.site nav\{display:none/.test(css), "never hidden without the button (no JavaScript)");
  console.log("ok 3: phone menu styles");
}

// ---- 4. one title style: thin spaced uppercase sans for banners, listings, posts and simple pages -----------------
{
  const shared = css.match(/\.hero-text h1,h1\.post-title,\.shop-info h1,\.sections h2,\.h2,\.post h2\{([^}]*)\}/);
  assert.ok(shared, "one shared rule for the page titles");
  assert.match(shared[1], /font-family:var\(--sans\);font-weight:400;text-transform:uppercase/);
  assert.ok(css.lastIndexOf(shared[0]) > css.indexOf(".hero-text h1{font-size:clamp(1.9rem"), "comes after the older banner rule");
  assert.match(css, /article\.post\.post-card \.card-head h2\{[^}]*font:400 28px\/1\.25 var\(--sans\);letter-spacing:2\.5px;text-transform:uppercase/, "blog card titles match");
  assert.match(css, /\.cat-copy h1,\.cat-copy h2\{[^}]*font-weight:400;letter-spacing:3\.5px;text-transform:uppercase/, "the homepage cards they follow");
  console.log("ok 4: one title style");
}

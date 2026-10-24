import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderHome } from "../shared/site-render.mjs";
import { normalizeContent } from "../shared/site-content.mjs";
const script = fs.readFileSync(ROOT + "site/assets/js/hero.js", "utf8");
const css = fs.readFileSync(ROOT + "site/assets/css/style.css", "utf8");

const content = normalizeContent({
  homepage: { hero: { slides: [
    { image: "images/site/a.jpg", alt: "One" }, { image: "images/site/b.jpg", alt: "Two" },
    { image: "images/site/c.jpg", alt: "Three" }, { image: "images/site/d.jpg", alt: "Four" }, { image: "images/site/e.jpg", alt: "Too many" }
  ] } }
});
assert.equal(content.homepage.hero.slides.length, 4, "capped at four");
const html = renderHome(content).replace(/<script src="[^"]*"[^>]*><\/script>/g, "");

function boot({ reduced = false, observer = true, loaded = "all" } = {}) {
  const dom = new JSDOM(html, { url: "https://site.example/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  // jsdom does not fetch pictures, so describe them: "all" loaded, or a list of indexes that are, or "failed" for none that arrived
  Array.from(w.document.querySelectorAll(".hero-slide")).forEach((img, i) => {
    const ok = loaded === "all" || (Array.isArray(loaded) && loaded.includes(i));
    Object.defineProperty(img, "complete", { value: true, configurable: true });
    Object.defineProperty(img, "naturalWidth", { value: ok ? 1600 : 0, configurable: true });
  });
  w.matchMedia = () => ({ matches: reduced });
  const intervals = [];
  w.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  const observers = [];
  if (observer) {
    w.IntersectionObserver = function (cb, options) { this.cb = cb; this.options = options; this.observe = () => {}; observers.push(this); };
  } else {
    delete w.IntersectionObserver;
  }
  w.eval(script);
  return { w, d: w.document, intervals, observers };
}

// markup
{
  const { d } = boot();
  const slides = Array.from(d.querySelectorAll(".hero-slide"));
  assert.equal(slides.length, 4);
  assert.deepEqual(slides.map((s) => s.alt), ["One", "Two", "Three", "Four"]);
  assert.ok(slides[0].classList.contains("active") && !slides[1].classList.contains("active"));
  assert.ok(d.querySelector(".hero-scrim") && d.querySelector(".hero-text h1") && d.querySelector(".hero-text p"));
  assert.equal(d.querySelector(".hero button, .hero .dot, .hero [role=tablist]"), null, "no indicators or arrows");
  console.log("ok 1: hero markup, 4 slides max, no controls");
}

// slideshow: 5.5s interval, crossfade via classes, loops, skips while tab hidden
{
  const { w, d, intervals } = boot();
  assert.equal(intervals.length, 1);
  assert.ok(intervals[0].ms >= 5000 && intervals[0].ms <= 6000, "advance every 5-6 seconds");
  const active = () => Array.from(d.querySelectorAll(".hero-slide")).map((s) => s.classList.contains("active"));
  assert.deepEqual(active(), [true, false, false, false]);
  intervals[0].fn(); assert.deepEqual(active(), [false, true, false, false]);
  intervals[0].fn(); intervals[0].fn();
  assert.deepEqual(active(), [false, false, false, true]);
  intervals[0].fn(); assert.deepEqual(active(), [true, false, false, false], "loops back to the first image");
  Object.defineProperty(d, "hidden", { value: true, configurable: true });
  intervals[0].fn(); assert.deepEqual(active(), [true, false, false, false], "paused in a background tab");
  assert.equal(d.querySelectorAll('.hero-slide[aria-hidden="true"]').length, 3);
  console.log("ok 2: crossfade sequencing");
}

// one image is a still; reduced motion disables autoplay
{
  const single = renderHome(normalizeContent({})).replace(/<script src="[^"]*"[^>]*><\/script>/g, "");
  const dom = new JSDOM(single, { url: "https://site.example/", runScripts: "outside-only" });
  let started = 0;
  dom.window.setInterval = () => { started++; };
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.IntersectionObserver = function () { this.observe = () => {}; };
  dom.window.eval(script);
  assert.equal(dom.window.document.querySelectorAll(".hero-slide").length, 1);
  assert.equal(started, 0, "no timer for a single image");
  assert.equal(boot({ reduced: true }).intervals.length, 0, "no autoplay when reduced motion is requested");
  console.log("ok 3: single image and reduced motion");
}

// navigation turns solid once the hero is scrolled past (and back)
{
  const { d, observers } = boot();
  const header = d.querySelector("header.site");
  assert.equal(observers.length, 1);
  assert.match(observers[0].options.rootMargin, /^-\d+px 0px 0px 0px$/);
  observers[0].cb([{ isIntersecting: false }]);
  assert.ok(header.classList.contains("solid"));
  observers[0].cb([{ isIntersecting: true }]);
  assert.ok(!header.classList.contains("solid"));
  console.log("ok 4: nav solid after the hero (IntersectionObserver)");
}
{
  const { w, d } = boot({ observer: false });
  const header = d.querySelector("header.site");
  const hero = d.getElementById("hero");
  hero.getBoundingClientRect = () => ({ bottom: -10 });
  w.dispatchEvent(new w.Event("scroll"));
  assert.ok(header.classList.contains("solid"));
  hero.getBoundingClientRect = () => ({ bottom: 300 });
  w.dispatchEvent(new w.Event("scroll"));
  assert.ok(!header.classList.contains("solid"));
  console.log("ok 5: nav solid after the hero (scroll fallback)");
}

// the stylesheet implements the spec values
{
  const must = [
    ["crossfade 800ms ease-in-out", /\.hero-slide\{[^}]*transition:opacity \.8s ease-in-out/],
    ["nav is out of flow", /body\.home header\.site\{position:fixed;top:0;left:0;right:0/],
    ["solid nav colour", /body\.home header\.site\.solid\{background:rgba\(18,18,18,\.95\)\}/],
    ["one continuous square bar with blur", /body\.home nav(?:,body\.navbar nav)?\{gap:0;padding:0;border-radius:0;background:rgba\(0,0,0,\.45\);-webkit-backdrop-filter:blur\(4px\);backdrop-filter:blur\(4px\)\}/],
    ["items are flush, transparent pills", /body\.home nav > a,body\.home \.dd-toggle(?:,body\.navbar nav > a,body\.navbar \.dd-toggle)?\{[^}]*background:none;[^}]*padding:12px 18px/],
    ["hover lightens", /body\.home nav > a:hover[^{]*\{color:#fff;background:rgba\(255,255,255,\.14\)\}/],
    ["gradient scrim", /\.hero-scrim\{[^}]*linear-gradient\(to top/],
    ["hero is full width", /\.hero\{position:relative;width:100%/]
  ];
  must.forEach(([name, re]) => assert.match(css, re, name));
  assert.ok(!/\.banner\{/.test(css), "old boxed banner removed");
  console.log("ok 6: stylesheet matches the spec");
}

// phones: the bar fills the width in tidy rows, and the dropdown no longer forces its own full-width row
{
  const phone = css.slice(css.indexOf("@media(max-width:700px){"));
  const must = [
    ["bar spans the width", /body\.home nav,body\.navbar nav\{width:100%\}/],
    ["items share each row", /body\.home nav > a,body\.home \.dd,body\.navbar nav > a,body\.navbar \.dd\{flex:1 1 auto;text-align:center\}/],
    ["comfortable touch targets", /padding:11px 10px;font-size:\.85rem/],
    ["dropdown overlays", /body\.home \.dd-menu,body\.navbar \.dd-menu\{position:absolute;top:100%;left:0;min-width:max\(100%,11\.5rem\)/]
  ];
  must.forEach(([n, re]) => assert.match(phone, re, n));
  // the generic small-screen rule that made the dropdown a full-width row is overridden for the bars
  assert.match(css, /@media\(max-width:600px\)\{\s*\.dd\{flex-basis:100%\}/);
  assert.ok(css.indexOf("body.home nav > a,body.home .dd,body.navbar") > css.indexOf(".dd{flex-basis:100%}"), "override comes later");
  console.log("ok 7: phone navigation layout");
}

// banner pictures are requested up front: no lazy loading, a preload hint for the first, the rest after it
{
  const { renderHome } = await import("../shared/site-render.mjs");
  const out = renderHome(normalizeContent({ homepage: { hero: { slides: [{ image: "images/site/a.jpg" }, { image: "images/site/b.jpg" }, { image: "images/site/c.jpg" }] } } }));
  const slides = Array.from(out.matchAll(/<img class="hero-slide[^>]*>/g)).map((m) => m[0]);
  assert.equal(slides.length, 3);
  assert.ok(slides.every((t) => !/loading="lazy"/.test(t)), "no lazy loading on banner pictures");
  assert.ok(/fetchpriority="high"/.test(slides[0]) && slides.slice(1).every((t) => /fetchpriority="low"/.test(t)), "first picture high priority, others low");
  const head = out.slice(0, out.indexOf("</head>"));
  assert.ok(head.includes('<link rel="preload" as="image" href="/images/site/a.jpg" fetchpriority="high">'), "first picture is preloaded from the head");
  assert.equal((head.match(/rel="preload"/g) || []).length, 1, "only the first picture is preloaded");
  console.log("ok 8: banner pictures are requested up front");
}

// the slideshow only fades to a picture that has loaded, and asks again for one that failed
{
  const { d, w, intervals } = boot({ loaded: [0, 2] });          // picture 1 never arrived
  const active = () => Array.from(d.querySelectorAll(".hero-slide")).map((i) => i.classList.contains("active"));
  intervals[0].fn();
  assert.deepEqual(active().slice(0, 3), [false, false, true], "skipped the picture that has not loaded");
  intervals[0].fn();
  assert.equal(active()[0], true, "and comes back around to the first");

  const failed = boot({ loaded: "failed" });
  const before = failed.intervals.length;
  failed.intervals[0].fn();
  assert.equal(Array.from(failed.d.querySelectorAll(".hero-slide")).filter((i) => i.classList.contains("active")).length, 1, "stays on the current picture when none other has loaded");

  // an error event schedules a new request with a cache-busting parameter, up to three times
  const timers = [];
  const retry = boot({ loaded: [0] });
  retry.w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const first = retry.d.querySelector(".hero-slide");
  assert.ok(first.getAttribute("src"));
  for (let attempt = 1; attempt <= 4; attempt++) {
    first.dispatchEvent(new retry.w.Event("error"));
    if (attempt <= 3) {
      assert.equal(timers.length, attempt, "a retry is scheduled (attempt " + attempt + ")");
      timers[attempt - 1].fn();
      assert.ok(new URL(first.src).searchParams.get("r") === String(attempt), "request carries r=" + attempt);
    } else {
      assert.equal(timers.length, 3, "gives up after three tries");
    }
  }
  console.log("ok 9: slideshow skips unloaded pictures and retries failed ones");
}

// banner and picture-row sizes come from the page width, never from the screen height: phone browsers change
// the visible height while you scroll, and anything sized from it grows and shrinks under the finger
{
  // The one exception is the request page's fixed full-window background, which must cover the window: it uses the
  // large viewport (lvh, and vh as its fallback), which stays the same while the toolbars come and go.
  const pageBg = (css.match(/\.page-bg\{[^}]*\}/) || [""])[0];
  assert.ok(/height:100lvh/.test(pageBg) && !/[ds]vh\b/.test(pageBg), "page background uses the stable large viewport");
  const sized = (css.replace(pageBg, "").match(/[{;]\s*(?:min-|max-)?height:[^;}]*/g) || []).filter((d) => /\b[0-9.]+(?:vh|dvh|svh|lvh)\b/.test(d));
  assert.deepEqual(sized, [], "heights set from the screen height: " + sized.join(" | "));
  assert.match(css, /\.hero\{[^}]*height:clamp\(28rem,45vw,46rem\);contain:layout paint/, "banner has a definite, width-based height");
  console.log("ok 10: banner sizes do not depend on the screen height");
}

import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderHome } from "../scripts/site-render.mjs";
import { normalizeContent } from "../scripts/site-content.mjs";
const R = ROOT + "";
const script = fs.readFileSync(R + "site/assets/js/reveal.js", "utf8");
const css = fs.readFileSync(R + "site/assets/css/style.css", "utf8");
const full = renderHome(normalizeContent({}));
assert.ok(full.includes('<script src="/assets/js/reveal.js" defer>'), "homepage loads reveal.js");
const html = full.replace(/<script src="[^"]*"[^>]*><\/script>/g, "");

function boot({ observer = true, reduced = false } = {}) {
  const dom = new JSDOM(html, { url: "https://site.example/", runScripts: "outside-only" });
  const w = dom.window;
  w.matchMedia = () => ({ matches: reduced });
  const observers = [];
  const frames = [];
  w.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const paint = () => { for (let i = 0; i < 2; i++) frames.splice(0).forEach((fn) => fn()); };
  if (observer) {
    w.IntersectionObserver = function (cb, options) {
      this.cb = cb; this.options = options; this.seen = new Set(); this.gone = new Set();
      this.observe = (n) => this.seen.add(n);
      this.unobserve = (n) => this.gone.add(n);
      observers.push(this);
    };
  } else delete w.IntersectionObserver;
  w.eval(script);
  return { w, d: w.document, observers, frames, paint };
}

// 1. rows are armed and revealed one by one as they intersect, then released
{
  const { d, observers, frames, paint } = boot();
  const rows = Array.from(d.querySelectorAll(".cat-row"));
  assert.equal(rows.length, 3);
  assert.equal(observers.length, 1);
  assert.ok(d.querySelector(".cats").classList.contains("reveal-ready"), "hidden state armed immediately");
  assert.equal(observers[0].seen.size, 0, "rows are not watched until the hidden state has been painted");
  assert.equal(frames.length, 1);
  paint();
  assert.equal(observers[0].seen.size, 3);
  assert.ok(rows.every((r) => !r.classList.contains("in-view")), "hidden until scrolled to");
  observers[0].cb([{ target: rows[0], isIntersecting: false }]);
  assert.ok(!rows[0].classList.contains("in-view"), "not revealed while off screen");
  observers[0].cb([{ target: rows[0], isIntersecting: true }]);
  assert.ok(rows[0].classList.contains("in-view") && !rows[1].classList.contains("in-view"));
  assert.ok(observers[0].gone.has(rows[0]), "revealed rows are no longer observed");
  observers[0].cb([{ target: rows[1], isIntersecting: true }, { target: rows[2], isIntersecting: true }]);
  assert.ok(rows.every((r) => r.classList.contains("in-view")));
  console.log("ok 1: rows reveal as they scroll into view");
}

// 2. nothing is ever hidden without the observer, or with reduced motion
{
  const none = boot({ observer: false });
  assert.ok(!none.d.querySelector(".cats").classList.contains("reveal-ready"));
  const reduced = boot({ reduced: true });
  assert.ok(!reduced.d.querySelector(".cats").classList.contains("reveal-ready"));
  assert.equal(reduced.observers.length, 0);
  console.log("ok 2: no hiding without IntersectionObserver or with reduced motion");
}

// 3. styles: hidden state only under .reveal-ready; eased tween; heading larger and brighter
{
  const must = [
    ["hidden state is opt-in", /\.cats\.reveal-ready \.cat-row\{opacity:0;transform:translateY\(56px\);transition:opacity \.9s ease-out,transform \.9s ease-out\}/],
    ["revealed state", /\.cats\.reveal-ready \.cat-row\.in-view\{opacity:1;transform:none\}/],
    ["photo settles", /\.cats\.reveal-ready \.cat-media img\{transform:scale\(1\.07\)/],
    ["text follows", /\.cats\.reveal-ready \.cat-copy\{opacity:0;[^}]*\.3s/],
    ["reduced motion shows everything", /prefers-reduced-motion:reduce\)\{\s*\.cats\.reveal-ready \.cat-row,\.cats\.reveal-ready \.cat-copy\{opacity:1;transform:none;transition:none\}/],
    ["For Sale Now label is 26px and white", /\.fs-label\{[^}]*font-size:26px;[^}]*color:#fff\}/]
  ];
  must.forEach(([n, re]) => assert.match(css, re, n));
  assert.ok(!/\.cat-row\{[^}]*opacity:0/.test(css.replace(/\.cats\.reveal-ready[^{]*\{[^}]*\}/g, "")), "no unconditional hiding");
  console.log("ok 3: reveal styles and larger heading");
}

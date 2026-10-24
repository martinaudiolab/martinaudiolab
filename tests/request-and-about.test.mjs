import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const S = ROOT + "site/";
const html = fs.readFileSync(S + "request.html", "utf8").replace('<script src="/assets/js/request.js" defer></script>', "").replace(/<script src="[^"]*nav.js" defer><\/script>/, "");
const script = fs.readFileSync(S + "assets/js/request.js", "utf8");

function boot(action, responder) {
  const page = html.replace(/ action="[^"]*"/, ' action="' + (action || "https://formspree.io/f/YOUR_FORM_ID") + '"');
  const dom = new JSDOM(page, { url: "https://site.example/request.html", runScripts: "outside-only" });
  const w = dom.window;
  const calls = [];
  w.fetch = async (url, init) => {
    const entries = {};
    init.body.forEach((v, k) => { entries[k] = v; });
    calls.push({ url, method: init.method, accept: init.headers.Accept, entries });
    return responder();
  };
  w.eval(script);
  const d = w.document;
  return { w, d, calls, form: d.getElementById("request-form"), result: d.getElementById("request-result"), button: d.querySelector(".request-submit") };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const submit = (w, form) => form.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
function fill(d) {
  d.getElementById("req-name").value = "Pat";
  d.getElementById("req-email").value = "pat@example.com";
  d.getElementById("req-model").value = "Zenith 6D221";
  d.getElementById("req-description").value = "No sound on the left channel.";
}

// structure and accessibility
{
  const { d, form } = boot();
  assert.equal(d.querySelector("main h1").textContent, "Request a Restoration");
  assert.ok(d.querySelector(".intro").textContent.trim().length > 0, "intro text from the content file");
  assert.equal(form.getAttribute("method"), "POST");
  assert.equal(form.getAttribute("action"), "https://formspree.io/f/YOUR_FORM_ID");
  const controls = Array.from(form.querySelectorAll("input:not([type=hidden]):not([name=_gotcha]), textarea"));
  assert.deepEqual(controls.map((c) => c.name), ["name", "email", "unit_model", "description"], "field order");
  assert.deepEqual(controls.map((c) => c.type), ["text", "email", "text", "textarea"]);
  assert.ok(controls.every((c) => c.required));
  controls.forEach((c) => {
    const label = form.querySelector('label[for="' + c.id + '"]');
    assert.ok(label, c.name + " has a label");
    assert.ok(label.compareDocumentPosition(c) & 4, "label precedes its input");
  });
  assert.deepEqual(controls.map((c) => form.querySelector('label[for="' + c.id + '"]').textContent), ["Name", "Email", "Unit Model Number", "Description of unit"]);
  assert.equal(form.querySelector("textarea").rows, 6);
  assert.equal(form.querySelector('input[name="_subject"]').value, "New Restoration Request \u2014 Martin Audio Labs");
  assert.equal(form.querySelector('input[name="_gotcha"]').style.display, "none");
  assert.equal(form.querySelector(".request-submit").textContent, "Send Request");
  assert.ok(!d.body.innerHTML.includes("mailto:"), "no mailto links");
  assert.ok(!/To get started|Or write to/.test(d.body.innerHTML));
  console.log("ok 1: structure, labels, field order, hidden fields");
}

// success: posts as JSON-accepting fetch, shows inline message, no redirect
{
  const { w, d, calls, form, result, button } = boot("https://formspree.io/f/abc123", async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  fill(d);
  submit(w, form); await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://formspree.io/f/abc123");
  assert.equal(calls[0].method, "POST"); assert.equal(calls[0].accept, "application/json");
  assert.deepEqual(Object.keys(calls[0].entries).sort(), ["_gotcha", "_subject", "description", "email", "name", "unit_model"]);
  assert.equal(calls[0].entries.unit_model, "Zenith 6D221");
  assert.equal(result.textContent, "Thanks \u2014 I'll get back to you within 1-2 business days.");
  assert.ok(result.classList.contains("ok"));
  assert.equal(d.getElementById("req-name").value, "", "form reset");
  assert.equal(button.disabled, false);
  console.log("ok 2: success path");
}

// server error and network failure are shown inline
{
  let b = boot("https://formspree.io/f/abc123", async () => ({ ok: false, status: 422, json: async () => ({ errors: [{ message: "email must be valid" }] }) }));
  fill(b.d); submit(b.w, b.form); await tick();
  assert.equal(b.result.textContent, "email must be valid");
  assert.ok(b.result.classList.contains("error"));
  assert.equal(b.d.getElementById("req-name").value, "Pat", "input kept on failure");
  b = boot("https://formspree.io/f/abc123", async () => { throw new Error("offline"); });
  fill(b.d); submit(b.w, b.form); await tick();
  assert.match(b.result.textContent, /did not send/);
  assert.equal(b.button.disabled, false);
  console.log("ok 3: failure paths");
}

// placeholder address: nothing is sent
{
  const b = boot(null, async () => ({ ok: true, json: async () => ({}) }));
  fill(b.d); submit(b.w, b.form); await tick();
  assert.equal(b.calls.length, 0);
  assert.match(b.result.textContent, /not connected yet/);
  console.log("ok 4: unconfigured form does not submit");
}
{
  const { renderRequest } = await import(ROOT_URL + "shared/site-render.mjs");
  const { normalizeContent } = await import(ROOT_URL + "shared/site-content.mjs");
  const fsx = await import("node:fs");
  const html = renderRequest(normalizeContent({ request_background: { slides: [{ image: "images/site/bg-a.jpg" }, { image: "javascript:x" }, { image: "images/site/bg-b.jpg" }] } }));
  assert.ok(html.includes('<body class="home request-page">'), "floating homepage nav");
  assert.ok(!html.includes('class="hero"') && !html.includes('class="hero-text"'), "no banner");
  const { JSDOM: J } = await import("jsdom");
  const d = new J(html).window.document;
  const bg = d.querySelector(".page-bg");
  assert.ok(bg && bg.id === "hero" && bg.getAttribute("aria-hidden") === "true", "decorative full-page background driven by hero.js");
  assert.deepEqual(Array.from(bg.querySelectorAll("img.hero-slide")).map((i) => i.getAttribute("src")), ["/images/site/bg-a.jpg", "/images/site/bg-b.jpg"], "unsafe image dropped");
  assert.ok(bg.compareDocumentPosition(d.querySelector("main")) & 4, "background comes before the content");
  assert.ok(d.querySelector('link[rel="preload"][href="/images/site/bg-a.jpg"]'), "first picture preloaded");
  assert.ok(d.querySelector('script[src="/assets/js/hero.js"]'));
  assert.deepEqual(normalizeContent({}).request_background.slides.map((s) => s.image), ["images/banner.jpg"], "default picture");
  const css = fsx.readFileSync(ROOT + "site/assets/css/style.css", "utf8");
  assert.match(css, /\.page-bg\{position:fixed;[^}]*height:100lvh;/);
  assert.match(css, /body\.request-page header\.site\{position:sticky\}/);
  assert.ok(css.indexOf("body.request-page header.site{position:sticky}") > css.indexOf("body.home header.site{position:fixed"), "sticky override comes later");
  assert.match(css, /\.request-wrap\{[^}]*background:rgba\(0,0,0,\.55\);[^}]*backdrop-filter:blur\(6px\)/);
  console.log("ok 5: request page has a full-page background, the floating nav and a translucent form panel");
}
{
  const { renderAbout } = await import(ROOT_URL + "shared/site-render.mjs");
  const { normalizeContent } = await import(ROOT_URL + "shared/site-content.mjs");
  const fsx = await import("node:fs");
  const { JSDOM: J } = await import("jsdom");
  const html = renderAbout(normalizeContent({ about: { title: "About Me", sections: [
    { heading: "About Me", body: "Hello.\n\nSecond.", image: "images/site/me.jpg" },
    { heading: "Quality", body: "Done right.", image: "javascript:x" }
  ] } }));
  assert.ok(html.includes('<body class="home about-page">') && !html.includes('class="hero"') && !html.includes("page-bg"), "floating nav, no banner");
  const d = new J(html).window.document;
  const rows = d.querySelectorAll(".cats.about-cards .cat-row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector("h1").textContent, "About Me");
  assert.ok(rows[0].classList.contains("in-view") && !rows[1].classList.contains("in-view"), "the top card is shown at once; the rest reveal on scroll");
  assert.equal(rows[0].querySelector(".cat-media img").getAttribute("src"), "/images/site/me.jpg");
  assert.equal(rows[0].querySelectorAll(".cat-copy p").length, 2, "paragraphs");
  assert.ok(rows[1].classList.contains("no-image") && !rows[1].querySelector("img"), "unsafe image dropped: text-only card");
  assert.equal(rows[1].querySelector("h2").textContent, "Quality");
  assert.ok(d.querySelector('script[src="/assets/js/reveal.js"]') && d.querySelector(".about-contact a[href^='mailto:']"));
  // without a heading on the first card, the title is still the page heading for screen readers
  const bare = new J(renderAbout(normalizeContent({ about: { title: "About", sections: [{ body: "Text only." }] } }))).window.document;
  assert.equal(bare.querySelector("h1.visually-hidden").textContent, "About");
  // content from before the cards: the bio becomes the first card
  const old = normalizeContent({ about: { title: "About Me", bio: "I'm Alex.", sections: [{ heading: "My Philosophy", body: "Text" }] } });
  assert.deepEqual(old.about.sections.map((s) => [s.heading, s.body, s.image]), [["About Me", "I'm Alex.", ""], ["My Philosophy", "Text", ""]]);
  assert.equal(old.about.bio, undefined);
  const css = fsx.readFileSync(ROOT + "site/assets/css/style.css", "utf8");
  assert.match(css, /body\.about-page header\.site\{position:sticky;background:rgba\(18,18,18,\.95\)\}/);
  assert.ok(css.indexOf("body.about-page header.site{position:sticky") > css.indexOf("body.home header.site{position:fixed"), "sticky override comes later");
  console.log("ok 6: about page is homepage-style cards under the floating nav");
}

import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const R = ROOT + "";
const html = fs.readFileSync(R + "site/admin.html", "utf8").replace('<script src="admin.js"></script>', "");
const script = fs.readFileSync(R + "site/admin.js", "utf8");
const seed = JSON.parse(fs.readFileSync(FIXTURES + "/site-content.json", "utf8"));
const dom = new JSDOM(html, { url: "https://site.example/admin#ticket=T", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const calls = [];
w.confirm = () => true;
w.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, body });
  const ok = (v) => ({ ok: true, status: 200, json: async () => v });
  if (path === "/api/session") return ok({ session: "S" });
  if (path === "/api/me") return ok({ role: "administrator" });
  if (path === "/api/content") return ok({ content: structuredClone(seed), contentSha: "a".repeat(40), shop: { title: "Shop", intro: "Intro" }, shopSha: "b".repeat(40) });
  if (path === "/api/content/publish") return ok({ contentSha: "c".repeat(40), shopSha: "d".repeat(40), content: body.content, shop: body.shop });
  throw new Error("unexpected " + path);
};
w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,QUJDRA==";
Object.defineProperty(w.Image.prototype, "src", { set() { Object.defineProperty(this, "naturalWidth", { value: 3000 }); Object.defineProperty(this, "naturalHeight", { value: 2000 }); setTimeout(() => this.onload && this.onload(), 0); } });
w.HeicSupport = { calls: [], isHeic: () => true, prepare: async (f) => { w.HeicSupport.calls.push(f.name); return f; } };
w.eval(script);
const $ = (id) => w.document.getElementById(id);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const input = (n, v) => { n.value = v; n.dispatchEvent(new w.Event("input", { bubbles: true })); };
const click = (n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await tick(60);

assert.equal($("admin-app").hidden, false);
assert.equal($("g-site-name").value, "Martin Audio Labs");
assert.equal($("h-title").value, seed.homepage.hero.title);
assert.equal($("c-enabled").checked, true);
assert.equal($("r-action").value, "https://formspree.io/f/YOUR_FORM_ID");
assert.equal($("s-title").value, "Shop");
assert.equal($("nav-editor").querySelectorAll(".ae-row").length, 5);
assert.equal($("category-editor").querySelectorAll(".ae-cat").length, 3);
assert.equal($("section-editor").querySelectorAll("textarea").length, 1);
assert.equal($("save").disabled, true);
console.log("ok: loaded and bound");

// tabs
click(w.document.querySelector('[data-tab="request"]'));
assert.equal(w.document.querySelector('[data-panel="request"]').hidden, false);
assert.equal(w.document.querySelector('[data-panel="global"]').hidden, true);

// edits
input($("g-site-name"), "New Name");
input($("h-trust"), "Free shipping");
$("c-enabled").checked = false; $("c-enabled").dispatchEvent(new w.Event("change", { bubbles: true }));
input($("r-success"), "Sent!");
assert.equal($("save").disabled, false);
// nav: add an item, rename, remove one
click($("add-nav"));
const rows = $("nav-editor").querySelectorAll(".ae-row");
assert.equal(rows.length, 6);
const last = rows[5].querySelectorAll("input");
input(last[0], "Extra"); input(last[1], "about.html#top");
click($("nav-editor").querySelectorAll(".ae-row")[1].querySelector('button[aria-label="Remove menu item"]'));
// about section edit + add
input($("section-editor").querySelector("input"), "Philosophy v2");
click($("add-section"));
assert.equal($("section-editor").querySelectorAll(".ae-row").length, 2);
// hero slideshow slots
assert.equal($("hero-slots").querySelectorAll(".ae-row").length, 4);
const slots = () => Array.from($("hero-slots").querySelectorAll(".ae-row"));
assert.equal(slots()[0].querySelector('button[aria-label^="Remove"]').disabled, true, "last remaining image cannot be removed");
assert.equal(slots()[1].querySelector('input[type=text]').disabled, true, "empty slot has no alt field");
const pickInto = async (slotIndex, name) => {
  const input = slots()[slotIndex].querySelector('input[type=file]');
  Object.defineProperty(input, "files", { value: [{ name }], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await tick(60);
};
await pickInto(1, "second.jpg");
await pickInto(3, "third.jpg");           // an empty slot further along joins the end of the list
assert.equal(slots()[2].querySelector("img") !== null, true);
input(slots()[0].querySelector('input[type=text]'), "Workshop bench");
input(slots()[1].querySelector('input[type=text]'), "A restored receiver");
// removing the middle image closes the gap
await pickInto(0, "first-replaced.jpg");
click(slots()[1].querySelector('button[aria-label^="Remove"]'));
assert.equal(slots().filter((r) => r.querySelector("img")).length, 2);

click($("save"));
await tick(60);
const pub = calls.find((c) => c.path === "/api/content/publish");
assert.ok(pub);
const b = pub.body;
assert.equal(b.contentSha, "a".repeat(40)); assert.equal(b.shopSha, "b".repeat(40));
assert.equal(b.content.site_name, "New Name");
assert.equal(b.content.homepage.trust_line, "Free shipping");
assert.equal(b.content.homepage.product_carousel.enabled, false);
assert.equal(b.content.request.success_message, "Sent!");
assert.deepEqual(b.content.nav_items.map((n) => n.label), ["Home", "Request a Restoration", "Restoration Blog", "About Me", "Extra"]);
assert.equal(b.content.nav_items[4].href, "about.html#top");
assert.equal(b.content.about.sections[0].heading, "Philosophy v2");
assert.equal(b.content.homepage.hero.slides.length, 2);
assert.equal(b.content.homepage.hero.slides[0].alt, "Workshop bench");
assert.equal(b.content.homepage.hero.slides[1].alt, "");
b.content.homepage.hero.slides.forEach((slide) => assert.match(slide.image, /^images\/site\/hero-[a-z0-9]+-[a-z0-9]{4}\.jpg$/));
const heroPaths = b.content.homepage.hero.slides.map((s) => s.image).sort();
assert.deepEqual(b.images.map((i) => i.path).sort(), heroPaths, "only referenced images are uploaded");
assert.ok(b.images.every((i) => i.data === "QUJDRA=="));
assert.equal($("save").disabled, true);
assert.match($("status").textContent, /Saved/);
// a second save does not re-upload the image
input($("h-title"), "Second");
click($("save")); await tick(60);
const pub2 = calls.filter((c) => c.path === "/api/content/publish")[1];
assert.equal(pub2.body.images.length, 0);
assert.equal(pub2.body.contentSha, "c".repeat(40));
console.log("ok: edits, nav editor, image upload and save payload");

assert.ok(w.HeicSupport.calls.includes("second.jpg") && w.HeicSupport.calls.includes("third.jpg"), "image picks go through the HEIC step");
console.log("ok: admin image picks use the HEIC step");

// the form is locked while a save is in flight, and unlocked again afterwards (also after a failure)
{
  const realFetch = w.fetch;
  let during = null, fail = false;
  w.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === "/api/content/publish") {
      during = $("admin-app").inert;
      if (fail) return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
    }
    return realFetch(url, init);
  };
  input($("g-name") || w.document.querySelector('[data-path="site_name"]'), "Polished Name");
  click($("save")); await tick(60);
  assert.equal(during, true, "inputs are inert during the save");
  assert.equal($("admin-app").inert, false, "unlocked afterwards");
  during = null; fail = true;
  input(w.document.querySelector('[data-path="site_name"]'), "Polished Name 2");
  click($("save")); await tick(60);
  assert.equal(during, true);
  assert.equal($("admin-app").inert, false, "unlocked after a failed save");
  assert.equal($("save").disabled, false, "can retry after a failure");
  console.log("ok: form locked only while saving");
}

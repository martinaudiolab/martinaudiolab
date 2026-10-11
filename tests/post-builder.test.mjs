import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const R = ROOT + "";
let html = fs.readFileSync(R + "site/admin/index.html", "utf8");
for (const s of ["admin.js", "shop-builder.js", "post-builder.js"]) html = html.replace('<script src="/admin/' + s + '"></script>', "");
const seed = JSON.parse(fs.readFileSync(FIXTURES + "/site-content.json", "utf8"));
const items = JSON.parse(fs.readFileSync(FIXTURES + "/items.json", "utf8"));
const SCRIPTS = ["admin.js", "shop-builder.js", "post-builder.js"].map((f) => fs.readFileSync(R + "site/admin/" + f, "utf8"));

function boot({ storage } = {}) {
  const dom = new JSDOM(html, { url: "https://site.example/admin#ticket=T", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.confirm = () => true;
  w.Element.prototype.scrollIntoView = () => {};
  if (storage === "blocked") Object.defineProperty(w, "localStorage", { get() { throw new Error("blocked"); } });
  else if (storage) Object.defineProperty(w, "localStorage", { value: storage });
  w.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const res = (status, v) => ({ ok: status < 400, status, json: async () => v });
    if (path === "/api/session") return res(200, { session: "S" });
    if (path === "/api/me") return res(200, { role: "administrator" });
    if (path === "/api/content") return res(200, { content: structuredClone(seed), contentSha: "a".repeat(40), shop: { title: "Shop", intro: "" }, shopSha: "b".repeat(40) });
    if (path === "/api/shop") return res(200, { sha: "c".repeat(40), data: structuredClone(items) });
    if (path === "/api/publish") return res(201, { filename: "p.html", section: "stereo" });
    if (path.startsWith("/api/posts")) return res(200, { category: "stereo", indexSha: "e".repeat(40), indexHtml: '<main><h1>Stereo Repair</h1><p class="intro">x</p><article class="post"><h2><a href="old-post.html">Old post</a></h2></article><article class="post"><h2><a href="https://x.example/y">External</a></h2></article></main>' });
    if (path === "/api/delete") return res(200, { filename: "old-post.html", section: "stereo" });
    throw new Error("unexpected " + path);
  };
  // jsdom cannot decode images: stand in for Image and canvas so the thumbnail step can run
  w.Image = function () {
    const o = { naturalWidth: (w.__dims || { w: 1440 }).w, naturalHeight: (w.__dims || { h: 720 }).h };
    let src = "";
    Object.defineProperty(o, "src", { get: () => src, set: (v) => { src = v; setTimeout(() => (w.__imageOk ? o.onload && o.onload() : o.onerror && o.onerror()), 0); } });
    return o;
  };
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(["scaled-" + this.width + "x" + this.height], { type: "image/jpeg" })); };
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {} });
  w.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/jpeg;base64,/9j/THUMB=" + this.width + "x" + this.height; };
  for (const s of SCRIPTS) w.eval(s);
  return { w, calls, $: (id) => w.document.getElementById(id) };
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};

// 1. sanitiser, observed through the publish payload
{
  const { w, calls, $ } = boot(); await tick(80);
  $("post-title").value = "Sanitise"; $("post-summary").value = "S";
  $("post-content").innerHTML =
    '<p><b>bold</b> <i>it</i> <u>u</u> <a href="javascript:alert(1)" onclick="x()">bad</a> <a href="https://ok.example/a" target="_blank">ok</a> <a href="#sec">hash</a>' +
    '<script>alert(1)</script><div>div text</div><span style="font-size:20px;color:#ff0000;position:fixed">s</span><span style="color:rgb(1,2,3)">c</span>' +
    '<img src="https://evil.example/x.png" alt="remote"><img src="data:image/png;base64,AAAA" alt="ok" data-w="50" data-a="l" onerror="x()" class="sel">' +
    '<img src="data:image/svg+xml;base64,AAAA"><img src="data:image/png;base64,BBBB" data-w="999" data-a="z"><font color="red">f</font></p>';
  $("pb-publish").click(); await tick();
  const c = calls.find((x) => x.path === "/api/publish").body.content;
  assert.ok(c.includes("<strong>bold</strong>") && c.includes("<em>it</em>") && c.includes("<u>u</u>"), c);
  assert.ok(!/javascript:|onclick|onerror|<script|target=|class=|<div|<font|evil\.example|svg\+xml/i.test(c), c);
  assert.ok(c.includes('href="https://ok.example/a"') && c.includes('href="#sec"') && c.includes("div text"), c);
  assert.ok(/<span style="font-size: 20px; color: (#ff0000|rgb\(255, 0, 0\))">s<\/span>/.test(c) && !c.includes("position"), c);
  assert.ok(c.includes('<img src="data:image/png;base64,AAAA" alt="ok" data-w="50" data-a="l">'), c);
  assert.ok(c.includes('<img src="data:image/png;base64,BBBB">'), c);
  console.log("ok 1: sanitiser (b/i kept as strong/em; scripts, handlers, bad links, remote/svg images dropped)");
}

// 2. blocked storage must not break the builder
{
  const { $ } = boot({ storage: "blocked" }); await tick(80);
  $("post-title").value = "T";
  $("save-draft").click();
  assert.match($("pb-status").textContent, /could not be saved/);
  $("preview-toggle").click();               // handlers registered after loadDraft still work
  assert.equal($("preview").hidden, false);
  assert.equal($("pb-publish").disabled, false);
  console.log("ok 2: blocked storage handled");
}

// 3. draft round trip, corrupt draft, clear
{
  const storage = fakeStorage();
  let b = boot({ storage }); await tick(80);
  b.$("category").value = "radio"; b.$("post-title").value = "Draft title"; b.$("post-summary").value = "Sum"; b.$("post-date").value = "2026-01-02";
  b.$("post-content").innerHTML = "<p>draft <b>body</b></p>";
  b.$("save-draft").click();
  assert.ok(storage.map.has("martin-audio-labs-post-draft"));
  b = boot({ storage }); await tick(80);
  assert.equal(b.$("post-title").value, "Draft title"); assert.equal(b.$("category").value, "radio");
  assert.equal(b.$("post-date").value, "2026-01-02");
  assert.equal(b.$("post-content").innerHTML, "<p>draft <strong>body</strong></p>");
  b.$("clear-draft").click();
  assert.equal(storage.map.size, 0); assert.equal(b.$("post-title").value, ""); assert.equal(b.$("post-content").innerHTML, "<p></p>");
  storage.map.set("martin-audio-labs-post-draft", "{not json");
  b = boot({ storage }); await tick(80);
  assert.equal(storage.map.size, 0, "corrupt draft removed");
  assert.equal(b.$("pb-publish").disabled, false);
  console.log("ok 3: drafts");
}

// 4. default date is the local date
{
  const { $ } = boot(); await tick(80);
  const d = new Date();
  const local = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  assert.equal($("post-date").value, local);
  console.log("ok 4: local date");
}

// 5. delete targets the section the list was loaded for; non-post links are ignored
{
  const { w, calls, $ } = boot(); await tick(80);
  w.document.querySelector('[data-tab="manage-posts"]').click(); await tick();
  assert.equal($("managed-posts").querySelectorAll(".managed-post").length, 1);
  $("manage-category").value = "radio";               // moved without reloading the list
  $("managed-posts").querySelector("button").click(); await tick();
  const del = calls.find((x) => x.path === "/api/delete").body;
  assert.equal(del.category, "stereo");
  assert.equal(del.slug, "old-post");
  assert.ok(!del.indexHtml.includes("old-post.html") && del.indexHtml.includes("x.example/y"));
  console.log("ok 5: delete uses the loaded section");
}

// 6. images: type check, selection tools
{
  const { w, $ } = boot(); await tick(80);
  const input = $("image-file");
  Object.defineProperty(input, "files", { value: [{ name: "a.svg", type: "image/svg+xml" }], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  assert.match($("pb-status").textContent, /PNG, JPEG, GIF, WebP or HEIC/);
  $("post-content").innerHTML = '<p><img src="data:image/png;base64,AAAA" alt="x" data-w="50" data-a="r"></p>';
  $("post-content").querySelector("img").click();
  assert.equal($("image-tools").hidden, false); assert.equal($("image-width").value, "50"); assert.equal($("image-align").value, "r");
  assert.ok($("post-content").querySelector("img").classList.contains("sel"));
  $("image-width").value = "75"; $("image-width").dispatchEvent(new w.Event("change"));
  assert.equal($("post-content").querySelector("img").dataset.w, "75");
  $("post-content").querySelector("p").click();
  assert.equal($("image-tools").hidden, true);
  $("post-content").querySelector("img").click();
  $("remove-image").click();
  assert.equal($("post-content").querySelector("img"), null);
  console.log("ok 6: image tools");
}

// 7. Manage Blog Posts tab: loads when opened, and when signing in while it is the active tab
{
  const { w, calls, $ } = boot(); await tick(80);
  const posts = () => calls.filter((c) => c.path.startsWith("/api/posts")).length;
  assert.equal(posts(), 0, "nothing loaded until the tab opens");
  assert.equal(w.document.querySelector('[data-panel="manage-posts"]').hidden, true);
  assert.ok(!w.document.querySelector('[data-panel="post-builder"]').innerHTML.includes("managed-posts"), "manager is not in the Post Builder panel");
  w.document.querySelector('[data-tab="manage-posts"]').click(); await tick();
  assert.equal(posts(), 1);
  assert.equal(w.document.querySelector('[data-panel="manage-posts"]').hidden, false);
  assert.equal(w.document.querySelector(".admin-save").hidden, true, "site-content save bar hidden");
  $("refresh-posts").click(); await tick();
  assert.equal(posts(), 2);
  $("manage-category").value = "radio"; $("manage-category").dispatchEvent(new w.Event("change")); await tick();
  assert.equal(posts(), 3);
  assert.ok(calls.at(-1).path.endsWith("category=radio"));
  // tab reopened after another tab
  w.document.querySelector('[data-tab="global"]').click();
  w.document.querySelector('[data-tab="manage-posts"]').click(); await tick();
  assert.equal(posts(), 4);
  console.log("ok 7: manage tab loading");
}

// 8. thumbnail: first photo in the post, none, or an unreadable image
{
  const { w, calls, $ } = boot(); await tick(80);
  $("post-title").value = "With photo"; $("post-summary").value = "S";
  const last = () => calls.filter((x) => x.path === "/api/publish").at(-1).body;
  w.__imageOk = true;
  $("post-content").innerHTML = '<p>x</p><img src="data:image/png;base64,AAAA" alt="a"><img src="data:image/png;base64,BBBB">';
  $("pb-publish").click(); await tick(100);
  assert.equal(last().thumbnail, "/9j/THUMB=1440x720", "first photo, kept at its size under 1600");

  $("post-content").innerHTML = "<p>no photo</p>";
  $("pb-publish").click(); await tick(100);
  assert.equal(last().thumbnail, "", "no photo, no thumbnail");

  w.__imageOk = false;
  $("post-content").innerHTML = '<img src="data:image/png;base64,AAAA">';
  $("pb-publish").click(); await tick(100);
  assert.equal(last().thumbnail, "", "unreadable image: publish continues without a thumbnail");
  console.log("ok 8: thumbnail from first photo, none, unreadable");
}

// 9. a HEIC photo inserted into a post is converted first; a failed conversion is reported
{
  const { w, $ } = boot(); await tick(80);
  let fail = false;
  w.HeicSupport = {
    detect: async (f) => f.name.toLowerCase().endsWith(".heic"),
    prepare: async (f) => { if (fail) throw new Error("IMG.heic could not be converted from HEIC."); return f.name.toLowerCase().endsWith(".heic") ? new w.File(["jpegbytes"], "IMG.jpg", { type: "image/jpeg" }) : f; }
  };
  const pick = async (file) => {
    const input = $("image-file");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await tick(120);
  };
  $("post-content").focus();
  w.document.execCommand = (cmd, _ui, value) => { if (cmd === "insertHTML") $("post-content").insertAdjacentHTML("beforeend", value); return true; };
  await pick(new w.File(["h"], "IMG.heic", { type: "image/heic" }));
  const img = $("post-content").querySelector("img");
  assert.ok(img && img.getAttribute("src").startsWith("data:image/jpeg;base64,"), "converted JPEG inserted");
  fail = true;
  const before = $("post-content").querySelectorAll("img").length;
  await pick(new w.File(["h"], "BAD.heic", { type: "image/heic" }));
  assert.equal($("post-content").querySelectorAll("img").length, before, "nothing inserted on failure");
  assert.ok($("pb-status").textContent.includes("could not be converted from HEIC"));
  console.log("ok 9: HEIC insert converts, failure reported");
}

// 10. big photos inserted into a post are scaled down; small ones are untouched
{
  const { w, $ } = boot(); await tick(80);
  w.__imageOk = true;
  w.document.execCommand = (cmd, _ui, value) => { if (cmd === "insertHTML") $("post-content").insertAdjacentHTML("beforeend", value); return true; };
  const pick = async (file) => {
    const input = $("image-file");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await tick(120);
  };
  const text = (src) => Buffer.from(src.slice(src.indexOf(",") + 1), "base64").toString();
  w.__dims = { w: 6000, h: 4000 };
  await pick(new w.File([new Uint8Array(1600000)], "dslr.png", { type: "image/png" }));
  let img = $("post-content").querySelector("img");
  assert.ok(img.getAttribute("src").startsWith("data:image/jpeg;base64,"));
  assert.equal(text(img.getAttribute("src")), "scaled-2400x1600", "long side limited to 2400");
  w.__dims = { w: 1200, h: 800 };
  await pick(new w.File([new Uint8Array(200000)], "small.png", { type: "image/png" }));
  img = $("post-content").querySelectorAll("img")[1];
  assert.ok(img.getAttribute("src").startsWith("data:image/png;base64,"), "small photo kept as is");
  w.__dims = { w: 6000, h: 4000 };
  await pick(new w.File([new Uint8Array(1600000)], "anim.gif", { type: "image/gif" }));
  img = $("post-content").querySelectorAll("img")[2];
  assert.ok(img.getAttribute("src").startsWith("data:image/gif;base64,"), "GIFs are never re-encoded");
  console.log("ok 10: inline photos scaled to a web size");
}

// 11. a post over the size limit is refused up front, before anything is uploaded
{
  const { w, calls, $ } = boot(); await tick(80);
  $("post-title").value = "Huge"; $("post-summary").value = "S";
  $("post-content").innerHTML = '<p><img src="data:image/png;base64,' + "A".repeat(4600000) + '"></p>';
  $("pb-publish").click(); await tick(150);
  assert.ok(!calls.some((c) => c.path === "/api/publish"), "nothing sent");
  assert.match($("pb-status").textContent, /over the 5 MB limit/);
  console.log("ok 11: oversized post refused before upload");
}

// 12. switching sections quickly: the newest request wins even if an older one answers last
{
  const { w, $ } = boot(); await tick(80);
  const real = w.fetch;
  const page = (title) => '<main><h1>X</h1><p class="intro">x</p><article class="post"><h2><a href="a-post.html">' + title + "</a></h2></article></main>";
  w.fetch = async (url, init) => {
    const p = new URL(url).pathname + new URL(url).search;
    if (p.startsWith("/api/posts")) {
      const radio = p.includes("category=radio");
      if (radio) await tick(150);
      return { ok: true, status: 200, json: async () => ({ category: radio ? "radio" : "stereo", indexSha: "e".repeat(40), indexHtml: page(radio ? "RadioOnly" : "StereoOnly") }) };
    }
    return real(url, init);
  };
  const select = $("manage-category");
  select.value = "radio"; select.dispatchEvent(new w.Event("change"));     // slow answer
  select.value = "stereo"; select.dispatchEvent(new w.Event("change"));    // fast answer
  await tick(400);
  const shown = Array.from($("managed-posts").querySelectorAll(".managed-post span")).map((n) => n.textContent);
  assert.deepEqual(shown, ["StereoOnly"], "the late radio answer did not overwrite the stereo list");
  console.log("ok 12: stale post-list answers ignored");
}

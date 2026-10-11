import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const R = ROOT + "";
let html = fs.readFileSync(R + "site/admin/index.html", "utf8");
for (const s of ["admin.js", "shop-builder.js", "post-builder.js"]) html = html.replace('<script src="/admin/' + s + '"></script>', "");
const seed = JSON.parse(fs.readFileSync(FIXTURES + "/site-content.json", "utf8"));
const items = JSON.parse(fs.readFileSync(FIXTURES + "/items.json", "utf8"));
const dom = new JSDOM(html, { url: "https://site.example/admin#ticket=T", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const calls = [];
let failPublishWith = null;
w.confirm = () => true;
w.Element.prototype.scrollIntoView = () => {};
w.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname + new URL(url).search;
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, body, auth: (init.headers || {}).Authorization });
  const res = (status, v) => ({ ok: status < 400, status, json: async () => v });
  if (path === "/api/session") return res(200, { session: "S" });
  if (path === "/api/me") return res(200, { role: "administrator" });
  if (path === "/api/logout") return res(200, {});
  if (path === "/api/content") return res(200, { content: structuredClone(seed), contentSha: "a".repeat(40), shop: { title: "Shop", intro: "" }, shopSha: "b".repeat(40) });
  if (path === "/api/shop") return res(200, { sha: "c".repeat(40), data: structuredClone(items) });
  if (path === "/api/shop/publish") return res(201, { sha: "d".repeat(40), data: body.data });
  if (path === "/api/publish") return failPublishWith ? res(failPublishWith, { error: "nope" }) : res(201, { filename: "my-post.html", section: "stereo" });
  if (path.startsWith("/api/posts")) return res(200, { indexSha: "e".repeat(40), indexHtml: '<main><h1>Stereo Repair</h1><p class="intro">x</p><article class="post"><h2><a href="old.html">Old post</a></h2></article></main>' });
  throw new Error("unexpected " + path);
};
for (const f of ["admin.js", "shop-builder.js", "post-builder.js"]) w.eval(fs.readFileSync(R + "site/admin/" + f, "utf8"));
const $ = (id) => w.document.getElementById(id);
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const click = (n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const input = (n, v) => { n.value = v; n.dispatchEvent(new w.Event("input", { bubbles: true })); };
await tick(80);

// one sign-in serves everything
assert.equal(calls.filter((c) => c.path === "/api/session").length, 1);
assert.equal($("admin-app").hidden, false);
assert.ok(calls.some((c) => c.path === "/api/shop" && c.auth === "Bearer S"));
const tabs = Array.from(w.document.querySelectorAll(".tab")).map((t) => t.textContent);
assert.deepEqual(tabs, ["Global", "Homepage", "Request", "About", "Shop", "Shop Builder", "Post Builder", "Manage Blog Posts"]);
assert.equal($("pb-publish").disabled, false);
assert.equal($("items").querySelectorAll(".sb-row").length, items.items.length);
console.log("ok: single sign-in, tabs, both builders connected");

// tab switching and the save bar
const bar = w.document.querySelector(".admin-save");
assert.equal(bar.hidden, false);
click(w.document.querySelector('[data-tab="shop-builder"]'));
assert.equal(w.document.querySelector('[data-panel="shop-builder"]').hidden, false);
assert.equal(w.document.querySelector('[data-panel="global"]').hidden, true);
assert.equal(bar.hidden, true);
click(w.document.querySelector('[data-tab="post-builder"]'));
assert.equal(w.document.querySelector('[data-panel="post-builder"]').hidden, false);
assert.equal(bar.hidden, true);
click(w.document.querySelector('[data-tab="about"]'));
assert.equal(bar.hidden, false);
console.log("ok: tab switching");

// shop builder still publishes through the shared session
click($("add-item"));
input($("f-title"), "Merged Test Item");
$("item-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
assert.equal($("sb-publish").disabled, false);
click($("sb-publish")); await tick(60);
const sp = calls.find((c) => c.path === "/api/shop/publish");
assert.ok(sp && sp.auth === "Bearer S");
assert.equal(sp.body.data.items[0].slug, "merged-test-item");
assert.match($("sb-status").textContent, /Published/);
console.log("ok: shop builder publish");

// post builder still publishes through the shared session
input($("post-title"), "My Post");
input($("post-summary"), "Summary");
$("post-content").innerHTML = "<p>Hello <strong>world</strong></p>";
click($("pb-publish")); await tick(60);
const pp = calls.find((c) => c.path === "/api/publish");
assert.ok(pp && pp.auth === "Bearer S");
assert.equal(pp.body.title, "My Post"); assert.equal(pp.body.category, "stereo");
assert.ok(pp.body.content.includes("<strong>world</strong>"));
assert.match($("pb-status").textContent, /Published my-post\.html/);
// manage posts
click(w.document.querySelector('[data-tab="manage-posts"]')); await tick(60);
assert.ok(calls.some((c) => c.path.startsWith("/api/posts?category=stereo")));
assert.equal($("managed-posts").querySelectorAll(".managed-post").length, 1);
console.log("ok: post builder publish and manage");

// an expired session in a builder signs the whole admin out
failPublishWith = 401;
click($("pb-publish")); await tick(60);
assert.equal($("admin-app").hidden, false === false ? true : false);
assert.equal($("github-connect").hidden, false);
assert.equal($("pb-publish").disabled, true);
console.log("ok: builder 401 signs the admin out");

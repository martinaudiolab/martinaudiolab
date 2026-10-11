import { ROOT as ROOT_WITH_SLASH, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const ROOT = ROOT_WITH_SLASH.replace(/\/$/, "");
const worker = (await import(ROOT_URL + "publisher/worker.js")).default;

// ---- in-memory GitHub -------------------------------------------------------
const sha = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const blobs = new Map();       // sha -> Buffer
let head = { tree: {}, sha: "" }; // path -> blob sha
let commits = {};
function putBlob(buf) { const h = sha(buf); blobs.set(h, buf); return h; }
function seed() {
  head.tree = {};
  head.tree["shop-data/items.json"] = putBlob(fs.readFileSync(FIXTURES + "/items.json"));
  head.tree["site/images/banner.jpg"] = putBlob(Buffer.from("banner"));
  if (fs.existsSync(ROOT + "/site/images/shop")) for (const f of fs.readdirSync(ROOT + "/site/images/shop")) head.tree["site/images/shop/" + f] = putBlob(Buffer.from("img" + f));
  for (const f of fs.readdirSync(ROOT + "/site/shop")) head.tree["site/shop/" + f] = putBlob(fs.readFileSync(ROOT + "/site/shop/" + f));
  head.tree["site/stereo/index.html"] = putBlob(Buffer.from("stereo"));
  head.tree["site-data/site-content.json"] = putBlob(fs.readFileSync(FIXTURES + "/site-content.json"));
  for (const f of ["category-stereo.jpg","category-radio.jpg","category-test-equipment.jpg"]) head.tree["site/images/" + f] = putBlob(Buffer.from(f));
  const id = "c".repeat(40);
  commits[id] = { tree: structuredClone(head.tree) };
  head.sha = id;
}
let treeStore = {}; // tree sha -> path map
function treeSha(map) { const s = sha(JSON.stringify(map)); treeStore[s] = map; return s; }
let log = [];

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const path = u.pathname.replace("/repos/martinaudiolab/martinaudiolab", "");
  const method = init.method || "GET";
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (error) { body = null; }
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
  if (u.hostname === "github.com" && u.pathname === "/login/oauth/access_token") return json({ access_token: "tok", refresh_token: "r", expires_in: 28800 });
  if (u.hostname !== "api.github.com") throw new Error("unexpected host " + u.hostname);
  if (path === "" && method === "GET") return json({ permissions: { admin: true, push: true } });
  if (path.startsWith("/git/ref/heads/")) return json({ object: { sha: head.sha } });
  let m;
  if ((m = path.match(/^\/git\/commits\/([0-9a-f]+)$/)) && method === "GET") {
    return json({ tree: { sha: treeSha(commits[m[1]].tree) } });
  }
  if ((m = path.match(/^\/contents\/(.+)$/))) {
    const p = decodeURIComponent(m[1]);
    const ref = u.searchParams.get("ref");
    const tree = ref === head.sha || commits[ref] ? commits[ref] ? commits[ref].tree : head.tree : head.tree;
    const h = tree[p];
    if (!h) return json({ message: "Not Found" }, 404);
    return json({ sha: h, content: blobs.get(h).toString("base64") });
  }
  if ((m = path.match(/^\/git\/trees\/([0-9a-f]+)$/))) {
    const map = treeStore[m[1]];
    return json({ truncated: false, tree: Object.keys(map).map((p) => ({ path: p, type: "blob", sha: map[p] })) });
  }
  if (path === "/git/blobs" && method === "POST") {
    const buf = Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8");
    return json({ sha: putBlob(buf) }, 201);
  }
  if (path === "/git/trees" && method === "POST") {
    const map = structuredClone(treeStore[body.base_tree]);
    for (const e of body.tree) {
      if (e.sha === null) { assert.ok(map[e.path], "deleting a path that does not exist: " + e.path); delete map[e.path]; }
      else map[e.path] = e.sha;
    }
    return json({ sha: treeSha(map) }, 201);
  }
  if (path === "/git/commits" && method === "POST") {
    const id = sha(JSON.stringify(body) + Math.random());
    commits[id] = { tree: structuredClone(treeStore[body.tree]), message: body.message };
    return json({ sha: id }, 201);
  }
  if (path.startsWith("/git/refs/heads/") && method === "PATCH") {
    assert.equal(body.force, false);
    head = { tree: commits[body.sha].tree, sha: body.sha };
    log.push(commits[body.sha].message);
    return json({}, 200);
  }
  throw new Error("unhandled " + method + " " + url);
};

const ORIGIN = "https://site.example";
const kv = new Map();
const env = {
  GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "y", GITHUB_OWNER: "martinaudiolab", GITHUB_REPOSITORY: "martinaudiolab",
  GITHUB_BRANCH: "main", SITE_ORIGIN: ORIGIN, BUILDER_URL: ORIGIN + "/post-builder", ALLOW_NON_ADMIN_PUBLISHING: "false",
  PUBLISHER_SESSIONS: {
    async get(k, type) { const v = kv.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }
  }
};
kv.set("session:S", JSON.stringify({ accessToken: "t", refreshToken: "", expiresAt: Date.now() + 3600e3, isAdmin: true }));

async function call(path, method = "GET", body) {
  const req = new Request("https://pub.example" + path, {
    method, headers: { Origin: ORIGIN, Authorization: "Bearer S", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json() };
}

// ---- tests ------------------------------------------------------------------
seed();
let r = await call("/api/shop");
assert.equal(r.status, 200);
assert.equal(r.body.data.items.length, 7);
const baseSha = r.body.sha;

// 1. add an item with an uploaded photo, remove a sample item, edit settings
const data = structuredClone(r.body.data);
const removed = data.items.find((i) => i.slug === "sample-sold-item");
data.items = data.items.filter((i) => i.slug !== "sample-sold-item");
data.items.unshift({
  slug: "marantz-2270", title: "Marantz 2270 <Receiver>", summary: "Recapped & tested", category: "Stereo",
  status: "available", price: 650, was: 750, images: ["images/shop/photo-abc-1234.jpg", "images/banner.jpg"],
  details: [["Power", "70 W/ch"]], description: ["First paragraph.", "Second."]
});
data.shop.title = "Shop";
const jpg = Buffer.from("fakejpegdata").toString("base64");
r = await call("/api/shop/publish", "POST", { baseSha, data, images: [{ path: "images/shop/photo-abc-1234.jpg", data: jpg }] });
assert.equal(r.status, 201, JSON.stringify(r.body));
assert.equal(r.body.items, 7);
assert.equal(r.body.removed, 1);
assert.ok(head.tree["site/shop/marantz-2270.html"], "new page written");
assert.ok(!head.tree["site/shop/sample-sold-item.html"], "removed page deleted");
assert.ok(head.tree["site/shop/sample-restored-receiver.html"], "other pages kept");
assert.equal(blobs.get(head.tree["site/images/shop/photo-abc-1234.jpg"]).toString(), "fakejpegdata");
const page = blobs.get(head.tree["site/shop/marantz-2270.html"]).toString();
assert.ok(page.includes("Marantz 2270 &lt;Receiver&gt;"), "title escaped");
assert.ok(page.includes("../images/shop/photo-abc-1234.jpg"));
const saved = JSON.parse(blobs.get(head.tree["shop-data/items.json"]).toString());
assert.equal(saved.items[0].slug, "marantz-2270");
assert.ok(!saved.items.some((i) => i.slug === removed.slug));
assert.ok(blobs.get(head.tree["site/shop/index.html"]).toString().includes("marantz-2270.html"));
assert.equal(head.tree["site/stereo/index.html"] !== undefined, true);
assert.equal(log[0], "Update shop listings");
console.log("ok 1: add/remove/upload publish");

// 2. stale base sha is rejected
r = await call("/api/shop/publish", "POST", { baseSha, data, images: [] });
assert.equal(r.status, 409);
console.log("ok 2: stale version rejected:", r.body.error.slice(0, 50));

// 3. removing an item deletes its uploaded photo, keeps shared/other files
r = await call("/api/shop");
const d2 = structuredClone(r.body.data);
d2.items = d2.items.filter((i) => i.slug !== "marantz-2270");
r = await call("/api/shop/publish", "POST", { baseSha: r.body.sha, data: d2, images: [] });
assert.equal(r.status, 201, JSON.stringify(r.body));
assert.ok(!head.tree["site/images/shop/photo-abc-1234.jpg"], "orphan photo deleted");
assert.ok(head.tree["site/images/banner.jpg"], "banner kept");
assert.ok(!head.tree["site/shop/marantz-2270.html"]);
console.log("ok 3: orphan photo cleaned up");

// 4. validation failures
r = await call("/api/shop"); const cur = r.body;
const bad = (mutate, images = []) => { const d = structuredClone(cur.data); mutate(d); return call("/api/shop/publish", "POST", { baseSha: cur.sha, data: d, images }); };
r = await bad((d) => { d.items[0].slug = "Bad Slug"; }); assert.equal(r.status, 400);
r = await bad((d) => { d.items[1].slug = d.items[0].slug; }); assert.equal(r.status, 400);
r = await bad((d) => { d.items[0].images = ["images/shop/missing.jpg"]; }); assert.equal(r.status, 400);
r = await bad((d) => { d.items[0].images = ["../../etc/passwd"]; }); assert.equal(r.status, 400);
r = await bad((d) => {}, [{ path: "images/shop/unused.jpg", data: jpg }]); assert.equal(r.status, 400);
r = await bad((d) => { d.items[0].images = ["images/shop/../x.jpg"]; }, [{ path: "images/shop/../x.jpg", data: jpg }]); assert.equal(r.status, 400);
r = await bad((d) => { d.items[0].images = ["images/shop/a.svg"]; }, [{ path: "images/shop/a.svg", data: jpg }]); assert.equal(r.status, 400);
r = await bad((d) => { d.items[0].price = -5; }); assert.equal(r.status, 400);
console.log("ok 4: invalid input rejected");

// 5. unauthenticated / wrong origin
const res = await worker.fetch(new Request("https://pub.example/api/shop", { headers: { Origin: ORIGIN } }), env);
assert.equal(res.status, 401);
const res2 = await worker.fetch(new Request("https://pub.example/api/shop", { headers: { Origin: "https://evil.example", Authorization: "Bearer S" } }), env);
assert.equal(res2.status, 403);
console.log("ok 5: auth enforced");

// 6. login return target
const start = await worker.fetch(new Request("https://pub.example/auth/start?return=shop"), env);
assert.equal(start.status, 302);
const cookies = start.headers.getSetCookie();
assert.ok(cookies.some((c) => c.startsWith("oauth_state=")) && !cookies.some((c) => c.startsWith("oauth_return")), cookies.join("|"));
console.log("ok 6: login sets only the state cookie");

// ---- 7. admin content ------------------------------------------------------
seed();
r = await call("/api/content");
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.content.site_name, "Martin Audio Labs");
assert.equal(r.body.content.nav_items.length, 5);
assert.equal(r.body.shop.title, "Shop");
const cur2 = r.body;
const edit = structuredClone(cur2.content);
edit.site_name = "Martin Audio Labs <Test>";
edit.nav_items = [{ label: "Home", href: "index.html" }, { label: "Blog", children: [{ label: "Stereo", href: "stereo/index.html" }] }];
edit.homepage.hero.title = "New hero";
edit.homepage.hero.slides = [{ image: "images/site/hero-abc-1234.jpg", alt: "Bench" }, { image: "images/banner.jpg", alt: "" }, { image: "images/site/not-allowed.svg", alt: "x" }, { image: "javascript:alert(1)", alt: "y" }];
edit.homepage.trust_line = "Tested before shipping";
edit.homepage.product_carousel.enabled = false;
edit.request.form_action = "https://formspree.io/f/abc123";
edit.about.sections[0].heading = "My Philosophy (edited)";
r = await call("/api/content/publish", "POST", {
  contentSha: cur2.contentSha, shopSha: cur2.shopSha, content: edit,
  shop: { title: "The Shop", intro: "New intro" },
  images: [{ path: "images/site/hero-abc-1234.jpg", data: jpg }]
});
assert.equal(r.status, 201, JSON.stringify(r.body));
const savedContent = JSON.parse(blobs.get(head.tree["site-data/site-content.json"]).toString());
assert.equal(savedContent.homepage.hero.title, "New hero");
assert.equal(savedContent.nav_items[1].children[0].label, "Stereo");
const homeHtml = blobs.get(head.tree["site/index.html"]).toString();
assert.equal(savedContent.homepage.hero.slides.length, 2, "invalid slides dropped");
assert.equal((homeHtml.match(/class="hero-slide/g) || []).length, 2);
assert.ok(homeHtml.includes('alt="Bench"') && homeHtml.includes('src="images/site/hero-abc-1234.jpg"'));
assert.ok(homeHtml.indexOf('class="hero"') < homeHtml.indexOf('class="cats"') && homeHtml.includes('<body class="home">'));
assert.ok(homeHtml.includes("<h1>New hero</h1>") && !homeHtml.includes('data-theme') && homeHtml.includes("Tested before shipping"));
assert.ok(!homeHtml.includes("forsale.js"), "carousel disabled");
assert.ok(homeHtml.includes("Martin Audio Labs &lt;Test&gt;"), "site name escaped");
assert.ok(blobs.get(head.tree["site/request.html"]).toString().includes('action="https://formspree.io/f/abc123"'));
assert.ok(blobs.get(head.tree["site/about.html"]).toString().includes("My Philosophy (edited)"));
const shopIdx = blobs.get(head.tree["site/shop/index.html"]).toString();
assert.ok(shopIdx.includes("The Shop") && shopIdx.includes("New intro") && shopIdx.includes("Blog"));
const items2 = JSON.parse(blobs.get(head.tree["shop-data/items.json"]).toString());
assert.equal(items2.shop.title, "The Shop");
assert.equal(items2.shop.email, "thealexandersound@gmail.com", "other shop settings preserved");
assert.ok(items2.items.length > 0, "listings preserved");
assert.equal(blobs.get(head.tree["site/images/site/hero-abc-1234.jpg"]).toString(), "fakejpegdata");
console.log("ok 7: admin save regenerates pages, content, shop text, image");

// 8. stale versions / validation
r = await call("/api/content/publish", "POST", { contentSha: cur2.contentSha, shopSha: cur2.shopSha, content: edit, shop: { title: "x", intro: "" }, images: [] });
assert.equal(r.status, 409);
r = await call("/api/content"); const cur3 = r.body;
const send = (mut, images = []) => { const c = structuredClone(cur3.content); mut(c); return call("/api/content/publish", "POST", { contentSha: cur3.contentSha, shopSha: cur3.shopSha, content: c, shop: cur3.shop, images }); };
r = await send((c) => { c.homepage.hero.slides = [{ image: "images/site/missing.jpg", alt: "" }]; }); assert.equal(r.status, 400);
r = await send((c) => {}, [{ path: "images/site/unused.jpg", data: jpg }]); assert.equal(r.status, 400);
r = await send((c) => {}, [{ path: "images/site/../x.jpg", data: jpg }]); assert.equal(r.status, 400);
// unsafe values are neutralised by normalisation rather than stored
r = await send((c) => { c.nav_items = [{ label: "Evil", href: "javascript:alert(1)" }, { label: "Ok", href: "about.html" }]; c.contact_email = "not an email"; c.homepage.hero.slides = [{ image: "https://evil.example/x.svg", alt: "" }]; c.request.form_action = "http://evil.example/post"; });
assert.equal(r.status, 201, JSON.stringify(r.body));
assert.deepEqual(r.body.content.nav_items.map((n) => n.label), ["Ok"]);
assert.equal(r.body.content.contact_email, "thealexandersound@gmail.com");
assert.deepEqual(r.body.content.homepage.hero.slides, [{ image: "images/banner.jpg", alt: "" }]);
assert.equal(r.body.content.request.form_action, "https://formspree.io/f/YOUR_FORM_ID");
console.log("ok 8: conflicts and validation");

// 9. admin login return
const st = await worker.fetch(new Request("https://pub.example/auth/start?return=admin"), env);
assert.ok(st.headers.getSetCookie().every((c) => !c.startsWith("oauth_return")));
console.log("ok 9: legacy return parameter is ignored");

// 10. published article template uses current site name, nav, theme
const src = fs.readFileSync(ROOT + "/publisher/worker.js", "utf8").split(String.fromCharCode(13)).join("");
const a = src.indexOf("function articleHtml("); const b = src.indexOf("\n}\n", a) + 2;
const { navHtml, NAV_SCRIPT } = await import(ROOT_URL + "scripts/site-nav.mjs");
const { crumbsHtml, heroFigure } = await import(ROOT_URL + "scripts/site-posts.mjs");
const mk = new Function("escapeHtml", "dateLabel", "navHtml", "NAV_SCRIPT", "heroFigure", "crumbsHtml", src.slice(a, b) + "\nreturn articleHtml;");
const articleHtml = mk((v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;"), () => "October 9, 2026", navHtml, NAV_SCRIPT, heroFigure, crumbsHtml);
const site = { site_name: "My Shop", nav_items: [{ label: "Home", href: "index.html" }, { label: "Blog", children: [{ label: "Stereo", href: "stereo/index.html" }] }] };
const art = articleHtml({ title: "T", summary: "S", date: "2026-10-09", category: "stereo" }, { folder: "stereo", name: "Stereo Repair" }, "<p>x</p>", site);
assert.ok(art.includes('<html lang="en">') && art.includes("<title>T - My Shop</title>") && art.includes('class="brand" href="../index.html">My Shop</a>'));
assert.ok(art.includes('<a href="../stereo/index.html" class="on" aria-current="page">Stereo</a>') && art.includes('<script src="../nav.js" defer>'));
assert.ok(art.includes('<!--crumbs-->') && art.includes('<a href="../blog/index.html">Restoration Blog</a>') && art.includes('<span aria-current="page">T</span>'), "new posts carry the breadcrumb");
console.log("ok 10: article template uses site content");

// ---- 11. complete sign-in flow always lands on /admin -------------------------------
{
  const start = await worker.fetch(new Request("https://pub.example/auth/start?return=shop"), env);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cookie = start.headers.getSetCookie()[0].split(";")[0];
  const ok = await worker.fetch(new Request("https://pub.example/auth/callback?state=" + state + "&code=abc", { headers: { Cookie: cookie } }), env);
  assert.equal(ok.status, 302);
  const dest = new URL(ok.headers.get("location"));
  assert.equal(dest.origin + dest.pathname, ORIGIN + "/admin");
  assert.ok(dest.hash.startsWith("#ticket="), dest.toString());
  assert.ok(ok.headers.getSetCookie().some((c) => c.startsWith("oauth_state=;")), "state cookie cleared");
  const ticket = decodeURIComponent(dest.hash.slice("#ticket=".length));
  const handoff = await worker.fetch(new Request("https://pub.example/api/session", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) }), env);
  assert.equal(handoff.status, 200);
  assert.ok((await handoff.json()).session);
  // a failed sign-in is reported on the admin page, not on a retired address
  const bad = await worker.fetch(new Request("https://pub.example/auth/callback?state=nope&code=abc", { headers: { Cookie: "oauth_state=other" } }), env);
  assert.equal(bad.status, 302);
  const badDest = new URL(bad.headers.get("location"));
  assert.equal(badDest.origin + badDest.pathname, ORIGIN + "/admin");
  assert.ok(badDest.hash.includes("auth_error=oauth_failed"));
  const denied = await worker.fetch(new Request("https://pub.example/auth/callback?error=access_denied"), env);
  assert.equal(new URL(denied.headers.get("location")).pathname, "/admin");
  console.log("ok 11: sign-in success and failure land on /admin");
}

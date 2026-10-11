import { ROOT as ROOT_WITH_SLASH, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import "./_rewriter-shim.mjs";

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
const INDEX = '<!DOCTYPE html><html lang="en"><head><title>Stereo Repair</title></head><body class="navbar"><header class="site"></header><main><h1 class="h2">Stereo Repair</h1><p class="intro">Intro</p>' +
  '<article class="post has-thumb"><a class="post-thumb" href="old-post.html"><img src="/images/category-stereo.jpg" alt=""></a><div class="post-main"><h2><a href="old-post.html">Old post</a></h2></div></article></main></body></html>';
seed();
head.tree["site/stereo/index.html"] = putBlob(Buffer.from(INDEX));
head.tree["site/stereo/old-post.html"] = putBlob(Buffer.from("old"));
commits[head.sha] = { tree: structuredClone(head.tree) };

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("thumbnail-bytes")]).toString("base64");
assert.ok(JPEG.startsWith("/9j/"));
const post = (extra) => ({ category: "stereo", title: "Marantz 2270 Recap", summary: "All caps replaced", date: "2026-10-09", content: "<p>Body</p>", ...extra });

// 1. publish with a thumbnail: file committed, listing points at it
let r = await call("/api/publish", "POST", post({ thumbnail: JPEG }));
assert.equal(r.status, 201, JSON.stringify(r.body));
const thumbPath = "site/images/posts/stereo-marantz-2270-recap.jpg";
assert.ok(head.tree[thumbPath], "thumbnail committed");
assert.equal(blobs.get(head.tree[thumbPath]).toString("base64"), JPEG);
let index = blobs.get(head.tree["site/stereo/index.html"]).toString();
assert.ok(index.includes('src="/images/posts/stereo-marantz-2270-recap.jpg"'), "listing uses the post thumbnail");
assert.ok(index.indexOf("marantz-2270-recap.html") < index.indexOf("old-post.html"), "newest first");
assert.ok(index.includes('<article class="post post-card"><header class="card-head"><h2><a href="marantz-2270-recap.html">'), "new listings are cards");
{
  const card = index.slice(index.indexOf('<article class="post post-card"><header class="card-head"><h2><a href="marantz-2270-recap.html">'));
  const one = card.slice(0, card.indexOf("</article>"));
  assert.ok(one.includes('<p class="card-sub">All caps replaced</p>'), "summary is the subtitle");
  assert.ok(one.includes('<p class="card-sub">All caps replaced</p><time class="card-date">October 9th, 2026</time></header><hr class="card-rule">'), "date sits under the subtitle, then the full-width rule");
  assert.ok(!/By:|author|Comments/i.test(one), "no author line or comments button");
  assert.ok(one.includes('<p class="card-excerpt">Body <a class="more" href="marantz-2270-recap.html">Read More</a></p>'), "excerpt from the post text: " + one);
  assert.ok(one.includes('<footer class="card-foot"><a class="card-tag" href="/stereo/">Stereo</a></footer>'), "tag shows the category label");
}
assert.ok(head.tree["site/stereo/marantz-2270-recap.html"]);

// 2. publish without a thumbnail: falls back to the section picture, no file
r = await call("/api/publish", "POST", post({ title: "Plain Post" }));
assert.equal(r.status, 201);
assert.ok(!head.tree["site/images/posts/stereo-plain-post.jpg"]);
index = blobs.get(head.tree["site/stereo/index.html"]).toString();
const plain = index.slice(index.indexOf('href="plain-post.html"'), index.indexOf('href="plain-post.html"') + 200);
assert.ok(index.match(/<a class="post-thumb" href="plain-post.html"[^>]*><img src="\/images\/category-stereo\.jpg"/), plain);

// 3. bad thumbnails are rejected
for (const bad of ["not base64!!", Buffer.from("GIF89a....").toString("base64"), "/9j/" + "A".repeat(1300000)]) {
  r = await call("/api/publish", "POST", post({ title: "Bad " + bad.length, thumbnail: bad }));
  assert.equal(r.status, 400, "rejected: " + bad.slice(0, 12));
}

// 4. deleting a post removes its own thumbnail too, and tolerates posts without one
const list = await call("/api/posts?category=stereo");
assert.equal(list.status, 200);
const del = async (slug) => {
  const cur = await call("/api/posts?category=stereo");
  const html = cur.body.indexHtml.replace(new RegExp('<article class="post[^"]*">(?:(?!</article>)[\\s\\S])*href="' + slug + '\\.html"[\\s\\S]*?</article>'), "");
  return call("/api/delete", "POST", { category: "stereo", slug, indexSha: cur.body.indexSha, indexHtml: html });
};
r = await del("marantz-2270-recap");
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.ok(!head.tree[thumbPath], "thumbnail removed with the post");
assert.ok(!head.tree["site/stereo/marantz-2270-recap.html"]);
r = await del("plain-post");
assert.equal(r.status, 200, JSON.stringify(r.body));
console.log("ok: post thumbnails (publish, fallback, validation, delete)");

// 5. the post page itself carries the picture under the title (own thumbnail, else the section picture)
{
  seed();
  head.tree["site/stereo/index.html"] = putBlob(Buffer.from(INDEX));
  commits[head.sha] = { tree: structuredClone(head.tree) };
  let res = await call("/api/publish", "POST", post({ title: "Hero With Photo", thumbnail: JPEG }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let page = blobs.get(head.tree["site/stereo/hero-with-photo.html"]).toString();
  assert.match(page, /<div class="meta">[^]*?<\/div><figure class="post-hero"><img src="\/images\/posts\/stereo-hero-with-photo\.jpg" alt="Hero With Photo"><\/figure><div class="body">/);
  res = await call("/api/publish", "POST", post({ title: "Hero Plain" }));
  assert.equal(res.status, 201);
  page = blobs.get(head.tree["site/stereo/hero-plain.html"]).toString();
  assert.ok(page.includes('<figure class="post-hero"><img src="/images/category-stereo.jpg" alt="Hero Plain">'));
  assert.ok(page.indexOf('<h1 class="post-title">') < page.indexOf("post-hero") && page.indexOf("post-hero") < page.indexOf('<div class="body">'));
  assert.ok(page.includes('<script src="/assets/js/lightbox.js"'), "lightbox is loaded so the picture can be enlarged");
  console.log("ok: post pages show the thumbnail under the title");
}

// 6. a photo gallery survives the Worker's own sanitiser (layout kept, anything else on the figure dropped)
{
  seed();
  head.tree["site/stereo/index.html"] = putBlob(Buffer.from(INDEX));
  commits[head.sha] = { tree: structuredClone(head.tree) };
  const gallery = '<p>Condition overview</p><figure data-gallery="2" onclick="x()" class="big"><img src="data:image/jpeg;base64,AAAA" alt="front" data-w="50"><img src="data:image/jpeg;base64,BBBB" alt=""></figure>' +
    '<figure data-gallery="7"><img src="data:image/jpeg;base64,CCCC" alt=""></figure>';
  const res = await call("/api/publish", "POST", post({ title: "Gallery Post", content: gallery }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const page = blobs.get(head.tree["site/stereo/gallery-post.html"]).toString();
  assert.ok(page.includes('<figure data-gallery="2"><img src="data:image/jpeg;base64,AAAA" alt="front" data-w="50"><img src="data:image/jpeg;base64,BBBB" alt=""></figure>'), page.slice(page.indexOf("<figure data-gallery")));
  assert.ok(!page.includes('data-gallery="7"') && !/onclick|class="big"/.test(page));
  console.log("ok: gallery survives publishing");
}

// 7. a gallery's width and alignment survive the Worker's sanitiser; unknown values do not
{
  seed();
  head.tree["site/stereo/index.html"] = putBlob(Buffer.from(INDEX));
  commits[head.sha] = { tree: structuredClone(head.tree) };
  const content = '<figure data-gallery="2" data-w="50" data-a="r"><img src="data:image/jpeg;base64,AAAA" alt=""></figure>' +
    '<figure data-gallery="4" data-w="33" data-a="x"><img src="data:image/jpeg;base64,BBBB" alt=""></figure>';
  const res = await call("/api/publish", "POST", post({ title: "Sized Gallery", content }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const page = blobs.get(head.tree["site/stereo/sized-gallery.html"]).toString();
  assert.ok(page.includes('<figure data-gallery="2" data-w="50" data-a="r">'), page.slice(page.indexOf("<figure")));
  assert.ok(page.includes('<figure data-gallery="4"><img') && !/data-w="33"|data-a="x"/.test(page));
  console.log("ok: gallery width and alignment survive publishing");
}

// 8. section pages whose title lives on the banner: listings go first in <main>, publishing and deleting still work
{
  const NEW_INDEX = '<!DOCTYPE html><html lang="en"><head><title>Stereo Repair</title></head><body class="home"><header class="site"></header>' +
    '<!--hero--><section class="hero hero-short" id="hero"><div class="hero-scrim"></div><div class="hero-text"><h1>Stereo Repair</h1></div></section><!--/hero-->' +
    '<main><article class="post has-thumb"><a class="post-thumb" href="old-post.html"><img src="/images/category-stereo.jpg" alt=""></a><div class="post-main"><h2><a href="old-post.html">Old post</a></h2></div></article></main></body></html>';
  seed();
  head.tree["site/stereo/index.html"] = putBlob(Buffer.from(NEW_INDEX));
  head.tree["site/stereo/old-post.html"] = putBlob(Buffer.from("old"));
  commits[head.sha] = { tree: structuredClone(head.tree) };

  let res = await call("/api/publish", "POST", post({ title: "Banner Layout Post" }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let index = blobs.get(head.tree["site/stereo/index.html"]).toString();
  assert.ok(index.indexOf("<main><article class=\"post post-card\">") > -1, "the new listing is first in <main>");
  assert.ok(index.indexOf("banner-layout-post.html") < index.indexOf("old-post.html"), "newest first");
  assert.equal((index.match(/<h1/g) || []).length, 1, "still just the banner title");

  // delete it again with the client's flow
  const list = await call("/api/posts?category=stereo");
  assert.equal(list.status, 200);
  const stripped = list.body.indexHtml.replace(/<article class="post[^"]*">(?:(?!<\/article>)[\s\S])*?banner-layout-post\.html[\s\S]*?<\/article>/, "");
  res = await call("/api/delete", "POST", { category: "stereo", slug: "banner-layout-post", indexSha: list.body.indexSha, indexHtml: stripped });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!head.tree["site/stereo/banner-layout-post.html"]);

  // a page whose title is not the expected section is refused
  head.tree["site/stereo/index.html"] = putBlob(Buffer.from(NEW_INDEX.replace("<h1>Stereo Repair</h1>", "<h1>Something Else</h1>")));
  commits[head.sha] = { tree: structuredClone(head.tree) };
  res = await call("/api/publish", "POST", post({ title: "Wrong Page" }));
  assert.equal(res.status, 409, "mismatched section page is rejected");
  console.log("ok: section pages with the title on the banner");
}

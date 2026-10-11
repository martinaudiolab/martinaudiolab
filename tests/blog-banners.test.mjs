// Blog pages share the Home/Shop look: floating toolbar over a banner, with a separate banner slideshow
// for the Restoration Blog page and for each section.
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ROOT, FIXTURES } from "./_root.mjs";
import { SECTIONS } from "../shared/sections.mjs";
import { contentImages, normalizeContent } from "../shared/site-content.mjs";
import { applyBlogHero, applyPostBar, blogHeroHtml, renderBlogHub } from "../shared/site-blog.mjs";

const read = (p) => fs.readFileSync(ROOT + p, "utf8");
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// 1. content: one slideshow per blog page, each independent, with sensible defaults
{
  const c = normalizeContent({});
  assert.deepEqual(Object.keys(c.blog_hero), ["all"].concat(SECTIONS.map((s) => s.key)));
  assert.equal(c.blog_hero.all.slides[0].image, "images/banner.jpg", "the blog page defaults to the site banner");
  for (const s of SECTIONS) assert.equal(c.blog_hero[s.key].slides[0].image, s.image, s.key + " defaults to its section picture");

  const custom = normalizeContent({ blog_hero: {
    all: { slides: [{ image: "images/site/bloghero-a-1111.jpg", alt: "Bench" }] },
    stereo: { slides: [{ image: "images/site/bloghero-b-2222.jpg" }, { image: "javascript:x" }, { image: "images/site/bloghero-c-3333.jpg" }, { image: "images/site/d.jpg" }, { image: "images/site/e.jpg" }, { image: "images/site/f.jpg" }] },
    radio: "nonsense"
  } });
  assert.deepEqual(custom.blog_hero.all.slides, [{ image: "images/site/bloghero-a-1111.jpg", alt: "Bench" }]);
  assert.deepEqual(custom.blog_hero.stereo.slides.map((s) => s.image), ["images/site/bloghero-b-2222.jpg", "images/site/bloghero-c-3333.jpg", "images/site/d.jpg"], "only the first four entries are read; invalid ones are dropped");
  assert.equal(custom.blog_hero.radio.slides[0].image, SECTIONS[1].image, "invalid input falls back");
  assert.equal(custom.blog_hero["test-equipment"].slides[0].image, SECTIONS[2].image);
  assert.ok(contentImages(custom).includes("images/site/bloghero-b-2222.jpg"), "banner pictures are tracked for upload and clean-up");
  console.log("ok 1: independent banner slideshows per blog page");
}

// 2. section pages: toolbar mode + own banner, idempotent, other content untouched
{
  const content = normalizeContent({ blog_hero: { radio: { slides: [{ image: "images/site/bloghero-r-1111.jpg", alt: "Radios" }] } } });
  const page = '<!DOCTYPE html><html lang="en"><head></head><body class="navbar"><header class="site"><a class="brand" href="/">X</a><nav></nav></header>' +
    '<main><h1 class="h2">Radio Repair</h1><p class="intro">i</p></main><script src="/assets/js/nav.js" defer=""></script></body></html>';
  const once = applyBlogHero(page, content, "radio", "Radio Repair");
  assert.ok(once.includes('<body class="home">') && !once.includes('class="navbar"'));
  assert.ok(once.includes('src="/images/site/bloghero-r-1111.jpg" alt="Radios"'));
  assert.ok(once.indexOf("<!--hero-->") > once.indexOf("</header>") && once.indexOf("<!--/hero-->") < once.indexOf("<main>"), "banner sits between the toolbar and the page");
  const banner = once.slice(once.indexOf("<!--hero-->"), once.indexOf("<!--/hero-->"));
  assert.ok(banner.includes('<div class="hero-text"><h1>Radio Repair</h1></div>'), "the title is on the banner");
  assert.equal((once.match(/<h1/g) || []).length, 1, "one heading on the page");
  assert.ok(once.includes("<main></main>") && !once.includes('class="intro"'), "the heading and intro paragraph below the banner are removed");
  assert.ok(once.indexOf("assets/js/hero.js") > -1 && once.indexOf("assets/js/hero.js") < once.indexOf("nav.js"), "slideshow script added before nav.js");
  assert.equal(applyBlogHero(once, content, "radio", "Radio Repair"), once, "idempotent");
  // changing the banner replaces it rather than adding another
  const changed = normalizeContent({ blog_hero: { radio: { slides: [{ image: "images/site/bloghero-r-9999.jpg" }] } } });
  const swapped = applyBlogHero(once, changed, "radio", "Radio Repair");
  assert.equal((swapped.match(/<!--hero-->/g) || []).length, 1);
  assert.ok(swapped.includes("bloghero-r-9999") && !swapped.includes("bloghero-r-1111"));
  // sections are independent
  assert.notEqual(blogHeroHtml(content, "radio", "Radio Repair"), blogHeroHtml(content, "stereo", "Stereo Repair"));
  // posts get the continuous bar, no banner
  assert.ok(applyPostBar("<html><body><header></header></body></html>").includes('<body class="navbar">'));
  assert.equal(applyPostBar(applyPostBar("<body>")), '<body class="navbar">');
  console.log("ok 2: section pages get the shared toolbar and their own banner");
}

// 3. the landing page uses the "all posts" banner
{
  const content = normalizeContent({ blog_hero: { all: { slides: [{ image: "images/site/bloghero-all-1111.jpg" }] } } });
  const html = renderBlogHub(content, {});
  assert.ok(html.includes('<body class="home">') && html.includes("bloghero-all-1111.jpg") && html.includes("/assets/js/hero.js"));
  assert.equal((html.match(/<h1/g) || []).length, 1, "one heading on the page");
  console.log("ok 3: Restoration Blog page uses its own banner");
}

// 4. the admin has a Blog tab with an editor per page (built from the sections list), and saves them
{
  const admin = read("site/admin/index.html");
  const holders = Array.from(admin.matchAll(/data-blog-hero="([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(holders, ["all"].concat(SECTIONS.map((s) => s.key)), "one editor per blog page, in the same order as the sections list");
  assert.ok(/data-tab="blog">Blog</.test(admin) && /data-panel="blog"/.test(admin));

  let html = admin;
  const scripts = ["admin.js", "shop-builder.js", "post-builder.js"];
  for (const s of scripts) html = html.replace('<script src="/admin/' + s + '"></script>', "");
  html = html.replace(/<script src="\/admin\/heic.js"><\/script>\s*/, "");
  const seed = JSON.parse(fs.readFileSync(FIXTURES + "/site-content.json", "utf8"));
  const dom = new JSDOM(html, { url: "https://site.example/admin/#ticket=T", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const saved = [];
  w.confirm = () => true;
  w.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const ok = (v) => ({ ok: true, status: 200, json: async () => v });
    if (p === "/api/session") return ok({ session: "S" });
    if (p === "/api/me") return ok({ role: "administrator" });
    if (p === "/api/content") return ok({ content: structuredClone(seed), contentSha: "a".repeat(40), shop: { title: "Shop", intro: "" }, shopSha: "b".repeat(40) });
    if (p === "/api/content/publish") { saved.push(body); return ok({ contentSha: "c".repeat(40), shopSha: "d".repeat(40), content: body.content, shop: body.shop }); }
    return ok({});
  };
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,QUJDRA==";
  w.Image = function () {
    const o = { naturalWidth: 3000, naturalHeight: 2000 };
    let src = "";
    Object.defineProperty(o, "src", { get: () => src, set: (v) => { src = v; setTimeout(() => o.onload && o.onload(), 0); } });
    return o;
  };
  w.eval(read("site/admin/admin.js"));
  await tick(80);
  const $ = (id) => w.document.getElementById(id);
  const editors = Array.from(w.document.querySelectorAll("[data-blog-hero]"));
  assert.equal(editors.length, 1 + SECTIONS.length);
  assert.ok(editors.every((e) => e.querySelectorAll(".ae-row").length === 4), "four slots on every page");

  // add a picture to the Radio banner only
  const radio = w.document.querySelector('[data-blog-hero="radio"]');
  const slot = radio.querySelectorAll(".ae-row")[1];
  const input = slot.querySelector("input[type=file]");
  Object.defineProperty(input, "files", { value: [{ name: "radios.jpg" }], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await tick(80);
  $("save").click();
  await tick(120);
  assert.equal(saved.length, 1, "saved");
  const body = saved[0];
  assert.equal(body.content.blog_hero.radio.slides.length, 2, "radio banner has its new picture");
  assert.match(body.content.blog_hero.radio.slides[1].image, /^images\/site\/bloghero-[a-z0-9]+-[a-z0-9]{4}\.jpg$/);
  assert.equal(body.content.blog_hero.stereo.slides.length, 1, "the other pages are untouched");
  assert.equal(body.images.length, 1);
  assert.equal(body.images[0].path, body.content.blog_hero.radio.slides[1].image);
  console.log("ok 4: admin Blog tab edits each page's banner independently");
}

// 5. posts: the bar on the Worker's template and in the built output
{
  const posts = read("publisher/src/posts.js");
  assert.ok(posts.includes('</head><body class="navbar"><header class="site">'), "new posts get the bar");
  console.log("ok 5: new posts use the continuous bar");
}

// Blog sections: the sections list, the Restoration Blog landing page, breadcrumbs and older/newer links.
import fs from "node:fs";
import assert from "node:assert/strict";
import { ROOT } from "./_root.mjs";
import { BLOG_HUB, SECTIONS, sectionByFolder, sectionByKey } from "../scripts/sections.mjs";
import { DEFAULT_NAV, normalizeContent } from "../scripts/site-content.mjs";
import { applyPostChrome, crumbsHtml, fallbackThumb, listingsOf, pagerHtml } from "../scripts/site-posts.mjs";
import { renderBlogHub } from "../scripts/site-blog.mjs";

const read = (p) => fs.readFileSync(ROOT + p, "utf8");
const content = normalizeContent({});

// 1. the sections list drives the defaults
{
  assert.deepEqual(SECTIONS.map((s) => s.key), ["stereo", "radio", "test-equipment"]);
  assert.equal(sectionByKey("radio").name, "Radio Repair");
  assert.equal(sectionByFolder("test-equipment").key, "test-equipment");
  assert.equal(sectionByKey("nope"), null);
  const blog = DEFAULT_NAV.find((i) => i.label === BLOG_HUB.name);
  assert.deepEqual(blog.children.map((c) => c.href), [BLOG_HUB.href].concat(SECTIONS.map((s) => s.folder + "/index.html")));
  assert.deepEqual(content.homepage.categories.map((c) => [c.label, c.href, c.image]), SECTIONS.map((s) => [s.name, s.folder + "/index.html", s.image]));
  assert.equal(fallbackThumb("radio"), "../images/category-radio.jpg");
  console.log("ok 1: sections list drives navigation and homepage defaults");
}

// 2. the Worker, build and admin all use the same list
{
  const worker = read("publisher/worker.js");
  assert.ok(worker.includes('from "../scripts/sections.mjs"') && /CATEGORIES = Object\.fromEntries\(SECTIONS\.map/.test(worker), "Worker reads the list");
  const build = read("scripts/build-site.mjs");
  assert.ok(/for \(const section of SECTIONS\)/.test(build) && !/\["stereo", "radio", "test-equipment"\]/.test(build), "build reads the list");
  const admin = read("site/admin.html");
  for (const id of ["category", "manage-category"]) {
    const select = admin.match(new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>'))[1];
    const values = Array.from(select.matchAll(/<option value="([^"]+)">([^<]+)</g)).map((m) => [m[1], m[2]]);
    assert.deepEqual(values, SECTIONS.map((s) => [s.key, s.name]), id + " dropdown matches the list");
  }
  console.log("ok 2: Worker, build and admin dropdowns follow the list");
}

// 3. breadcrumb and older/newer links on a post page, idempotent
{
  const listings = [
    { slug: "c-new", titleHtml: "Newest &amp; best", title: "Newest & best" },
    { slug: "b-mid", titleHtml: "Middle", title: "Middle" },
    { slug: "a-old", titleHtml: "Oldest", title: "Oldest" }
  ];
  const post = '<!DOCTYPE html><html><body><main><a class="back" href="index.html">Back to Stereo Repair</a><article class="post"><h1 class="post-title">Middle</h1><div class="body"><p>x</p></div></article></main></body></html>';
  const once = applyPostChrome(post, "stereo", "b-mid", listings);
  assert.ok(once.includes("<!--crumbs-->") && !once.includes('class="back"'), "back link replaced by the breadcrumb");
  assert.ok(once.includes('<a href="../blog/index.html">Restoration Blog</a>') && once.includes('<a href="index.html">Stereo Repair</a>'));
  assert.ok(once.includes('<span aria-current="page">Middle</span>'));
  assert.ok(once.includes('class="older" href="a-old.html"') && once.includes('class="newer" href="c-new.html"'));
  assert.ok(once.includes("Newest &amp; best") || once.includes("<span>Newest"), "titles keep their escaping");
  assert.equal(applyPostChrome(once, "stereo", "b-mid", listings), once, "idempotent");

  // the newest post has no "newer", the oldest has no "older"; a lone post has neither
  const newest = applyPostChrome(post.replace("Middle", "Newest"), "stereo", "c-new", listings);
  assert.ok(newest.includes('class="older" href="b-mid.html"') && newest.includes('class="newer none"'));
  const lone = applyPostChrome(post, "stereo", "b-mid", [listings[1]]);
  assert.ok(lone.includes("<!--pager--><!--/pager-->") && !lone.includes("post-pager"));
  // a pager is refreshed when a newer post appears
  const refreshed = applyPostChrome(newest, "stereo", "c-new", [{ slug: "d-newer", titleHtml: "Brand new" }].concat(listings));
  assert.ok(refreshed.includes('class="newer" href="d-newer.html"') && (refreshed.match(/<!--pager-->/g) || []).length === 1);
  assert.equal(pagerHtml(null, null), "<!--pager--><!--/pager-->");
  assert.ok(crumbsHtml("A & B", "T").includes("A &amp; B"));
  console.log("ok 3: breadcrumb and pager");
}

// 4. listings are read back from a section page
{
  const html = '<main><h1>S</h1><p class="intro">i</p>' +
    '<article class="post has-thumb"><a class="post-thumb" href="two.html"><img src="../images/posts/stereo-two.jpg" alt=""></a><div class="post-main"><h2><a href="two.html">Two &amp; more</a></h2><div class="meta">October 11, 2026 &nbsp;|&nbsp; <a href="index.html">S</a></div><div class="body"><p>About two</p></div></div></article>' +
    '<article class="post"><h2><a href="one.html">One</a></h2><div class="meta">October 9, 2026 &nbsp;|&nbsp; <a href="index.html">S</a></div><div class="body"><p>About one</p></div></article></main>';
  const list = listingsOf(html);
  assert.deepEqual(list.map((p) => p.slug), ["two", "one"]);
  assert.equal(list[0].title, "Two & more");
  assert.equal(list[0].date, "October 11, 2026");
  assert.equal(list[0].summary, "About two");
  assert.equal(list[0].thumb, "../images/posts/stereo-two.jpg");
  assert.equal(list[1].thumb, "");
  console.log("ok 4: listings parsed");
}

// 5. the landing page: newest first across sections, links into the right folders
{
  const card = (slug, title, date, thumb) =>
    '<article class="post has-thumb"><a class="post-thumb" href="' + slug + '.html"><img src="' + thumb + '" alt=""></a><div class="post-main"><h2><a href="' + slug + '.html">' + title + "</a></h2>" +
    '<div class="meta">' + date + ' &nbsp;|&nbsp; <a href="index.html">x</a></div><div class="body"><p>' + title + " summary</p></div></div></article>";
  const wrap = (cards) => '<main><h1>S</h1><p class="intro">i</p>' + cards + "</main>";
  const html = renderBlogHub(content, {
    stereo: wrap(card("s-old", "Old stereo", "October 1, 2026", "../images/category-stereo.jpg")),
    radio: wrap(card("r-new", "New radio", "October 20, 2026", "../images/posts/radio-r-new.jpg") + card("r-mid", "Mid radio", "October 10, 2026", "../images/category-radio.jpg")),
    "test-equipment": ""
  });
  const order = Array.from(html.matchAll(/<h2><a href="([^"]+)">/g)).map((m) => m[1]);
  assert.deepEqual(order, ["../radio/r-new.html", "../radio/r-mid.html", "../stereo/s-old.html"], "newest first across sections");
  assert.ok(html.includes('<body class="navbar">') && html.includes('href="../style.css"') && html.includes("<h1 class=\"h2\""));
  assert.ok(html.includes('src="../images/posts/radio-r-new.jpg"'), "uses the post's own thumbnail");
  for (const s of SECTIONS) assert.ok(html.includes('<a href="../' + s.folder + '/index.html">' + s.name + "</a>"), "links to " + s.name);
  assert.ok(html.includes('aria-current="page">All Posts</a>'), "All Posts is the active nav entry");
  assert.ok(renderBlogHub(content, {}).includes("No posts yet"));
  console.log("ok 5: blog landing page");
}

// 6. the real site: every post page has the chrome, and the landing page exists
{
  const hub = read("site/blog/index.html");
  assert.ok(hub.includes("Restoration Blog"));
  for (const s of SECTIONS) {
    for (const name of fs.readdirSync(ROOT + "site/" + s.folder)) {
      if (name === "index.html" || !name.endsWith(".html")) continue;
      const page = read("site/" + s.folder + "/" + name);
      assert.ok(page.includes("<!--crumbs-->") && page.includes("<!--pager-->"), s.folder + "/" + name + " has breadcrumb and pager");
      assert.equal((page.match(/<!--crumbs-->/g) || []).length, 1);
    }
  }
  console.log("ok 6: published pages carry the chrome");
}

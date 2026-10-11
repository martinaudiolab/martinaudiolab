// Blog sections: the sections list, the Restoration Blog landing page, breadcrumbs and older/newer links.
import fs from "node:fs";
import assert from "node:assert/strict";
import { ROOT } from "./_root.mjs";
import { BLOG_HUB, SECTIONS, sectionByFolder, sectionByKey } from "../shared/sections.mjs";
import { DEFAULT_NAV, normalizeContent } from "../shared/site-content.mjs";
import { applyPostChrome, crumbsHtml, fallbackThumb, listingsOf, pagerHtml } from "../shared/site-posts.mjs";
import { renderBlogHub } from "../shared/site-blog.mjs";

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
  assert.equal(fallbackThumb("radio"), "/images/category-radio.jpg");
  console.log("ok 1: sections list drives navigation and homepage defaults");
}

// 2. the Worker, build and admin all use the same list
{
  const worker = read("publisher/src/posts.js");
  assert.ok(worker.includes('from "../../shared/sections.mjs"') && /CATEGORIES = Object\.fromEntries\(SECTIONS\.map/.test(worker), "Worker reads the list");
  const build = read("build/build-site.mjs");
  assert.ok(/for \(const section of SECTIONS\)/.test(build) && !/\["stereo", "radio", "test-equipment"\]/.test(build), "build reads the list");
  const admin = read("site/admin/index.html");
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
  assert.ok(once.includes('<a href="/blog/">Restoration Blog</a>') && once.includes('<a href="/stereo/">Stereo Repair</a>'));
  assert.ok(once.includes('<span aria-current="page">Middle</span>'));
  assert.ok(once.includes('class="older" href="/stereo/a-old"') && once.includes('class="newer" href="/stereo/c-new"'));
  assert.ok(once.includes("Newest &amp; best") || once.includes("<span>Newest"), "titles keep their escaping");
  assert.equal(applyPostChrome(once, "stereo", "b-mid", listings), once, "idempotent");

  // the newest post has no "newer", the oldest has no "older"; a lone post has neither
  const newest = applyPostChrome(post.replace("Middle", "Newest"), "stereo", "c-new", listings);
  assert.ok(newest.includes('class="older" href="/stereo/b-mid"') && newest.includes('class="newer none"'));
  const lone = applyPostChrome(post, "stereo", "b-mid", [listings[1]]);
  assert.ok(lone.includes("<!--pager--><!--/pager-->") && !lone.includes("post-pager"));
  // a pager is refreshed when a newer post appears
  const refreshed = applyPostChrome(newest, "stereo", "c-new", [{ slug: "d-newer", titleHtml: "Brand new" }].concat(listings));
  assert.ok(refreshed.includes('class="newer" href="/stereo/d-newer"') && (refreshed.match(/<!--pager-->/g) || []).length === 1);
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
    radio: wrap(card("r-new", "New radio", "October 20, 2026", "../images/posts/radio-r-new.jpg") + card("r-mid", "Mid radio", "October 10, 2026", "/images/category-radio.jpg")),
    "test-equipment": ""
  });
  const order = Array.from(html.matchAll(/<h2><a href="([^"]+)">/g)).map((m) => m[1]);
  assert.deepEqual(order, ["/radio/r-new", "/radio/r-mid", "/stereo/s-old"], "newest first across sections");
  assert.ok(html.includes('<body class="home">') && html.includes('href="/assets/css/style.css"') && html.includes("<h1>Restoration Blog</h1>") && !html.includes('class="intro"'));
  assert.ok(html.includes('src="/images/posts/radio-r-new.jpg"'), "uses the post's own thumbnail");
  for (const s of SECTIONS) assert.ok(html.includes('<a href="/' + s.folder + '/">' + s.name + "</a>"), "links to " + s.name);
  assert.ok(html.includes('aria-current="page">All Posts</a>'), "All Posts is the active nav entry");
  assert.ok(renderBlogHub(content, {}).includes("No posts yet"));
  console.log("ok 5: blog landing page");
}

// 6. the site as the deploy builds it: every post page has the breadcrumb and older/newer links.
// The committed files do not have to: a post published from the admin gets its pager at build time,
// so this builds a scratch copy (after deliberately stripping the pager from one post) and checks that.
{
  const os = await import("node:os");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-blog-"));
  try {
    for (const dir of ["site", "build", "shared", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });

    // a post exactly as the Worker writes it: breadcrumb present, no pager yet
    const target = SECTIONS.flatMap((s) => fs.readdirSync(path.join(work, "site", s.folder))
      .filter((n) => n !== "index.html" && n.endsWith(".html")).map((n) => path.join(work, "site", s.folder, n)))[0];
    if (target) {
      const stripped = fs.readFileSync(target, "utf8").replace(/<!--pager-->[\s\S]*?<!--\/pager-->/, "");
      fs.writeFileSync(target, stripped);
      assert.ok(!stripped.includes("<!--pager-->"));
    }

    const run = spawnSync(process.execPath, [path.join(work, "build", "build-site.mjs")], { cwd: work, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);

    const hub = fs.readFileSync(path.join(work, "site", "blog", "index.html"), "utf8");
    assert.ok(hub.includes("Restoration Blog"));
    let checked = 0;
    for (const section of SECTIONS) {
      const dir = path.join(work, "site", section.folder);
      for (const name of fs.readdirSync(dir)) {
        if (name === "index.html" || !name.endsWith(".html")) continue;
        const page = fs.readFileSync(path.join(dir, name), "utf8");
        const label = section.folder + "/" + name;
        assert.equal((page.match(/<!--crumbs-->/g) || []).length, 1, label + " has one breadcrumb");
        assert.equal((page.match(/<!--pager-->/g) || []).length, 1, label + " has one pager block");
        assert.ok(hub.includes("/" + section.folder + "/" + name.replace(/\.html$/, "")), label + " is listed on the blog page");
        checked++;
      }
    }
    console.log("ok 6: " + checked + " post pages carry the chrome after a build");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 7. listing cards: markup, excerpts, and upgrading older listings
{
  const { cardHtml, excerptOf, normalizeCards, postBodyHtml, listingsOf: parse } = await import("../shared/site-posts.mjs");
  const section = { name: "Radio Repair", folder: "radio" };

  const card = cardHtml({ section, slug: "my-post", titleHtml: "My &amp; post", summary: "A short line", date: "October 9, 2026", thumb: "/images/category-radio.jpg", excerpt: "The text." });
  assert.ok(card.startsWith('<article class="post post-card"><header class="card-head"><h2><a href="my-post.html">My &amp; post</a></h2>'));
  assert.ok(card.includes('<p class="card-sub">A short line</p><div class="meta card-date">October 9, 2026</div></header>'), "subtitle then date");
  assert.ok(card.includes('<p class="card-excerpt">The text. <a class="more" href="my-post.html">Read more</a></p>'));
  assert.ok(card.includes('<footer class="card-foot"><a class="card-tag" href="/radio/">Radio Repair</a></footer>'));
  assert.ok(!/By:|Comments|author/i.test(card), "no author or comments");
  assert.ok(!cardHtml({ section, slug: "s", titleHtml: "T", summary: "", date: "D", thumb: "/x.jpg" }).includes("card-sub"), "no empty subtitle");

  // a card reads back as the same post
  const [back] = parse(card);
  assert.deepEqual([back.slug, back.title, back.date, back.summary, back.excerpt, back.thumb],
    ["my-post", "My & post", "October 9, 2026", "A short line", "The text.", "/images/category-radio.jpg"]);

  // excerpts: plain text, shortened at a word, no markup, nothing for photo-only posts
  assert.equal(excerptOf("<p>Hello <strong>world</strong> &amp; more</p>"), "Hello world & more");
  assert.equal(excerptOf('<figure data-gallery="2"><img src="data:image/png;base64,AAAA" alt=""></figure>'), "");
  const long = excerptOf("<p>" + "word ".repeat(100) + "</p>", 60);
  assert.ok(long.length <= 61 && long.endsWith("…") && !/\s…$/.test(long), long);
  assert.equal(postBodyHtml('<article class="post"><h1>T</h1><div class="body"><p>Text</p></div></article>'), "<p>Text</p>");

  // older listings are upgraded, with the excerpt taken from the post page, and the result is stable
  const older = '<main><article class="post has-thumb"><a class="post-thumb" href="old.html"><img src="../images/category-radio.jpg" alt=""></a><div class="post-main">' +
    '<h2><a href="old.html">Old one</a></h2><div class="meta">October 1, 2026 &nbsp;|&nbsp; <a href="index.html">Radio Repair</a></div><div class="body"><p>Summary line</p></div><a class="more" href="old.html">Read the post</a></div></article></main>';
  const ctx = { section, exists: () => false, excerptFor: (slug) => (slug === "old" ? "From the post body." : "") };
  const upgraded = normalizeCards(older, ctx);
  assert.ok(upgraded.includes('<article class="post post-card">') && !upgraded.includes("has-thumb"));
  assert.ok(upgraded.includes('<p class="card-sub">Summary line</p>') && upgraded.includes('<div class="meta card-date">October 1, 2026</div>'));
  assert.ok(upgraded.includes("From the post body.") && upgraded.includes('src="/images/category-radio.jpg"'), "legacy ../ picture path made absolute");
  assert.equal(normalizeCards(upgraded, ctx), upgraded, "idempotent");
  console.log("ok 7: listing cards");
}

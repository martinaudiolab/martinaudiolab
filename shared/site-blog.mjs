// The Restoration Blog landing page (site/blog/index.html): every post from every
// section, newest first, with a link to each section. Generated at build time from the
// section pages, so it stays current whenever posts are published or deleted.
// Pure string code: the build supplies the section pages' HTML.

import { BLOG_HUB, SECTIONS } from "./sections.mjs";
import { listingsOf, listingWithThumb } from "./site-posts.mjs";
import { heroHtml, shell } from "./site-render.mjs";
import { assetUrl, jsUrl, pageUrl } from "./site-urls.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Dates on listings are "October 9, 2026"; anything unparseable sorts last. */
const timeOf = (label) => {
  const t = Date.parse(label + " UTC");
  return Number.isNaN(t) ? 0 : t;
};

/** The banner slideshow of a blog page (key: "all" or a section key) with the page title on it, wrapped in markers so it can be replaced. */
export function blogHeroHtml(content, key, label) {
  const hero = content.blog_hero[key] || content.blog_hero.all;
  return "<!--hero-->" + heroHtml({ slides: hero.slides, label: label, title: label }) + "<!--/hero-->";
}

const HERO_BLOCK = /<!--hero-->[\s\S]*?<!--\/hero-->/;

/**
 * Gives a section page the shared look: the floating navigation over its own banner. Safe to run
 * repeatedly; the banner is replaced, never duplicated.
 */
export function applyBlogHero(html, content, key, label) {
  let out = html.replace(/<body(?: class="[^"]*")?>/, () => '<body class="home">');
  const block = blogHeroHtml(content, key, label);
  if (HERO_BLOCK.test(out)) out = out.replace(HERO_BLOCK, () => block);
  else out = out.replace("</header>", () => "</header>" + block);
  // the banner now carries the title, so the page's own heading and intro paragraph (above the listings) go
  const start = out.indexOf("<main");
  const listings = out.indexOf("<article", start);
  if (start >= 0) {
    const end = listings >= 0 ? listings : out.indexOf("</main>", start);
    const head = out.slice(start, end)
      .replace(/<h1\b[\s\S]*?<\/h1>\s*/, "")
      .replace(/<p class="intro">[\s\S]*?<\/p>\s*/, "");
    out = out.slice(0, start) + head + out.slice(end);
  }
  if (!/assets\/js\/hero\.js/.test(out)) {
    const script = '<script src="' + jsUrl("hero.js") + '" defer></script>';
    const nav = out.match(/<script[^>]*nav\.js[^>]*><\/script>/);
    out = nav ? out.replace(nav[0], () => script + nav[0]) : out.replace("</body>", () => script + "</body>");
  }
  return out;
}

/** Post pages share the continuous navigation bar (no banner). */
export function applyPostBar(html) {
  return html.replace(/<body(?: class="[^"]*")?>/, () => '<body class="navbar">');
}

/**
 * @param {object} content        normalized site content
 * @param {Object<string,string>} indexByFolder  section folder -> that section page's HTML (missing sections are skipped)
 */
export function renderBlogHub(content, indexByFolder) {
  const posts = [];
  SECTIONS.forEach((section, order) => {
    const html = indexByFolder[section.folder];
    if (!html) return;
    listingsOf(html).forEach((post, position) => posts.push({ post, section, order, position }));
  });
  // newest first; ties keep the section order, then the section's own order
  posts.sort((a, b) => timeOf(b.post.date) - timeOf(a.post.date) || a.order - b.order || a.position - b.position);

  const chips = SECTIONS.map((s) => '<a href="' + esc(pageUrl(s.folder + "/index.html")) + '">' + esc(s.name) + "</a>").join("");
  const cards = posts.map(({ post, section }) => {
    const href = pageUrl(section.folder + "/" + post.slug + ".html");
    // a listing's thumbnail may be a legacy "../images/..." path; either way the hub wants the absolute address
    const thumb = assetUrl((post.thumb || section.image).replace(/^(\.\.\/)+/, ""));
    return listingWithThumb(post.slug, thumb, "")
      .replace('href="' + post.slug + '.html"', 'href="' + esc(href) + '"')
      .replace('<div class="post-main"></div>',
        '<div class="post-main"><h2><a href="' + esc(href) + '">' + post.titleHtml + "</a></h2>" +
        '<div class="meta">' + esc(post.date) + ' &nbsp;|&nbsp; <a href="' + esc(pageUrl(section.folder + "/index.html")) + '">' + esc(section.name) + "</a></div>" +
        (post.summary ? '<div class="body"><p>' + esc(post.summary) + "</p></div>" : "") +
        '<a class="more" href="' + esc(href) + '">Read the post</a></div>');
  });

  // the title is on the banner above; the page starts with the section chips
  const inner = '<div class="blog-sections" role="navigation" aria-label="Blog sections">' + chips + "</div>" +
    (cards.length ? cards.join("") : "<p>No posts yet. Check back soon.</p>");

  return shell(content, {
    title: BLOG_HUB.name + " - " + content.site_name,
    description: BLOG_HUB.intro,
    inner,
    active: BLOG_HUB.href,
    bodyClass: "home",
    beforeMain: blogHeroHtml(content, "all", BLOG_HUB.name),
    scripts: '<script src="' + jsUrl("hero.js") + '" defer></script>'
  });
}

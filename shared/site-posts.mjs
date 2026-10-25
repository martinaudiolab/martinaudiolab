// Blog post pages and section listings: thumbnails, hero image, breadcrumbs and the
// older/newer links. Pure string code shared by the publisher Worker and build/build-site.mjs.

import { BLOG_HUB, sectionByFolder } from "./sections.mjs";
import { requestCtaHtml } from "./site-footer.mjs";
import { pageUrl } from "./site-urls.mjs";

/** Where a post's own thumbnail is stored, relative to site/. */
export const thumbFile = (folder, slug) => "images/posts/" + folder + "-" + slug + ".jpg";

/** The folder holding a post's own photos, relative to site/ (one folder per post, so deleting it is one prefix). */
export const postImageDir = (folder, slug) => "images/posts/" + folder + "/" + slug + "/";

const EMBEDDED_IMAGE = /(<img\b[^>]*?\bsrc=")data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+\/]+={0,2})"/gi;

/**
 * Moves the photos embedded in a post's HTML (data: addresses, as the editor sends them) into files of their own:
 * each becomes images/posts/<folder>/<slug>/<n>.<ext>, and the same photo used twice is stored once. A page then
 * loads its text first and its photos separately, instead of carrying several megabytes of encoded pictures.
 * Returns { html, files: [{ path (relative to site/), data (base64) }] }.
 */
export function extractPostImages(html, folder, slug) {
  const files = [];
  const byData = new Map();
  const out = String(html).replace(EMBEDDED_IMAGE, (whole, before, type, data) => {
    let path = byData.get(data);
    if (!path) {
      const ext = type.toLowerCase() === "jpeg" ? "jpg" : type.toLowerCase();
      path = postImageDir(folder, slug) + (files.length + 1) + "." + ext;
      byData.set(data, path);
      files.push({ path, data });
    }
    return before + "/" + path + '"';
  });
  return { html: out, files };
}

/** Drops the blank lines the editor leaves at the end of a post (empty paragraphs, stray line breaks), which showed as a gap before the older/newer links. */
export function trimTrailingBlank(bodyHtml) {
  return String(bodyHtml).replace(/(?:\s|<br\s*\/?>|<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+$/i, "");
}

/** Photos in a post's text load as they come into view (the picture under the title is outside the text and loads at once). */
export function lazyImages(bodyHtml) {
  return String(bodyHtml).replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"');
}

/** The section picture used when a post has no thumbnail of its own (relative to a section page). */
export const fallbackThumb = (folder) => {
  const section = sectionByFolder(folder);
  return "/" + (section ? section.image : "images/category-" + folder + ".jpg");
};

const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const decode = (s) => String(s).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ---- section listing entries ------------------------------------------------------

/** The thumbnail link that sits beside a listing; the image is decorative, the title link carries the name. */
export function thumbLink(slug, src, href) {
  return '<a class="post-thumb" href="' + attr(href || slug + ".html") + '" tabindex="-1" aria-hidden="true"><img src="' + attr(src) + '" alt="" loading="lazy"></a>';
}

/** Plain text of some HTML, shortened at a word boundary (for the excerpt on a listing card). */
export function excerptOf(html, max) {
  const limit = max || 220;
  const text = String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!-]+$/, "") + "\u2026";
}

/** The body text of a published post page (the part inside <div class="body">). */
export function postBodyHtml(pageHtml) {
  const m = String(pageHtml).match(/<div class="body">([\s\S]*)<\/div><\/article>/);
  return m ? m[1] : "";
}

/** "October 10, 2026" -> "October 10th, 2026" (a date that already has its suffix is left alone). */
export function ordinalDate(label) {
  return String(label).replace(/\b(\d{1,2})(?:st|nd|rd|th)?(?=,)/, (m, day) => {
    const n = Number(day);
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
    return n + suffix;
  });
}

/**
 * A listing card for a section page or the blog page, in this order: header (title, subtitle, date),
 * a full-width rule, picture + excerpt, and a footer band with one tag naming the section.
 * No author line and no comments. o: { section ({ folder } of a known section), slug, titleHtml,
 * summary (the subtitle), date, thumb, excerpt, href (the post's address; default "<slug>.html"),
 * tagHref (default "/<folder>/") }.
 * The title link stays an <h2><a href="...html"> inside <article class="post">, which the Worker and
 * the Manage Blog Posts tab rely on.
 */
export function cardHtml(o) {
  const section = sectionByFolder(o.section && o.section.folder);
  if (!section) throw new Error("Unknown blog section for a listing card: " + JSON.stringify(o.section && o.section.folder));
  const href = o.href || o.slug + ".html";
  const tagHref = o.tagHref || "/" + section.folder + "/";
  return '<article class="post post-card">' +
    '<header class="card-head"><h2><a href="' + attr(href) + '">' + o.titleHtml + "</a></h2>" +
    (o.summary ? '<p class="card-sub">' + attr(o.summary) + "</p>" : "") +
    '<time class="card-date">' + attr(ordinalDate(o.date)) + "</time></header>" +
    '<hr class="card-rule">' +
    '<div class="card-body">' + thumbLink(o.slug, o.thumb, href) +
    '<p class="card-excerpt">' + (o.excerpt ? attr(o.excerpt) + " " : "") + '<a class="more" href="' + attr(href) + '">Read More</a></p></div>' +
    '<footer class="card-foot"><a class="card-tag" href="' + attr(tagHref) + '">' + attr(section.tag) + "</a></footer></article>";
}

/**
 * Rewrites every listing on a section page as a card, with the post's picture and an excerpt.
 * ctx: { section, exists(path), excerptFor(slug) }. Safe to run repeatedly.
 */
export function normalizeCards(indexHtml, ctx) {
  const folder = ctx.section.folder;
  return indexHtml.replace(/<article class="post[^"]*">[\s\S]*?<\/article>/g, (whole) => {
    const post = listingsOf(whole)[0];
    if (!post) return whole;
    const own = thumbFile(folder, post.slug);
    let thumb = post.thumb ? post.thumb.replace(/^(\.\.\/)+/, "/") : "";
    if (!thumb) thumb = typeof ctx.exists === "function" && ctx.exists(own) ? "/" + own : fallbackThumb(folder);
    const excerpt = (ctx.excerptFor && ctx.excerptFor(post.slug)) || post.excerpt || "";
    return cardHtml({ section: ctx.section, slug: post.slug, titleHtml: post.titleHtml, summary: post.summary, date: post.date, thumb, excerpt });
  });
}

/** A complete listing entry for a section page. `inner` is the title, date, summary and link markup. */
export function listingWithThumb(slug, src, inner) {
  return '<article class="post has-thumb">' + thumbLink(slug, src) + '<div class="post-main">' + inner + "</div></article>";
}

/**
 * Adds a thumbnail to every listing that does not have one yet. `exists(path)` says whether a
 * post's own thumbnail file is present (path relative to site/); otherwise the section picture is used.
 * Safe to run repeatedly.
 */
export function addThumbnails(indexHtml, folder, exists) {
  return indexHtml.replace(/<article class="post">([\s\S]*?)<\/article>/g, (whole, inner) => {
    const match = inner.match(new RegExp('<h2><a href="(' + SLUG + ')\\.html"'));
    if (!match) return whole;
    const own = thumbFile(folder, match[1]);
    const src = typeof exists === "function" && exists(own) ? "/" + own : fallbackThumb(folder);
    return listingWithThumb(match[1], src, inner);
  });
}

/**
 * The posts listed on a section page, newest first (the order the publisher keeps them in).
 * Each entry: { slug, titleHtml, title, date, summary, thumb }.
 */
export function listingsOf(indexHtml) {
  const out = [];
  const articles = /<article class="post[^"]*">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = articles.exec(indexHtml))) {
    const inner = m[1];
    const link = inner.match(new RegExp('<h2><a href="(?:/[a-z0-9-]+/)?(' + SLUG + ')(?:\\.html)?">([\\s\\S]*?)</a></h2>'));
    if (!link) continue;
    // the card layout, or the earlier plain listing layout
    const date = inner.match(/<time class="card-date">([^<]*)<\/time>/) || inner.match(/<div class="meta[^"]*">([^<&]*?)\s*(?:&nbsp;|<)/);
    const summary = inner.match(/<p class="card-sub">([\s\S]*?)<\/p>/) || inner.match(/<div class="body"><p>([\s\S]*?)<\/p>/);
    const excerpt = inner.match(/<p class="card-excerpt">([\s\S]*?)\s*<a class="more"/);
    const thumb = inner.match(/<img src="([^"]+)"/);
    out.push({
      slug: link[1],
      titleHtml: link[2],
      title: decode(link[2]),
      date: date ? date[1].trim() : "",
      summary: summary ? decode(summary[1]) : "",
      excerpt: excerpt ? decode(excerpt[1]).trim() : "",
      thumb: thumb ? thumb[1].replace(/&amp;/g, "&") : ""
    });
  }
  return out;
}

// ---- post pages --------------------------------------------------------------------

/** The picture under a post's title (the same picture as its listing thumbnail); clicking it opens the lightbox. */
export function heroFigure(src, title) {
  return '<figure class="post-hero"><img src="' + attr(src) + '" alt="' + attr(title) + '"></figure>';
}

/**
 * Puts the hero image under the title block of an existing post page. Safe to run repeatedly.
 * `exists(path)` says whether the post's own thumbnail file is present (path relative to site/).
 */
export function addPostHero(postHtml, folder, slug, exists) {
  if (postHtml.includes('class="post-hero"')) return postHtml;
  const title = postHtml.match(/<h1 class="post-title">([\s\S]*?)<\/h1>/);
  const meta = postHtml.match(/<div class="meta">[\s\S]*?<\/div>/);
  if (!title || !meta) return postHtml;
  const own = thumbFile(folder, slug);
  const src = typeof exists === "function" && exists(own) ? "/" + own : fallbackThumb(folder);
  const at = postHtml.indexOf(meta[0], postHtml.indexOf(title[0])) + meta[0].length;
  if (at < meta[0].length) return postHtml;
  return postHtml.slice(0, at) + heroFigure(src, decode(title[1])) + postHtml.slice(at);
}

const CRUMBS_RE = /<!--crumbs-->[\s\S]*?<!--\/crumbs-->/;
const PAGER_RE = /<!--pager-->[\s\S]*?<!--\/pager-->/;
const CTA_RE = /<!--cta-->[\s\S]*?<!--\/cta-->/;

/** Home > Restoration Blog > Section > Post title (a post page lives one folder down, so links go up first). */
export function crumbsHtml(sectionName, titleHtml, folder) {
  const sep = '<span aria-hidden="true">&rsaquo;</span>';
  return "<!--crumbs--><div class=\"crumbs\" role=\"navigation\" aria-label=\"Breadcrumb\">" +
    '<a href="/">Home</a>' + sep +
    '<a href="' + pageUrl(BLOG_HUB.href) + '">' + attr(BLOG_HUB.name) + "</a>" + sep +
    '<a href="' + pageUrl(folder + "/index.html") + '">' + attr(sectionName) + "</a>" + sep +
    '<span aria-current="page">' + titleHtml + "</span></div><!--/crumbs-->";
}

/** Older / newer links within the section. Either may be missing. */
export function pagerHtml(newer, older, folder) {
  if (!newer && !older) return "<!--pager--><!--/pager-->";
  const link = (cls, label, post) => post
    ? '<a class="' + cls + '" href="' + attr(pageUrl(folder + "/" + post.slug + ".html")) + '"><small>' + label + "</small><span>" + post.titleHtml + "</span></a>"
    : '<span class="' + cls + ' none"></span>';
  return '<!--pager--><div class="post-pager" role="navigation" aria-label="More posts in this section">' +
    link("older", "&larr; Older", older) + link("newer", "Newer &rarr;", newer) + "</div><!--/pager-->";
}

/**
 * Brings a post page's breadcrumb and older/newer links up to date. Safe to run repeatedly;
 * the blocks are delimited by comments so they are replaced, never duplicated.
 * `listings` is listingsOf() of the section page.
 */
export function applyPostChrome(postHtml, folder, slug, listings) {
  const section = sectionByFolder(folder);
  const title = postHtml.match(/<h1 class="post-title">([\s\S]*?)<\/h1>/);
  if (!section || !title) return postHtml;
  let out = postHtml;

  const crumbs = crumbsHtml(section.name, title[1], folder);
  if (CRUMBS_RE.test(out)) out = out.replace(CRUMBS_RE, () => crumbs);
  else out = out.replace(/<a class="back" href="index\.html">[\s\S]*?<\/a>/, () => crumbs);

  const at = listings.findIndex((p) => p.slug === slug);
  const pager = at < 0 ? "<!--pager--><!--/pager-->" : pagerHtml(listings[at - 1] || null, listings[at + 1] || null, folder);
  if (PAGER_RE.test(out)) out = out.replace(PAGER_RE, () => pager);
  else out = out.replace("</article>", () => "</article>" + pager);

  // then the next step: the request form
  const cta = requestCtaHtml("Have something like this that needs restoring?");
  if (CTA_RE.test(out)) out = out.replace(CTA_RE, () => cta);
  else out = out.replace(PAGER_RE, (block) => block + cta);
  return out;
}

// Blog post pages and section listings: thumbnails, hero image, breadcrumbs and the
// older/newer links. Pure string code shared by the publisher Worker and build/build-site.mjs.

import { BLOG_HUB, sectionByFolder } from "./sections.mjs";
import { pageUrl } from "./site-urls.mjs";

/** Where a post's own thumbnail is stored, relative to site/. */
export const thumbFile = (folder, slug) => "images/posts/" + folder + "-" + slug + ".jpg";

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
export function thumbLink(slug, src) {
  return '<a class="post-thumb" href="' + attr(slug) + '.html" tabindex="-1" aria-hidden="true"><img src="' + attr(src) + '" alt="" loading="lazy"></a>';
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
    const link = inner.match(new RegExp('<h2><a href="(' + SLUG + ')\\.html">([\\s\\S]*?)</a></h2>'));
    if (!link) continue;
    const date = inner.match(/<div class="meta">([^<&]*?)\s*&nbsp;/);
    const summary = inner.match(/<div class="body"><p>([\s\S]*?)<\/p>/);
    const thumb = inner.match(/<img src="([^"]+)"/);
    out.push({
      slug: link[1],
      titleHtml: link[2],
      title: decode(link[2]),
      date: date ? date[1].trim() : "",
      summary: summary ? decode(summary[1]) : "",
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
  return out;
}

// Thumbnails for the blog section pages (stereo/, radio/, test-equipment/).
// Pure string code shared by publisher/worker.js and scripts/build-site.mjs.

/** Where a post's own thumbnail is stored, relative to site/. */
export const thumbFile = (folder, slug) => "images/posts/" + folder + "-" + slug + ".jpg";

/** The section picture used when a post has no thumbnail of its own (relative to a section page). */
export const fallbackThumb = (folder) => "../images/category-" + folder + ".jpg";

const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The thumbnail link that sits beside a listing; the image is decorative, the title link carries the name. */
export function thumbLink(slug, src) {
  return '<a class="post-thumb" href="' + attr(slug) + '.html" tabindex="-1" aria-hidden="true"><img src="' + attr(src) + '" alt="" loading="lazy"></a>';
}

/** A complete listing entry for a section page. `inner` is the title, date, summary and link markup. */
export function listingWithThumb(slug, src, inner) {
  return '<article class="post has-thumb">' + thumbLink(slug, src) + '<div class="post-main">' + inner + "</div></article>";
}

/** The image under a post's title (same picture as its listing thumbnail); clicking it opens the lightbox. */
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
  const src = typeof exists === "function" && exists(own) ? "../" + own : fallbackThumb(folder);
  const at = postHtml.indexOf(meta[0], postHtml.indexOf(title[0])) + meta[0].length;
  if (at < meta[0].length) return postHtml;
  const plain = title[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return postHtml.slice(0, at) + heroFigure(src, plain) + postHtml.slice(at);
}

/**
 * Adds a thumbnail to every listing that does not have one yet. `exists(path)` says whether a
 * post's own thumbnail file is present (path relative to site/); otherwise the section picture is used.
 * Safe to run repeatedly.
 */
export function addThumbnails(indexHtml, folder, exists) {
  return indexHtml.replace(/<article class="post">([\s\S]*?)<\/article>/g, (whole, inner) => {
    const match = inner.match(/<h2><a href="([a-z0-9]+(?:-[a-z0-9]+)*)\.html"/);
    if (!match) return whole;
    const own = thumbFile(folder, match[1]);
    const src = typeof exists === "function" && exists(own) ? "../" + own : fallbackThumb(folder);
    return listingWithThumb(match[1], src, inner);
  });
}

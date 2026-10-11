// Renders the pages driven by site-data/site-content.json (home, request, about)
// and applies the global fields (site name, navigation) to
// hand-written or published pages. Pure string code: no file-system APIs.

import { NAV_SCRIPT, navHtml } from "./site-nav.mjs";
import { CSS_URL, absolutizeAssets, assetUrl, jsUrl, pageUrl } from "./site-urls.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const external = (h) => /^(https?:|mailto:)/i.test(h);

export function shell(content, o) {
  return "<!DOCTYPE html>\n<html lang=\"en\">" + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' +
    esc(o.title) + '</title><meta name="description" content="' + esc(o.description) + '"><link rel="stylesheet" href="' + CSS_URL + '"></head><body' + (o.bodyClass ? ' class="' + o.bodyClass + '"' : "") + ">" +
    '<header class="site"><a class="brand" href="/">' + esc(content.site_name) + "</a>" + navHtml(content.nav_items, o.active) + "</header>" +
    (o.beforeMain || "") + (o.inner ? "<main>" + o.inner + "</main>" : "") + (o.afterMain || "") + (o.scripts || "") + NAV_SCRIPT() + "</body></html>\n";
}

/** Paragraphs separated by blank lines; single line breaks become <br>. */
const paragraphs = (value) => String(value || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");

const mailto = (email) => '<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>";

/** The full-width slideshow hero shared by the homepage and the shop page. */
export function heroHtml(o) {
  const slides = o.slides.map((slide, i) =>
    '<img class="hero-slide' + (i === 0 ? " active" : "") + '" src="' + esc(assetUrl(slide.image)) + '" alt="' + esc(slide.alt) + '"' +
    (i === 0 ? ' fetchpriority="high"' : ' loading="lazy"') + (i === 0 ? "" : ' aria-hidden="true"') + ">").join("");
  const text = o.bare ? "" : '<div class="hero-text"><h1>' + esc(o.title) + "</h1>" + (o.subtitle ? "<p>" + esc(o.subtitle) + "</p>" : "") + "</div>";
  return '<section class="hero" id="hero" aria-label="' + esc(o.label) + '">' + slides +
    '<div class="hero-scrim"></div>' + text + "</section>";
}

export function renderHome(content) {
  const h = content.homepage;
  const cats = h.categories.map((c) =>
    '<section class="cat-row' + (c.image ? "" : " no-image") + '" aria-label="' + esc(c.label) + '">' +
    (c.image ? '<div class="cat-media"><img src="' + esc(assetUrl(c.image)) + '" alt="" loading="lazy"></div>' : "") +
    '<div class="cat-text"><div class="cat-copy"><h2>' + esc(c.label) + "</h2>" +
    (c.description ? "<p>" + esc(c.description) + "</p>" : "") +
    '<a class="cat-cta" href="' + esc(pageUrl(c.href)) + '">' + esc(c.cta_label) + "</a></div></div></section>").join("");
  const pc = h.product_carousel;
  const carousel = pc.enabled
    ? '<section class="forsale" id="forsale" aria-label="' + esc(pc.heading) + '" hidden><h2 class="fs-label">' + esc(pc.heading) + "</h2>" +
      '<div class="fs-grid" id="fs-grid"></div>' +
      '<p class="fs-more"><a class="fs-viewall" href="' + esc(pageUrl(pc.view_all_link.href)) + '">' + esc(pc.view_all_link.label) + "</a></p></section>"
    : "";
  const hero = heroHtml({ slides: h.hero.slides, title: h.hero.title, subtitle: h.hero.subtitle, label: content.site_name });
  // The homepage is full-bleed from the hero down: no centered container.
  return shell(content, {
    title: content.site_name + " - " + h.hero.title,
    description: h.hero.subtitle || h.hero.title,
    inner: "",
    active: "index.html",
    bodyClass: "home",
    beforeMain: hero,
    afterMain: carousel + (h.trust_line ? '<p class="trust-line">' + esc(h.trust_line) + "</p>" : "") +
      '<div class="cats" aria-label="Restoration blog sections">' + cats + "</div>",
    scripts: '<script src="' + jsUrl("hero.js") + '" defer></script><script src="' + jsUrl("reveal.js") + '" defer></script>' + (pc.enabled ? '<script src="' + jsUrl("forsale.js") + '" defer></script>' : "")
  });
}

export function renderRequest(content) {
  const r = content.request;
  const field = (id, label, control) => '<div class="field"><label for="' + id + '">' + label + "</label>" + control + "</div>";
  const inner = '<div class="request-wrap"><h1 class="h2" style="font-size:2rem">' + esc(r.title) + "</h1>" +
    (r.intro ? '<p class="intro">' + esc(r.intro) + "</p>" : "") +
    '<form class="request-form" id="request-form" action="' + esc(r.form_action) + '" method="POST" data-success="' + esc(r.success_message) + '">' +
    field("req-name", "Name", '<input type="text" id="req-name" name="name" required placeholder="Your name" autocomplete="name">') +
    field("req-email", "Email", '<input type="email" id="req-email" name="email" required placeholder="you@example.com" autocomplete="email">') +
    field("req-model", "Unit Model Number", '<input type="text" id="req-model" name="unit_model" required placeholder="e.g. Zenith 6D221, Sansui AU-9000, Marantz 2230S">') +
    field("req-description", "Description of unit", '<textarea id="req-description" name="description" rows="6" required placeholder="What is it doing, or not doing? Any prior work? Include as much detail as you can."></textarea>') +
    '<input type="hidden" name="_subject" value="' + esc(r.subject) + '">' +
    '<input type="text" name="_gotcha" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<button class="btn request-submit" type="submit">Send Request</button>' +
    '<p class="request-result" id="request-result" role="status" aria-live="polite"></p>' +
    "</form></div>";
  return shell(content, { bodyClass: "navbar",
    title: r.title + " - " + content.site_name,
    description: "Request a restoration from " + content.site_name,
    inner,
    active: "request.html",
    scripts: '<script src="' + jsUrl("request.js") + '" defer></script>'
  });
}

export function renderAbout(content) {
  const a = content.about;
  const email = a.contact.email || content.contact_email;
  const sections = a.sections.map((s) => '<section class="phil">' + (s.heading ? "<h2>" + esc(s.heading) + "</h2>" : "") + paragraphs(s.body) + "</section>").join("");
  const meta = [a.location, a.response_time].filter(Boolean).map((t) => "<br>" + esc(t)).join("");
  const inner = '<h1 class="h2" style="font-size:2rem">' + esc(a.title) + "</h1>" +
    (a.bio ? '<div class="intro about-bio">' + paragraphs(a.bio) + "</div>" : "") +
    sections +
    '<p class="about-contact">' + (a.contact.heading ? esc(a.contact.heading) + " " : "") + mailto(email) + meta + "</p>";
  return shell(content, { bodyClass: "navbar",
    title: a.title + " - " + content.site_name,
    description: (a.bio ? a.bio.split("\n")[0] : "About " + content.site_name).slice(0, 200),
    inner,
    active: "about.html"
  });
}

/** Nav entry that should be highlighted for a page at site-relative path `rel`. */
export function activeFor(rel) {
  const parts = rel.split("/");
  return parts.length > 1 ? parts[0] + "/index.html" : rel;
}

/**
 * Applies the global fields to an existing page: brand, <title> suffix, default
 * navigation and the nav script. Pages with no <nav> are returned as is.
 */
export function applyGlobals(html, content, rel) {
  const navStart = html.indexOf("<nav>");
  const navEnd = html.indexOf("</nav>", navStart);
  if (navStart < 0 || navEnd < 0) return html;
  let out = html.slice(0, navStart) + navHtml(content.nav_items, activeFor(rel)) + html.slice(navEnd + "</nav>".length);
  out = absolutizeAssets(out);

  out = out.replace(/(<a class="brand"[^>]*>)[^<]*(<\/a>)/, (m, a, b) => a + esc(content.site_name) + b);
  // The site is dark only: drop the old theme attribute and toggle script from pages written before it was removed.
  out = out.replace(/<html lang="en"(?: data-theme="[^"]*")?>/, () => '<html lang="en">');
  out = out.replace(/<script>\(function\(\)\{var r=document\.documentElement;try\{var t=localStorage\.getItem\("th"\)[\s\S]*?\)\(\)<\/script>/, "");
  const t1 = out.indexOf("<title>");
  const t2 = out.indexOf("</title>", t1);
  if (t1 >= 0 && t2 > t1) {
    const title = out.slice(t1 + 7, t2);
    const cut = title.lastIndexOf(" - ");
    if (cut > 0) out = out.slice(0, t1 + 7) + title.slice(0, cut) + " - " + esc(content.site_name) + out.slice(t2);
  }
  // Match any spelling of the tag: the publisher Worker writes defer="" where the templates write defer.
  const navScript = /<script\b[^>]*\bsrc="[^"]*nav\.js"[^>]*>\s*<\/script>/g;
  const found = out.match(navScript) || [];
  if (found.length === 0) out = out.replace("</body>", () => NAV_SCRIPT() + "</body>");
  else if (found.length > 1) { let seen = false; out = out.replace(navScript, (tag) => (seen ? "" : ((seen = true), tag))); }
  return out;
}

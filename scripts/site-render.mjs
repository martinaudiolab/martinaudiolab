// Renders the pages driven by site-data/site-content.json (home, request, about)
// and applies the global fields (site name, navigation, default theme) to
// hand-written or published pages. Pure string code: no file-system APIs.

import { NAV_SCRIPT, navHtml } from "./site-nav.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const external = (h) => /^(https?:|mailto:)/i.test(h);
const THEME = '<script>(function(){var r=document.documentElement;try{var t=localStorage.getItem("th");if(t)r.setAttribute("data-theme",t)}catch(e){}document.getElementById("th").onclick=function(){var d=r.getAttribute("data-theme")==="dark"||(!r.getAttribute("data-theme")&&matchMedia("(prefers-color-scheme:dark)").matches),n=d?"light":"dark";r.setAttribute("data-theme",n);try{localStorage.setItem("th",n)}catch(e){}}})()</script>';

export const themeAttr = (content) => (content.theme === "dark" || content.theme === "light" ? ' data-theme="' + content.theme + '"' : "");

function shell(content, o) {
  const prefix = o.prefix || "";
  return "<!DOCTYPE html>\n<html lang=\"en\"" + themeAttr(content) + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' +
    esc(o.title) + '</title><meta name="description" content="' + esc(o.description) + '"><link rel="stylesheet" href="' + prefix + 'style.css"></head><body' + (o.bodyClass ? ' class="' + o.bodyClass + '"' : "") + ">" +
    '<header class="site"><a class="brand" href="' + prefix + 'index.html">' + esc(content.site_name) + "</a>" + navHtml(content.nav_items, o.active, prefix) + "</header>" +
    (o.beforeMain || "") + "<main>" + o.inner + "</main>" + (o.scripts || "") + NAV_SCRIPT(prefix) + THEME + "</body></html>\n";
}

/** Paragraphs separated by blank lines; single line breaks become <br>. */
const paragraphs = (value) => String(value || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");

const mailto = (email) => '<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>";

export function renderHome(content) {
  const h = content.homepage;
  const cats = h.categories.map((c) =>
    '<a class="cat" href="' + esc(c.href) + '"><img src="' + esc(c.image) + '" alt="' + esc(c.label) + '" loading="lazy"><strong>' + esc(c.label) + "</strong>" +
    (c.description ? '<small class="cat-desc">' + esc(c.description) + "</small>" : "") + "<span>See the work &rarr;</span></a>").join("");
  const pc = h.product_carousel;
  const carousel = pc.enabled
    ? '<section class="forsale" id="forsale" aria-label="' + esc(pc.heading) + '" hidden><div class="fs-head"><h2>' + esc(pc.heading) + '</h2><a href="' + esc(pc.view_all_link.href) + '">' + esc(pc.view_all_link.label) +
      '</a></div><div class="fs-wrap"><button class="fs-btn fs-prev" type="button" aria-label="Previous items">&#8249;</button><div class="fs-track" tabindex="0"></div><button class="fs-btn fs-next" type="button" aria-label="Next items">&#8250;</button></div></section>'
    : "";
  const slides = h.hero.slides.map((slide, i) =>
    '<img class="hero-slide' + (i === 0 ? " active" : "") + '" src="' + esc(slide.image) + '" alt="' + esc(slide.alt) + '"' +
    (i === 0 ? ' fetchpriority="high"' : ' loading="lazy"') + (i === 0 ? "" : ' aria-hidden="true"') + ">").join("");
  const hero = '<section class="hero" id="hero" aria-label="' + esc(content.site_name) + '">' + slides +
    '<div class="hero-scrim"></div><div class="hero-text"><h1>' + esc(h.hero.title) + "</h1>" +
    (h.hero.subtitle ? "<p>" + esc(h.hero.subtitle) + "</p>" : "") + "</div></section>";
  // The hero is full width; everything after it sits in the centered content container.
  const inner = '<div class="lead"><p>' + esc(h.intro.text) + "</p></div>" +
    carousel + (h.trust_line ? '<p class="trust-line">' + esc(h.trust_line) + "</p>" : "") +
    '<section class="cats" aria-label="Restoration blog sections">' + cats + "</section>";
  return shell(content, {
    title: content.site_name + " - " + h.hero.title,
    description: h.hero.subtitle || h.hero.title,
    inner,
    active: "index.html",
    bodyClass: "home",
    beforeMain: hero,
    scripts: '<script src="hero.js" defer></script>' + (pc.enabled ? '<script src="forsale.js" defer></script>' : "")
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
  return shell(content, {
    title: r.title + " - " + content.site_name,
    description: "Request a restoration from " + content.site_name,
    inner,
    active: "request.html",
    scripts: '<script src="request.js" defer></script>'
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
  return shell(content, {
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
 * theme, navigation and the nav script. Pages with no <nav> are returned as is.
 */
export function applyGlobals(html, content, rel) {
  const prefix = rel.includes("/") ? "../" : "";
  const navStart = html.indexOf("<nav>");
  const navEnd = html.indexOf("</nav>", navStart);
  if (navStart < 0 || navEnd < 0) return html;
  let out = html.slice(0, navStart) + navHtml(content.nav_items, activeFor(rel), prefix) + html.slice(navEnd + "</nav>".length);

  out = out.replace(/(<a class="brand"[^>]*>)[^<]*(<\/a>)/, (m, a, b) => a + esc(content.site_name) + b);
  out = out.replace(/<html lang="en"(?: data-theme="[^"]*")?>/, () => '<html lang="en"' + themeAttr(content) + ">");
  const t1 = out.indexOf("<title>");
  const t2 = out.indexOf("</title>", t1);
  if (t1 >= 0 && t2 > t1) {
    const title = out.slice(t1 + 7, t2);
    const cut = title.lastIndexOf(" - ");
    if (cut > 0) out = out.slice(0, t1 + 7) + title.slice(0, cut) + " - " + esc(content.site_name) + out.slice(t2);
  }
  const script = NAV_SCRIPT(prefix);
  if (!out.includes(script)) out = out.replace("</body>", () => script + "</body>");
  return out;
}

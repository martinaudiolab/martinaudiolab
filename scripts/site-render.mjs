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
    esc(o.title) + '</title><meta name="description" content="' + esc(o.description) + '"><link rel="stylesheet" href="' + prefix + 'style.css"></head><body>' +
    '<header class="site"><a class="brand" href="' + prefix + 'index.html">' + esc(content.site_name) + "</a>" + navHtml(content.nav_items, o.active, prefix) + "</header>" +
    "<main>" + o.inner + "</main>" + (o.scripts || "") + NAV_SCRIPT(prefix) + THEME + "</body></html>\n";
}

/** Paragraphs separated by blank lines; single line breaks become <br>. */
const paragraphs = (value) => String(value || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");

const mailto = (email) => '<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>";

/** Escapes text, then turns the contact address (or the {email} token) into a mailto link. */
function withEmailLink(value, email) {
  const safe = esc(String(value || "").replace(/\{email\}/g, email));
  return safe.split(esc(email)).join(mailto(email));
}

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
  const inner = '<div class="banner" style="background-image:url(' + esc(h.hero.image) + ')"><div class="bt"><h1>' + esc(h.hero.title) + "</h1>" +
    (h.hero.subtitle ? "<p>" + esc(h.hero.subtitle) + "</p>" : "") + "</div></div>" +
    '<div class="lead"><p>' + esc(h.intro.text) + "</p></div>" +
    '<section class="cats" aria-label="Restoration blog sections">' + cats + "</section>" +
    carousel + (h.trust_line ? '<p class="trust-line">' + esc(h.trust_line) + "</p>" : "");
  return shell(content, {
    title: content.site_name + " - " + h.hero.title,
    description: h.hero.subtitle || h.hero.title,
    inner,
    active: "index.html",
    scripts: pc.enabled ? '<script src="forsale.js" defer></script>' : ""
  });
}

export function renderRequest(content) {
  const r = content.request;
  const subject = encodeURIComponent(r.email.subject);
  const body = encodeURIComponent(r.email.body_template.replace(/\\n/g, "\n"));
  const items = r.instructions.items.length ? "<ul>" + r.instructions.items.map((i) => "<li>" + esc(i) + "</li>").join("") + "</ul>" : "";
  const inner = '<h1 class="h2" style="font-size:2rem">' + esc(r.title) + "</h1>" +
    (r.intro ? '<p class="intro">' + esc(r.intro) + "</p>" : "") +
    (r.instructions.heading || items ? '<div class="body">' + (r.instructions.heading ? "<p>" + esc(r.instructions.heading) + "</p>" : "") + items + "</div>" : "") +
    '<p><a class="btn" href="mailto:' + esc(content.contact_email) + "?subject=" + subject + "&amp;body=" + body + '">Email a restoration request</a></p>' +
    (r.secondary_contact_text ? '<p class="hint">' + withEmailLink(r.secondary_contact_text, content.contact_email) + "</p>" : "");
  return shell(content, { title: r.title + " - " + content.site_name, description: "Request a restoration from " + content.site_name, inner, active: "request.html" });
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

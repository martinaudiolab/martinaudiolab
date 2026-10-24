// The footer at the end of every public page: the brand and tagline, the navigation (each dropdown as its own
// column), the contact address and a Request a Restoration button. Built from the content file, so it follows
// the admin's site name, menu and contact email. Pure string code: no file-system APIs.

import { DEFAULT_NAV } from "./site-content.mjs";
import { pageUrl } from "./site-urls.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const external = (h) => /^(https?:|mailto:)/i.test(h);
const FOOTER = /<footer class="site-foot">[\s\S]*?<\/footer>/;

export function footerHtml(content) {
  const items = Array.isArray(content.nav_items) && content.nav_items.length ? content.nav_items : DEFAULT_NAV;
  const link = (item) => '<a href="' + esc(pageUrl(item.href)) + '"' + (external(item.href) && !/^mailto:/i.test(item.href) ? ' rel="noopener"' : "") + ">" + esc(item.label) + "</a>";
  const column = (heading, links) => '<div class="foot-col"><h2>' + esc(heading) + "</h2>" + links.map(link).join("") + "</div>";
  const menus = items.filter((item) => Array.isArray(item.children) && item.children.length);
  const pages = items.filter((item) => !(Array.isArray(item.children) && item.children.length));
  const email = content.contact_email;
  const tagline = content.homepage && content.homepage.hero ? content.homepage.hero.subtitle : "";
  return '<footer class="site-foot"><div class="foot-inner">' +
    '<div class="foot-brand"><a class="brand" href="/">' + esc(content.site_name) + "</a>" + (tagline ? "<p>" + esc(tagline) + "</p>" : "") + "</div>" +
    (pages.length ? column("Site", pages) : "") +
    menus.map((menu) => column(menu.label, menu.children)).join("") +
    '<div class="foot-col foot-contact"><h2>Contact</h2>' + (email ? '<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>" : "") +
    '<a class="foot-cta" href="' + pageUrl("request.html") + '">Request a Restoration</a></div>' +
    '</div><p class="foot-copy">&copy; ' + new Date().getFullYear() + " " + esc(content.site_name) + "</p></footer>";
}

/**
 * Puts the current footer on an existing page: replaces the one already there, or adds it after the page's
 * content (after </main>, or before the scripts at the end of the body).
 */
export function applyFooter(html, content) {
  const footer = footerHtml(content);
  if (FOOTER.test(html)) return html.replace(FOOTER, () => footer);
  const mainEnd = html.lastIndexOf("</main>");
  if (mainEnd >= 0) return html.slice(0, mainEnd + 7) + footer + html.slice(mainEnd + 7);
  return html.replace("</body>", () => footer + "</body>");
}

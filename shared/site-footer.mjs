// The footer at the end of every public page: the brand and tagline, the navigation (each dropdown as its own
// column), the contact address and a Request a Restoration button. Built from the content file, so it follows
// the admin's site name, menu and contact email. Pure string code: no file-system APIs.

import { DEFAULT_NAV } from "./site-content.mjs";
import { pageUrl } from "./site-urls.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const external = (h) => /^(https?:|mailto:)/i.test(h);
// the footer, and the statistics script that travels with it (so every page that gets the footer gets both, once)
const FOOTER = /<footer class="site-foot">[\s\S]*?<\/footer>(?:<!--analytics-->[\s\S]*?<!--\/analytics-->)?/;

/**
 * Cloudflare Web Analytics, when a token is set on the Global tab: Cloudflare's own beacon (no cookies, no personal
 * data). The content security policy in site/_headers allows its script and the address it reports to. Without a
 * token there is no script at all.
 */
export function analyticsHtml(content) {
  const token = content.analytics_token;
  if (!token || !/^[A-Za-z0-9]{16,64}$/.test(token)) return "";
  return "<!--analytics--><script defer src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon='{\"token\": \"" + token + "\"}'></script><!--/analytics-->";
}

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
    '</div><p class="foot-copy">&copy; ' + new Date().getFullYear() + " " + esc(content.site_name) + "</p></footer>" + analyticsHtml(content);
}

/**
 * The "next step" block at the end of a post, the About page and a shop listing: points the reader to the request
 * form. Wrapped in markers so a build can replace it. `heading` varies by page.
 */
export function requestCtaHtml(heading) {
  return '<!--cta--><aside class="next-step" aria-label="Request a restoration"><p class="next-kicker">Restorations</p>' +
    "<h2>" + esc(heading || "Have something that needs restoring?") + "</h2>" +
    "<p>Send the details of your unit and I will get back to you about what it needs.</p>" +
    '<a class="next-btn" href="' + pageUrl("request.html") + '">Request a Restoration</a></aside><!--/cta-->';
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

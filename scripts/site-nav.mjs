// The site's top navigation, shared by scripts/update-nav.mjs (static pages),
// scripts/shop-render.mjs and publisher/worker.js (generated pages).
// Pure string code: no file-system or runtime APIs.

const BLOG = [
  { key: "stereo", href: "stereo/index.html", label: "Stereo Repair" },
  { key: "radio", href: "radio/index.html", label: "Radio Repair" },
  { key: "test-equipment", href: "test-equipment/index.html", label: "Test Equipment" }
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * @param {string} active  one of: home, shop, request, stereo, radio, test-equipment, about (or "")
 * @param {string} prefix  "" for pages in the site root, "../" for pages one folder down
 */
export function navHtml(active, prefix) {
  const p = prefix || "";
  const link = (key, href, label) =>
    '<a href="' + p + href + '"' + (active === key ? ' class="on" aria-current="page"' : "") + ">" + esc(label) + "</a>";
  const blogActive = BLOG.some((b) => b.key === active);
  const menu = BLOG.map((b) => link(b.key, b.href, b.label)).join("");
  return "<nav>" +
    link("home", "index.html", "Home") +
    link("shop", "shop/index.html", "Shop") +
    link("request", "request.html", "Request a Restoration") +
    '<div class="dd"><button class="dd-toggle' + (blogActive ? " on" : "") + '" type="button" aria-haspopup="true" aria-expanded="false">Restoration Blog</button>' +
    '<div class="dd-menu">' + menu + "</div></div>" +
    link("about", "about.html", "About Me") +
    '<button class="theme" type="button" id="th">Theme</button></nav>';
}

export const NAV_SCRIPT = (prefix) => '<script src="' + (prefix || "") + 'nav.js" defer></script>';

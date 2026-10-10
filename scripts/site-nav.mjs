// The site's top navigation, built from content.nav_items. Shared by
// scripts/build-site.mjs, scripts/shop-render.mjs and publisher/worker.js.
// Pure string code: no file-system or runtime APIs.

import { DEFAULT_NAV } from "./site-content.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const external = (h) => /^(https?:|mailto:)/i.test(h);

/**
 * @param {Array}  items   content.nav_items
 * @param {string} active  site-relative path of the current page's nav entry, e.g. "stereo/index.html" ("" for none)
 * @param {string} prefix  "" for pages in the site root, "../" for pages one folder down
 */
export function navHtml(items, active, prefix) {
  const p = prefix || "";
  const list = Array.isArray(items) && items.length ? items : DEFAULT_NAV;
  const url = (h) => (external(h) ? h : p + h);
  const link = (item, menu) => {
    const here = !external(item.href) && item.href.split("#")[0] === active;
    return '<a href="' + esc(url(item.href)) + '"' + (here ? ' class="on" aria-current="page"' : "") + (external(item.href) && !/^mailto:/i.test(item.href) ? ' rel="noopener"' : "") + ">" + esc(item.label) + "</a>";
  };
  const parts = list.map((item) => {
    if (Array.isArray(item.children) && item.children.length) {
      const hereChild = item.children.some((c) => !external(c.href) && c.href.split("#")[0] === active);
      return '<div class="dd"><button class="dd-toggle' + (hereChild ? " on" : "") + '" type="button" aria-haspopup="true" aria-expanded="false">' + esc(item.label) + "</button>" +
        '<div class="dd-menu">' + item.children.map((c) => link(c, true)).join("") + "</div></div>";
    }
    return link(item, false);
  });
  return "<nav>" + parts.join("") + "</nav>";
}

export const NAV_SCRIPT = (prefix) => '<script src="' + (prefix || "") + 'nav.js" defer></script>';

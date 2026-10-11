// How the site refers to its own pages and files. Everything is root-absolute, so a page
// can be generated or moved without working out how many "../" it needs.
//
//   pages  : clean addresses  ("shop/index.html" -> "/shop/", "about.html" -> "/about")
//   assets : "/assets/css/style.css", "/assets/js/<name>.js", and "/images/..." for pictures
//
// Pure string code shared by the build scripts and publisher/worker.js.

export const CSS_URL = "/assets/css/style.css";

/** The site icon, in the <head> of every page (the files are written by build/make-icons.mjs). */
export const FAVICON_LINKS = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
  '<link rel="icon" href="/favicon.ico" sizes="32x32">' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
export const jsUrl = (name) => "/assets/js/" + name;

const external = (h) => /^(https?:|mailto:|data:|blob:)/i.test(h);

/** A stored site-relative page path ("shop/index.html#top") as the address visitors use. */
export function pageUrl(href) {
  const value = String(href ?? "");
  if (external(value) || value.startsWith("/") || value.startsWith("#")) return value;
  const hash = value.indexOf("#");
  const path = hash >= 0 ? value.slice(0, hash) : value;
  const frag = hash >= 0 ? value.slice(hash) : "";
  let clean = path.replace(/^(\.\/)+/, "");
  if (clean === "" || clean === "index.html") clean = "";
  else if (clean.endsWith("/index.html")) clean = clean.slice(0, -"index.html".length);
  else if (clean.endsWith(".html")) clean = clean.slice(0, -".html".length);
  return "/" + clean + frag;
}

/** A stored image/file path ("images/shop/a.jpg") as a root-absolute address; external and data URLs pass through. */
export function assetUrl(path) {
  const value = String(path ?? "");
  if (external(value) || value.startsWith("/")) return value;
  return "/" + value.replace(/^(\.\.?\/)+/, "");
}

/**
 * Brings pages written before the move to absolute addresses up to date (relative stylesheet,
 * scripts and pictures, and the home link). Safe to run repeatedly.
 */
export function absolutizeAssets(html) {
  return html
    .replace(/\b(href|src)="(?:\.\.\/)*style\.css"/g, (m, attr) => attr + '="' + CSS_URL + '"')
    .replace(/\bsrc="(?:\.\.\/)*(nav|lightbox|hero|forsale|reveal|request)\.js"/g, (m, name) => 'src="' + jsUrl(name + ".js") + '"')
    .replace(/\b(href|src)="(?:\.\.\/)+images\//g, (m, attr) => attr + '="/images/')
    .replace(/(<a class="brand"[^>]*\bhref=")[^"]*(")/, (m, a, b) => a + "/" + b);
}

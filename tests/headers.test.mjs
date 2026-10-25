// site/_headers: rules are well-formed. Caching: pictures must always be revalidated (never "immutable" or
// long-lived: a picture requested just before it finishes deploying must not get stuck), pages and data stay on the
// default re-check, and the stylesheet and scripts are revalidated every time too. Security: every response gets the
// protective headers and a strict content security policy; the admin swaps in its own, still limited, policy.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "./_root.mjs";

const SITE = ROOT + "site/";
const text = fs.readFileSync(SITE + "_headers", "utf8");

// parse: a line starting with "/" opens a rule; indented "Name: value" lines belong to it, and "! Name" drops a
// header that a broader rule set (Cloudflare's syntax)
const rules = [];
for (const raw of text.split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  if (/^\//.test(raw)) { rules.push({ pattern: raw.trim(), headers: {}, drops: [] }); continue; }
  const drop = raw.match(/^\s+!\s+([A-Za-z-]+)$/);
  if (drop && rules.length) { rules.at(-1).drops.push(drop[1]); continue; }
  const m = raw.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  assert.ok(m && rules.length, "unparseable line: " + raw);
  rules.at(-1).headers[m[1]] = m[2].trim();
}
const toRegex = (p) => new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");

/** The headers a path is served with: every matching rule in order, "! Name" removing what came before. */
function headersFor(file) {
  const out = {};
  for (const r of rules) {
    if (!toRegex(r.pattern).test(file)) continue;
    r.drops.forEach((name) => { delete out[name]; });
    Object.assign(out, r.headers);
  }
  return out;
}

// 1. shape
{
  assert.ok(rules.length > 0 && rules.length <= 100, "Cloudflare allows up to 100 rules");
  for (const r of rules) {
    assert.ok(Object.keys(r.headers).length, r.pattern + " has headers");
    assert.ok(r.pattern.length <= 2000);
  }
  console.log("ok 1: " + rules.length + " rules, well-formed");
}

// 2. caching: matching and policy
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(SITE).map((f) => "/" + path.relative(SITE, f).split(path.sep).join("/"));
  const matched = new Map();
  // caching rules never overlap (the security headers apply to everything, so they are left out of this check)
  for (const file of files) {
    const hits = rules.filter((r) => "Cache-Control" in r.headers && toRegex(r.pattern).test(file));
    assert.ok(hits.length <= 1, file + " matches several caching rules: " + hits.map((h) => h.pattern).join(", "));
    matched.set(file, hits[0] || null);
  }

  // no rule makes anything immutable or long-lived: the longest allowed age is ten minutes
  for (const r of rules) {
    const value = r.headers["Cache-Control"] || "";
    assert.ok(!/immutable/i.test(value), r.pattern + " must not be immutable");
    const age = value.match(/max-age=(\d+)/i);
    assert.ok(!age || Number(age[1]) <= 600, r.pattern + " must not be cached for more than ten minutes");
  }

  // every picture is revalidated
  const pictures = files.filter((f) => /\.(jpe?g|png|webp|gif|svg|ico)$/i.test(f) && f.startsWith("/images/"));
  assert.ok(pictures.length > 0);
  for (const file of pictures) {
    const rule = matched.get(file);
    assert.ok(rule && /no-cache/.test(rule.headers["Cache-Control"] || ""), file + " must be sent with no-cache");
  }

  // the stylesheet and scripts are revalidated as well: a page and its stylesheet must never come from different
  // versions of the site (a cached old stylesheet left newly added parts of a page unstyled)
  const assets = files.filter((f) => f.startsWith("/assets/"));
  assert.ok(assets.some((f) => f.endsWith("style.css")));
  for (const file of assets) {
    const rule = matched.get(file);
    assert.ok(rule && /no-cache/.test(rule.headers["Cache-Control"] || "") && !/max-age/.test(rule.headers["Cache-Control"]), file + " must be sent with no-cache");
  }

  // pages and data keep the default re-check
  for (const [file, rule] of matched) {
    if (file.endsWith(".html") || file.endsWith(".json") || file.endsWith(".txt") || file.endsWith(".xml")) {
      assert.equal(rule, null, file + " must keep the default (revalidate) caching");
    }
  }
  console.log("ok 2: pictures revalidate, nothing long-lived (" + pictures.length + " pictures, " + files.length + " files checked)");
}

// 3. security headers on every response; the admin's own policy
{
  const directives = (csp) => Object.fromEntries(String(csp || "").split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1)]));
  for (const file of ["/", "/index.html", "/request", "/shop/zenith-6d221", "/stereo/888", "/images/banner.jpg", "/assets/css/style.css", "/admin/", "/admin/admin.js"]) {
    const h = headersFor(file);
    assert.equal(h["X-Content-Type-Options"], "nosniff", file);
    assert.equal(h["X-Frame-Options"], "DENY", file);
    assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin", file);
    const csp = directives(h["Content-Security-Policy"]);
    assert.deepEqual(csp["frame-ancestors"], ["'none'"], file + ": never shown inside another site's frame");
    assert.deepEqual(csp["object-src"], ["'none'"], file);
    assert.deepEqual(csp["base-uri"], ["'self'"], file);
    assert.ok(!(csp["script-src"] || []).includes("'unsafe-inline'"), file + ": no inline scripts allowed");
  }
  // public pages: scripts only from the site, the form only to Formspree, no eval
  const pub = directives(headersFor("/stereo/888")["Content-Security-Policy"]);
  // scripts: the site's own, plus Cloudflare's statistics beacon (only loaded when a token is set)
  assert.deepEqual(pub["script-src"], ["'self'", "https://static.cloudflareinsights.com"]);
  assert.deepEqual(pub["form-action"], ["'self'", "https://formspree.io"]);
  assert.deepEqual(pub["connect-src"], ["'self'", "https://formspree.io", "https://cloudflareinsights.com"], "the form service and the statistics endpoint only");
  assert.ok(!headersFor("/about")["Content-Security-Policy"].includes("unsafe-eval"), "only the admin allows eval (for the HEIC decoder)");
  // the admin replaces that policy (one policy, not two combined): its scripts come from the site and jsDelivr only,
  // and it may talk to the publisher Worker named in its own page
  const adminCsp = headersFor("/admin/")["Content-Security-Policy"];
  const admin = directives(adminCsp);
  assert.ok(!/,\s*default-src/.test(adminCsp), "the site-wide policy is dropped, not stacked");
  assert.deepEqual(admin["script-src"].filter((s) => !s.startsWith("'")), ["https://cdn.jsdelivr.net"]);
  const publisher = fs.readFileSync(SITE + "admin/index.html", "utf8").match(/name="publisher-api-url" content="([^"]+)"/)[1].replace(/\/+$/, "");
  assert.ok(admin["connect-src"].includes(publisher), "the admin may reach its publisher: " + publisher);
  console.log("ok 3: security headers everywhere; the admin has its own policy");
}

// 4. the admin's HEIC converter is loaded with an integrity hash, so a changed CDN copy is refused
{
  const heic = fs.readFileSync(SITE + "admin/heic.js", "utf8");
  const url = heic.match(/var CONVERTER = "([^"]+)"/)[1];
  assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/heic-to@\d+\.\d+\.\d+\//, "an exact version, from the CDN the policy allows");
  assert.match(heic, /var CONVERTER_INTEGRITY = "sha384-[A-Za-z0-9+/]{64}";/);
  assert.match(heic, /script\.integrity = CONVERTER_INTEGRITY;/);
  assert.match(heic, /script\.crossOrigin = "anonymous";/);
  console.log("ok 4: HEIC converter pinned by integrity hash");
}

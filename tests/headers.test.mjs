// site/_headers: caching rules are well-formed and don't overlap. Pictures must always be revalidated
// (never "immutable" or long-lived: a picture requested just before it finishes deploying must not get stuck),
// pages and data stay on the default re-check, and only the stylesheet and scripts are cached briefly.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "./_root.mjs";

const SITE = ROOT + "site/";
const text = fs.readFileSync(SITE + "_headers", "utf8");

// parse: a line starting with "/" opens a rule; indented "Name: value" lines belong to it
const rules = [];
for (const raw of text.split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  if (/^\//.test(raw)) { rules.push({ pattern: raw.trim(), headers: {} }); continue; }
  const m = raw.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  assert.ok(m && rules.length, "unparseable line: " + raw);
  rules.at(-1).headers[m[1]] = m[2].trim();
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

// 2. matching and policy
{
  const toRegex = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(SITE).map((f) => "/" + path.relative(SITE, f).split(path.sep).join("/"));
  const matched = new Map();
  for (const file of files) {
    const hits = rules.filter((r) => toRegex(r.pattern).test(file));
    assert.ok(hits.length <= 1, file + " matches several rules: " + hits.map((h) => h.pattern).join(", "));
    matched.set(file, hits[0] || null);
  }

  // no rule makes anything immutable or long-lived apart from nothing: the longest allowed age is ten minutes
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

  // pages and data keep the default re-check
  for (const [file, rule] of matched) {
    if (file.endsWith(".html") || file.endsWith(".json") || file.endsWith(".txt") || file.endsWith(".xml")) {
      assert.equal(rule, null, file + " must keep the default (revalidate) caching");
    }
  }
  console.log("ok 2: pictures revalidate, nothing long-lived (" + pictures.length + " pictures, " + files.length + " files checked)");
}

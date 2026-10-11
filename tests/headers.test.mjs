// site/_headers: caching rules are well-formed, don't overlap, and only mark pictures
// "immutable" where the file names really are unique.
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

// 2. matching: a file belongs to at most one rule (same-named headers from several rules would be joined)
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
  // pages are never given a long cache
  for (const [file, rule] of matched) {
    if (file.endsWith(".html") || file.endsWith(".json") || file.endsWith(".txt") || file.endsWith(".xml")) {
      assert.equal(rule, null, file + " must keep the default (revalidate) caching");
    }
  }
  // the rules actually cover what they say they do
  const covered = (p) => files.some((f) => toRegex(p).test(f));
  assert.ok(covered("/assets/*") && covered("/images/site/*") && covered("/images/shop/*"), "rules match real files");

  // 3. immutable only where every file name is unique (random id), so an address never changes content
  const UNIQUE = /-[a-z0-9]{4,10}-[a-z0-9]{4}\.(jpg|png|webp)$/;
  for (const [file, rule] of matched) {
    if (rule && /immutable/.test(rule.headers["Cache-Control"] || "")) {
      assert.match(file, UNIQUE, file + " is under an immutable rule but its name is not unique");
    }
  }
  console.log("ok 2: no overlaps, pages untouched, immutable only for uniquely named pictures (" + files.length + " files checked)");
}

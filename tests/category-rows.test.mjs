import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { renderHome } from "../scripts/site-render.mjs";
import { normalizeContent } from "../scripts/site-content.mjs";
const css = fs.readFileSync(ROOT + "site/assets/css/style.css", "utf8");

const c = normalizeContent({ homepage: { categories: [
  { label: "Stereo Repair", image: "", description: "Custom words", cta_label: "Go", href: "stereo/index.html" },
  { label: "Radio Repair", href: "radio/index.html", image: "images/site/category-x-1234.jpg", description: "", cta_label: "" },
  { label: "Test Equipment", href: "javascript:alert(1)", image: "https://evil.example/a.svg" }
] } });
assert.equal(c.homepage.categories[0].image, "", "explicit empty image is kept");
assert.equal(c.homepage.categories[0].cta_label, "Go");
assert.equal(c.homepage.categories[1].description, "", "cleared description stays cleared");
assert.equal(c.homepage.categories[1].cta_label, "See the work", "blank label falls back");
assert.equal(c.homepage.categories[2].href, "test-equipment/index.html", "unsafe link replaced");
assert.equal(c.homepage.categories[2].image, "images/category-test-equipment.jpg", "unsafe image replaced");
const html = renderHome(c);
const rows = html.split('<section class="cat-row').slice(1);
assert.equal(rows.length, 3);
assert.ok(rows[0].startsWith(' no-image"') && !rows[0].includes("cat-media"), "no image: text only");
assert.ok(!rows[1].includes("<p>"), "empty description omitted");
assert.ok(rows[1].includes('class="cat-media"'));
assert.ok(!html.includes("See the work &rarr;") && !html.includes('class="cat"'), "old grid and arrow links gone");
assert.ok(html.indexOf('class="cats"') > html.indexOf("</main>"));

const must = [
  ["row min height", /\.cat-row\{[^}]*min-height:70vh/],
  ["flex stretch", /\.cat-row\{[^}]*display:flex[^}]*align-items:stretch/],
  ["overflow hidden", /\.cat-row\{position:relative;overflow:hidden/],
  ["text 45 / image 55", /\.cat-media\{[^}]*flex:0 0 55%/],
  ["text width", /\.cat-text\{flex:0 0 45%[^}]*padding:48px/],
  ["heading", /\.cat-copy h2\{[^}]*font-size:30px;font-weight:400;letter-spacing:3\.5px;text-transform:uppercase/],
  ["description", /\.cat-copy p\{[^}]*max-width:420px;[^}]*line-height:1\.7;color:rgba\(255,255,255,\.6\)/],
  ["cta", /\.cat-cta\{[^}]*margin-top:28px;padding:12px 28px;border-radius:3px;background:#333/],
  ["square images", /\.cat-media img\{[^}]*object-fit:cover;border-radius:0/],
  ["tablet stacked image 50vh", /@media\(max-width:1024px\)\{[^]*flex-direction:column[^]*height:50vh/],
  ["mobile image 40vh and 24px", /@media\(max-width:599px\)\{\s*\.cat-media\{height:40vh\}\s*\.cat-text\{padding:24px\}/],
  ["alternation", /\.cat-row\{[^}]*flex-direction:row-reverse[^}]*\}\s*\.cat-row:nth-child\(even\)\{flex-direction:row\}/]
];
must.forEach(([n, re]) => assert.match(css, re, n));
console.log("ok: category rows (content, markup, fallback, styles)");

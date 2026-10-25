// The site footer on every public page, and the shop listing pages: navigation bar, large photo with thumbnails.
import { ROOT, ROOT_URL } from "./_root.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const { footerHtml, applyFooter } = await import(ROOT_URL + "shared/site-footer.mjs");
const { normalizeContent } = await import(ROOT_URL + "shared/site-content.mjs");
const { renderShop } = await import(ROOT_URL + "shared/shop-render.mjs");
const content = normalizeContent({ site_name: "Test Labs", contact_email: "hi@example.com" });

// ---- 1. footer markup: brand, a column of pages, one column per dropdown, contact and the request button ---------
{
  const d = new JSDOM(footerHtml(content)).window.document;
  const foot = d.querySelector("footer.site-foot");
  assert.equal(foot.querySelector(".foot-brand .brand").textContent, "Test Labs");
  const columns = Array.from(foot.querySelectorAll(".foot-col h2")).map((h) => h.textContent);
  assert.deepEqual(columns, ["Site", "Restoration Blog", "Contact"]);
  assert.deepEqual(Array.from(foot.querySelectorAll(".foot-col")[0].querySelectorAll("a")).map((a) => a.getAttribute("href")), ["/", "/shop/", "/request", "/about"]);
  assert.ok(foot.querySelector('.foot-contact a[href="mailto:hi@example.com"]'));
  assert.equal(foot.querySelector(".foot-cta").getAttribute("href"), "/request");
  assert.ok(!foot.querySelector("nav"), "no <nav> inside: the header's navigation styles and scripts target nav");
  assert.match(foot.querySelector(".foot-copy").textContent, new RegExp("© " + new Date().getFullYear() + " Test Labs"));
  console.log("ok 1: footer markup");
}

// ---- 2. applying it: after </main>, replaced in place on later builds -------------------------------------------
{
  const page = "<html><body><header></header><main>x</main><script src=\"/a.js\"></script></body></html>";
  const once = applyFooter(page, content);
  assert.ok(once.indexOf("</main><footer") > 0 && once.indexOf("</footer><script") > 0, "between the content and the scripts");
  const renamed = applyFooter(once, normalizeContent({ site_name: "Renamed" }));
  assert.equal((renamed.match(/<footer class="site-foot">/g) || []).length, 1, "replaced, not added twice");
  assert.ok(renamed.includes(">Renamed</a>"));
  assert.equal(applyFooter(once, content), once, "stable");
  assert.ok(applyFooter("<body><p>no main</p></body>", content).includes("</footer></body>"));
  console.log("ok 2: footer is applied once and kept current");
}

// ---- 3. the built site: every public page has exactly one footer, the admin has none ----------------------------
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".html") ? [path.join(dir, e.name)] : []);
  const site = path.join(ROOT, "site");
  for (const file of walk(site)) {
    const rel = path.relative(site, file).split(path.sep).join("/");
    const count = (fs.readFileSync(file, "utf8").match(/<footer class="site-foot">/g) || []).length;
    assert.equal(count, rel.startsWith("admin/") ? 0 : 1, rel);
  }
  console.log("ok 3: every built page has the footer");
}

// ---- 4. shop listing pages: navigation bar, one large photo and its thumbnails, details right after --------------
const data = {
  shop: { title: "Shop", email: "hi@example.com" },
  items: [
    { slug: "radio", title: "Radio", price: 500, images: ["images/shop/a.jpg", "images/shop/b.jpg", "images/shop/c.jpg"], description: ["Restored."] },
    { slug: "part", title: "Part", price: 2, images: ["images/shop/p.jpg"] }
  ]
};
const files = renderShop(data, { content });
{
  const index = files["index.html"];
  assert.ok(index.indexOf('class="forsale shop-list"') < index.indexOf('<footer class="site-foot">'), "the shop's listings come before the footer");
  const d = new JSDOM(files["radio.html"]).window.document;
  assert.equal(d.body.className, "navbar", "the continuous navigation bar, like blog posts");
  const gallery = d.querySelector(".shop-gallery");
  assert.equal(gallery.querySelectorAll(".shop-photo").length, 1, "one large photo");
  assert.equal(gallery.querySelector(".shop-photo").getAttribute("src"), "/images/shop/a.jpg");
  const thumbs = Array.from(gallery.querySelectorAll(".shop-thumbs a.shop-thumb"));
  assert.deepEqual(thumbs.map((t) => t.getAttribute("href")), ["/images/shop/a.jpg", "/images/shop/b.jpg", "/images/shop/c.jpg"], "each thumbnail links to its photo");
  assert.ok(thumbs[0].classList.contains("on") && thumbs[0].getAttribute("aria-current") === "true");
  assert.ok(gallery.nextElementSibling.classList.contains("shop-info"), "title, price and button follow the gallery");
  const single = new JSDOM(files["part.html"]).window.document;
  assert.ok(!single.querySelector(".shop-thumbs"), "no thumbnails for a single photo");
  const css = fs.readFileSync(ROOT + "site/assets/css/style.css", "utf8");
  assert.match(css, /\.shop-thumb\.on\{[^}]*outline-color:var\(--accent\)/);
  console.log("ok 4: listing pages use the bar and a large photo with thumbnails");
}

// ---- 5. thumbnails swap the large photo; the enlarged view steps through every photo ----------------------------
{
  const dom = new JSDOM(files["radio.html"].replace(/<script[^>]*><\/script>/g, ""), { url: "https://site.example/shop/radio", runScripts: "outside-only" });
  const w = dom.window, d = w.document;
  w.eval(fs.readFileSync(ROOT + "site/assets/js/lightbox.js", "utf8"));
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const main = d.querySelector(".shop-photo");
  const thumbs = d.querySelectorAll(".shop-thumb");
  const ev = new w.MouseEvent("click", { bubbles: true, cancelable: true });
  thumbs[2].querySelector("img").dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, "the link is not followed");
  assert.equal(new URL(main.src).pathname, "/images/shop/c.jpg");
  assert.ok(thumbs[2].classList.contains("on") && !thumbs[0].classList.contains("on") && !thumbs[0].hasAttribute("aria-current"));
  assert.equal(d.querySelector(".lightbox"), null, "a thumbnail does not open the enlarged view");
  click(main);
  const shown = () => new URL(d.querySelector(".lightbox img").src).pathname;
  assert.equal(shown(), "/images/shop/c.jpg", "opens on the photo shown");
  click(d.querySelector(".lb-next"));
  assert.equal(shown(), "/images/shop/a.jpg", "steps through all of the listing's photos");
  console.log("ok 5: thumbnails swap the photo and the enlarged view steps through them");
}

// ---- 6. the "next step" block: after a post (built pages), on the About page and on a listing -------------------
{
  const { requestCtaHtml } = await import(ROOT_URL + "shared/site-footer.mjs");
  const block = new JSDOM(requestCtaHtml("Heading here")).window.document.querySelector("aside.next-step");
  assert.equal(block.querySelector("h2").textContent, "Heading here");
  assert.equal(block.querySelector("a.next-btn").getAttribute("href"), "/request");
  const page = (rel) => fs.readFileSync(path.join(ROOT, "site", rel), "utf8");
  const once = (html) => (html.match(/<!--cta-->/g) || []).length;
  // every built post page has it once, after the older/newer links and before the footer
  for (const folder of ["stereo", "radio", "test-equipment"]) {
    for (const name of fs.readdirSync(path.join(ROOT, "site", folder)).filter((n) => n.endsWith(".html") && n !== "index.html")) {
      const html = page(folder + "/" + name);
      assert.equal(once(html), 1, folder + "/" + name);
      assert.ok(html.indexOf("<!--/pager-->") < html.indexOf("<!--cta-->") && html.indexOf("<!--/cta-->") < html.indexOf('<footer class="site-foot">'), folder + "/" + name + ": after the pager");
    }
  }
  const about = page("about.html");
  assert.equal(once(about), 1);
  assert.ok(about.indexOf("about-cards") < about.indexOf("<!--cta-->") && about.indexOf("<!--/cta-->") < about.indexOf('class="about-contact"'), "About: between the cards and the contact line");
  const listing = files["radio.html"];
  assert.equal(once(listing), 1);
  assert.ok(listing.indexOf("</article>") < listing.indexOf("<!--cta-->"), "listing: after the item");
  assert.ok(!files["index.html"].includes("<!--cta-->"), "not on the shop's own page");
  console.log("ok 6: the request block ends posts, the About page and listings");
}

// ---- 7. the Request page intro: paragraphs, with a "Note:" one highlighted ----------------------------------------
{
  const { renderRequest } = await import(ROOT_URL + "shared/site-render.mjs");
  const html = renderRequest(normalizeContent({ request: { intro: "First paragraph.\n\nNote: I do not work on cassette decks." } }));
  const d = new JSDOM(html).window.document;
  const ps = Array.from(d.querySelectorAll(".request-wrap .intro p"));
  assert.deepEqual(ps.map((p) => p.className), ["", "intro-note"]);
  assert.equal(ps[1].textContent, "Note: I do not work on cassette decks.");
  console.log("ok 7: request intro note highlighted");
}

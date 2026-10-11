// Photo galleries in posts: the editor tool, both sanitisers, the grid styles and lightbox stepping.
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ROOT, FIXTURES } from "./_root.mjs";

const read = (p) => fs.readFileSync(ROOT + p, "utf8");
const css = read("site/assets/css/style.css");
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ---- 1. editor: choose photos, get one grid ------------------------------------------------------
{
  let html = read("site/admin/index.html");
  const scripts = ["admin.js", "shop-builder.js", "post-builder.js"];
  for (const s of scripts) html = html.replace('<script src="/admin/' + s + '"></script>', "");
  const seed = JSON.parse(fs.readFileSync(FIXTURES + "/site-content.json", "utf8"));
  const items = JSON.parse(fs.readFileSync(FIXTURES + "/items.json", "utf8"));
  const dom = new JSDOM(html, { url: "https://site.example/admin/#ticket=T", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
  w.fetch = async (url) => {
    const p = new URL(url).pathname;
    const ok = (v) => ({ ok: true, status: 200, json: async () => v });
    if (p === "/api/session") return ok({ session: "S" });
    if (p === "/api/me") return ok({ role: "administrator" });
    if (p === "/api/content") return ok({ content: structuredClone(seed), contentSha: "a".repeat(40), shop: { title: "Shop", intro: "" }, shopSha: "b".repeat(40) });
    if (p === "/api/shop") return ok({ sha: "c".repeat(40), data: structuredClone(items) });
    return ok({});
  };
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/AAAA";
  w.Image = function () {
    const o = { naturalWidth: 1200, naturalHeight: 800 };
    let src = "";
    Object.defineProperty(o, "src", { get: () => src, set: (v) => { src = v; setTimeout(() => o.onload && o.onload(), 0); } });
    return o;
  };
  for (const s of scripts) w.eval(read("site/admin/" + s));
  await tick(80);
  const $ = (id) => w.document.getElementById(id);
  const inserted = [];
  w.document.execCommand = (cmd, _ui, value) => { if (cmd === "insertHTML") { inserted.push(value); $("post-content").insertAdjacentHTML("beforeend", value); } return true; };
  w.HeicSupport = {
    detect: async (f) => f.name.toLowerCase().endsWith(".heic"),
    prepare: async (f) => (f.name.toLowerCase().endsWith(".heic") ? new w.File(["jpegbytes"], f.name.replace(/\.heic$/i, ".jpg"), { type: "image/jpeg" }) : f)
  };
  const choose = async (files) => {
    const input = $("gallery-files");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await tick(150);
  };
  const png = (name) => new w.File([new Uint8Array(1000)], name, { type: "image/png" });

  assert.ok($("add-gallery") && $("gallery-layout") && $("gallery-files").multiple, "toolbar has the gallery tool");
  assert.deepEqual(Array.from($("gallery-layout").options).map((o) => o.value), ["2", "4"]);

  // three photos, two per row (a HEIC among them)
  await choose([png("a.png"), new w.File(["h"], "b.heic", { type: "image/heic" }), png("c.png")]);
  let figure = $("post-content").querySelector("figure[data-gallery]");
  assert.ok(figure, "a gallery figure was inserted");
  assert.equal(figure.getAttribute("data-gallery"), "2");
  assert.equal(figure.querySelectorAll("img").length, 3);
  assert.ok(Array.from(figure.querySelectorAll("img")).every((i) => i.getAttribute("src").startsWith("data:image/")), "photos are embedded");
  assert.ok(inserted[0].endsWith("</figure><p><br></p>"), "a paragraph follows so typing can continue");

  // four across, and more than four photos: only the first four are used
  $("gallery-layout").value = "4";
  await choose([png("1.png"), png("2.png"), png("3.png"), png("4.png"), png("5.png")]);
  const figures = $("post-content").querySelectorAll("figure[data-gallery]");
  assert.equal(figures.length, 2);
  assert.equal(figures[1].getAttribute("data-gallery"), "4");
  assert.equal(figures[1].querySelectorAll("img").length, 4);
  assert.match($("pb-status").textContent, /up to 4 photos/);

  // non-images are skipped, and nothing is inserted when no file is usable
  const before = inserted.length;
  await choose([new w.File(["x"], "notes.txt", { type: "text/plain" })]);
  assert.equal(inserted.length, before, "no gallery for unusable files");
  assert.match($("pb-status").textContent, /skipped|PNG, JPEG/);

  // a gallery photo disables width/alignment; removing the last photo removes the figure
  const first = figures[0].querySelector("img");
  first.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.equal($("image-width").disabled, false, "width is live for a gallery photo");
  assert.equal($("image-align").disabled, false, "alignment is live for a gallery photo");
  assert.match($("image-tools-title").textContent, /whole gallery/);
  $("image-width").value = "50"; $("image-width").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("image-align").value = "r"; $("image-align").dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal(figures[0].dataset.w, "50", "width is set on the gallery");
  assert.equal(figures[0].dataset.a, "r", "alignment is set on the gallery");
  assert.equal(first.dataset.w, undefined, "the photo itself is untouched");
  // selecting another photo of the same gallery shows the gallery's settings
  figures[0].querySelectorAll("img")[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.equal($("image-width").value, "50");
  assert.equal($("image-align").value, "r");
  const loneFigure = w.document.createElement("figure");
  loneFigure.setAttribute("data-gallery", "2");
  loneFigure.innerHTML = '<img src="data:image/png;base64,AAAA" alt="">';
  $("post-content").appendChild(loneFigure);
  loneFigure.querySelector("img").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  $("remove-image").click();
  assert.ok(!loneFigure.isConnected, "the emptied gallery is removed");
  const single = w.document.createElement("p");
  single.innerHTML = '<img src="data:image/png;base64,BBBB" alt="" data-w="50" data-a="l">';
  $("post-content").appendChild(single);
  single.querySelector("img").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.equal($("image-width").disabled, false, "single photos keep their size controls");
  assert.match($("image-tools-title").textContent, /^Selected image$/, "no gallery wording for a single photo");

  // the gallery survives publishing (the page sanitiser keeps the layout, drops anything unknown)
  const calls = [];
  const realFetch = w.fetch;
  w.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === "/api/publish") { calls.push(JSON.parse(init.body)); return { ok: true, status: 201, json: async () => ({ filename: "p.html", section: "stereo" }) }; }
    return realFetch(url, init);
  };
  $("post-title").value = "Gallery post"; $("post-summary").value = "S";
  $("post-content").innerHTML = '<p>Sized</p><figure data-gallery="2" data-w="50" data-a="l"><img src="data:image/png;base64,SSSS" alt=""></figure>' +
    '<figure data-gallery="4" data-w="33" data-a="x"><img src="data:image/png;base64,TTTT" alt=""></figure>';
  $("pb-publish").click(); await tick(150);
  const sized = calls.at(-1).content;
  assert.ok(sized.includes('<figure data-gallery="2" data-w="50" data-a="l">'), sized);
  assert.ok(sized.includes('<figure data-gallery="4"><img') && !/data-w="33"|data-a="x"/.test(sized), "unknown size and alignment are dropped");
  $("post-content").innerHTML = '<p>Condition</p><figure data-gallery="2" onclick="x()" class="y"><img src="data:image/png;base64,AAAA" alt="front"><img src="data:image/png;base64,BBBB" alt=""></figure>' +
    '<figure data-gallery="9"><img src="data:image/png;base64,CCCC"></figure>';
  $("pb-publish").click(); await tick(150);
  const content = calls.at(-1).content;
  assert.ok(content.includes('<figure data-gallery="2"><img src="data:image/png;base64,AAAA" alt="front"><img src="data:image/png;base64,BBBB" alt=""></figure>'), content);
  assert.ok(!content.includes('data-gallery="9"') && !/onclick|class=/.test(content), "unknown layout and handlers are dropped");
  console.log("ok 1: gallery tool, limits, sanitising and image controls");
}

// ---- 2. the Worker keeps the layout attribute and nothing else on figures -------------------------------
{
  const sanitize = read("publisher/src/sanitize.js");
  assert.ok(/tagName === "FIGURE" && name === "data-gallery" && \["2", "4"\]\.includes\(value\)/.test(sanitize));
  console.log("ok 2: Worker sanitiser allows data-gallery 2 and 4 only");
}

// ---- 3. styles ------------------------------------------------------------------------------------------
{
  const must = [
    ["grid", /figure\[data-gallery\]\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:\.5rem/],
    ["four across", /figure\[data-gallery="4"\]\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/],
    ["equal cells, square corners, zoom cursor", /figure\[data-gallery\] img\{width:100%;aspect-ratio:4\/3;object-fit:cover;border-radius:0;[^}]*cursor:zoom-in\}/],
    ["odd photo spans the row", /figure\[data-gallery="2"\] img:last-child:nth-child\(odd\)\{grid-column:1\/-1/],
    ["four across becomes two on phones", /@media\(max-width:600px\)\{\s*figure\[data-gallery="4"\]\{grid-template-columns:repeat\(2,/],
    ["lightbox arrows", /\.lightbox \.lb-nav\{/]
  ];
  must.forEach(([n, re]) => assert.match(css, re, n));
  console.log("ok 3: gallery styles");
}

// ---- 4. lightbox: single photos as before, gallery photos can be stepped through -------------------------
{
  const page = '<!doctype html><body><article class="post"><div class="body">' +
    '<p><img id="solo" src="/solo.jpg" alt="solo"></p>' +
    '<figure data-gallery="2"><img id="g1" src="/g1.jpg" alt="one"><img id="g2" src="/g2.jpg" alt="two"><img id="g3" src="/g3.jpg" alt="three"></figure>' +
    "</div></article></body>";
  const dom = new JSDOM(page, { url: "https://site.example/stereo/post", runScripts: "outside-only" });
  const w = dom.window;
  w.eval(read("site/assets/js/lightbox.js"));
  const d = w.document;
  const shown = () => new URL(d.querySelector(".lightbox img").src).pathname;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  click(d.getElementById("solo"));
  assert.equal(shown(), "/solo.jpg");
  assert.equal(d.querySelectorAll(".lb-nav").length, 0, "no arrows for a single photo");
  click(d.querySelector(".lightbox")); assert.equal(d.querySelector(".lightbox"), null, "click closes");

  click(d.getElementById("g2"));
  assert.equal(shown(), "/g2.jpg");
  assert.equal(d.querySelectorAll(".lb-nav").length, 2, "arrows for a gallery");
  click(d.querySelector(".lb-next")); assert.equal(shown(), "/g3.jpg");
  assert.ok(d.querySelector(".lightbox"), "arrows do not close it");
  click(d.querySelector(".lb-next")); assert.equal(shown(), "/g1.jpg", "wraps around");
  click(d.querySelector(".lb-prev")); assert.equal(shown(), "/g3.jpg");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); assert.equal(shown(), "/g2.jpg");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); assert.equal(shown(), "/g3.jpg");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(d.querySelector(".lightbox"), null, "Escape closes");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));   // no error once closed
  console.log("ok 4: lightbox steps through gallery photos");
}

// ---- 5. a second gallery or a single photo never lands inside an earlier gallery --------------------------
{
  let html = read("site/admin/index.html");
  const scripts = ["admin.js", "shop-builder.js", "post-builder.js"];
  for (const s of scripts) html = html.replace('<script src="/admin/' + s + '"></script>', "");
  const seed = JSON.parse(fs.readFileSync(FIXTURES + "/site-content.json", "utf8"));
  const items = JSON.parse(fs.readFileSync(FIXTURES + "/items.json", "utf8"));
  const dom = new JSDOM(html, { url: "https://site.example/admin/#ticket=T", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const published = [];
  w.confirm = () => true;
  w.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname;
    const ok = (v, status = 200) => ({ ok: true, status, json: async () => v });
    if (p === "/api/session") return ok({ session: "S" });
    if (p === "/api/me") return ok({ role: "administrator" });
    if (p === "/api/content") return ok({ content: structuredClone(seed), contentSha: "a".repeat(40), shop: { title: "Shop", intro: "" }, shopSha: "b".repeat(40) });
    if (p === "/api/shop") return ok({ sha: "c".repeat(40), data: structuredClone(items) });
    if (p === "/api/publish") { published.push(JSON.parse(init.body)); return ok({ filename: "p.html", section: "stereo" }, 201); }
    return ok({});
  };
  w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/AAAA";
  w.Image = function () {
    const o = { naturalWidth: 1200, naturalHeight: 800 };
    let src = "";
    Object.defineProperty(o, "src", { get: () => src, set: (v) => { src = v; setTimeout(() => o.onload && o.onload(), 0); } });
    return o;
  };
  for (const s of scripts) w.eval(read("site/admin/" + s));
  await tick(80);
  const $ = (id) => w.document.getElementById(id);
  const editor = $("post-content");
  // insertHTML at the real selection, like the browser does (falls back to the end)
  w.document.execCommand = (cmd, _ui, value) => {
    if (cmd !== "insertHTML") return true;
    const sel = w.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (range && editor.contains(range.commonAncestorContainer)) range.insertNode(range.createContextualFragment(value));
    else editor.insertAdjacentHTML("beforeend", value);
    return true;
  };
  const png = (n) => new w.File([new Uint8Array(500)], n, { type: "image/png" });
  const chooseGallery = async (files) => {
    const input = $("gallery-files");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await tick(150);
  };
  const chooseImage = async (file) => {
    const input = $("image-file");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await tick(150);
  };
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  editor.innerHTML = "<p>Overview</p>";
  await chooseGallery([png("a.png"), png("b.png")]);
  let galleries = editor.querySelectorAll("figure[data-gallery]");
  assert.equal(galleries.length, 1);

  // select a photo of the first gallery, then insert a second gallery
  click(galleries[0].querySelector("img"));
  await chooseGallery([png("c.png"), png("d.png"), png("e.png")]);
  galleries = editor.querySelectorAll("figure[data-gallery]");
  assert.equal(galleries.length, 2, "two galleries");
  assert.equal(editor.querySelectorAll("figure[data-gallery] figure").length, 0, "no gallery inside another");
  assert.ok(Array.from(galleries).every((g) => g.parentNode === editor), "both are top-level");
  assert.equal(galleries[0].querySelectorAll("img").length, 2, "the first gallery kept its two photos");
  assert.equal(galleries[1].querySelectorAll("img").length, 3);
  assert.ok(Array.from(galleries[0].children).every((c) => c.tagName === "IMG"), "only photos inside the first grid");

  // select a gallery photo, then add one single photo: it goes after the gallery, with working controls
  click(galleries[0].querySelector("img"));
  assert.equal($("image-width").disabled, false, "a gallery's width control works");
  await chooseImage(png("single.png"));
  const single = Array.from(editor.querySelectorAll("img")).find((i) => !i.closest("figure[data-gallery]"));
  assert.ok(single, "the single photo is outside every gallery");
  click(single);
  assert.equal($("image-width").disabled, false, "width control is live for a single photo");
  assert.equal($("image-align").disabled, false, "alignment control is live for a single photo");
  $("image-width").value = "50"; $("image-width").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("image-align").value = "l"; $("image-align").dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal(single.dataset.w, "50");
  assert.equal(single.dataset.a, "l");
  console.log("ok 5: galleries and single photos stay out of earlier galleries; width/align work");

  // ---- 6. a post that already has a mis-built gallery is tidied when it is published ------------------
  $("post-title").value = "Tidy"; $("post-summary").value = "S";
  editor.innerHTML = '<figure data-gallery="2"><img src="data:image/png;base64,AAAA" alt=""><img src="data:image/png;base64,BBBB" alt="">' +
    '<figure data-gallery="2"><img src="data:image/png;base64,CCCC" alt=""><img src="data:image/png;base64,DDDD" alt=""></figure><p>stray</p></figure>';
  $("pb-publish").click(); await tick(200);
  const out = published.at(-1).content;
  const check = new JSDOM("<body>" + out + "</body>").window.document;
  const figs = Array.from(check.body.querySelectorAll("figure[data-gallery]"));
  assert.equal(figs.length, 2, out);
  assert.ok(figs.every((f) => f.parentNode === check.body), "galleries are siblings, not nested");
  assert.ok(figs.every((f) => Array.from(f.children).every((c) => c.tagName === "IMG")), "photos only inside the grids");
  assert.ok(out.includes("<p>stray</p>"), "stray content is kept, outside the grid");
  console.log("ok 6: mis-built galleries are tidied on publish");
}

// ---- 7. styles: a stray cell never shrinks into one grid cell ---------------------------------------------
{
  assert.match(css, /figure\[data-gallery\] > :not\(img\)\{grid-column:1\/-1;margin:0\}/);
  assert.match(css, /figure\[data-gallery\] figure\[data-gallery\]\{margin:0\}/);
  assert.match(css, /figure\[data-gallery\]\[data-w="50"\]\{width:50%\}/);
  assert.match(css, /figure\[data-gallery\]\[data-a="l"\]\{float:left;/);
  assert.match(css, /figure\[data-gallery\]\[data-a="r"\]\{float:right;/);
  assert.match(css, /figure\[data-gallery\]\[data-a="c"\]\{margin-left:auto;margin-right:auto\}/);
  assert.match(css, /\.bar select\{width:auto;/, "image tools: selects are compact, not full width");
  assert.match(css, /\.bar label\{display:inline;/);
  console.log("ok 7: stray content spans the full row; gallery size and alignment styles");
}

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
  assert.equal($("image-width").disabled, true);
  assert.equal($("image-align").disabled, true);
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

  // the gallery survives publishing (the page sanitiser keeps the layout, drops anything unknown)
  const calls = [];
  const realFetch = w.fetch;
  w.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === "/api/publish") { calls.push(JSON.parse(init.body)); return { ok: true, status: 201, json: async () => ({ filename: "p.html", section: "stereo" }) }; }
    return realFetch(url, init);
  };
  $("post-title").value = "Gallery post"; $("post-summary").value = "S";
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

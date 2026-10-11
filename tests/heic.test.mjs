import { ROOT, ROOT_URL, FIXTURES } from "./_root.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const R = ROOT + "";
const heicJs = fs.readFileSync(R + "site/admin/heic.js", "utf8");
const html = fs.readFileSync(R + "site/admin/index.html", "utf8");

// 0. every image field accepts HEIC, and the helper loads before the builders
{
  const d = new JSDOM(html).window.document;
  const files = Array.from(d.querySelectorAll('input[type="file"]')).filter((i) => /image/.test(i.accept));
  assert.ok(files.length >= 3);
  files.forEach((i) => assert.ok(/\.heic/.test(i.accept) && /image\/heic/.test(i.accept), i.id + " accepts HEIC"));
  const order = Array.from(d.querySelectorAll("script[src]")).map((s) => s.getAttribute("src").split("/").pop());
  assert.ok(order.indexOf("heic.js") >= 0 && order.indexOf("heic.js") < order.indexOf("admin.js"));
  assert.equal(fs.readFileSync(R + "site/admin/admin.js", "utf8").split("image/heic").length, 3, "both dynamic pickers accept HEIC");
  console.log("ok 0: all image fields accept HEIC");
}

// no hidden caps in the helper itself: no file-size or pixel limits
{
  assert.ok(!/MAX_SIDE|maxBytes|size\s*>\s*\d|\.size\s*[<>]/.test(heicJs.replace(/\(file\.size \|\| 0\) < 16/, "")), "no size limits in heic.js");
  console.log("ok: heic.js has no size or resolution limit of its own");
}

/** A page where the converter script "downloads" and a stand-in decoder runs. */
function boot({ convert, loadFails = false, nativeOk = false, dims = { w: 4000, h: 3000 } } = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://site.example/", runScripts: "outside-only" });
  const w = dom.window;
  const appended = [];
  w.document.head.appendChild = (node) => {
    appended.push(node.src);
    setTimeout(() => {
      if (loadFails) node.onerror && node.onerror();
      else { w.HeicTo = convert; node.onload && node.onload(); }
    }, 0);
    return node;
  };
  w.URL.createObjectURL = (b) => "blob:" + (b.__tag || "x"); w.URL.revokeObjectURL = () => {};
  // Image: the "native" decoder succeeds only for blobs that say so
  w.Image = function () {
    const o = {};
    Object.defineProperty(o, "src", {
      set(v) {
        setTimeout(() => {
          if (v === "blob:native" && nativeOk) { o.naturalWidth = dims.w; o.naturalHeight = dims.h; o.onload && o.onload(); }
          else if (v === "blob:converted") { o.naturalWidth = dims.w; o.naturalHeight = dims.h; o.onload && o.onload(); }
          else o.onerror && o.onerror();
        }, 0);
      }
    });
    return o;
  };
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {} });
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { const b = new w.Blob(["scaled-" + this.width + "x" + this.height], { type: "image/jpeg" }); cb(b); };
  w.eval(heicJs);
  return { w, appended };
}
const heicBytes = (w, name, type) => {
  const head = new Uint8Array(32);
  head.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);   // ....ftypheic
  return new w.File([head, "payload"], name, { type });
};

// 1. non-HEIC files pass straight through and never load the converter
{
  const { w, appended } = boot({ convert: async () => { throw new Error("must not run"); } });
  const jpeg = new w.File([new Uint8Array(64).fill(0xff), "x"], "a.jpg", { type: "image/jpeg" });
  assert.equal(await w.HeicSupport.prepare(jpeg), jpeg);
  assert.equal(appended.length, 0);
  assert.equal(w.HeicSupport.isHeic(jpeg), false);
  console.log("ok 1: JPEG untouched, converter not downloaded");
}

// 2. HEIC (type, extension, or no type at all) becomes a JPEG at full resolution; the converter loads once
{
  let calls = 0;
  const { w, appended } = boot({ convert: async ({ blob, type, quality }) => { calls++; assert.equal(type, "image/jpeg"); assert.ok(quality > 0.8); const b = new w.Blob(["jpegdata"], { type: "image/jpeg" }); b.__tag = "converted"; return b; } });
  const a = await w.HeicSupport.prepare(heicBytes(w, "IMG_0001.HEIC", "image/heic"));
  assert.equal(a.type, "image/jpeg");
  assert.equal(a.name, "IMG_0001.jpg");
  const b = await w.HeicSupport.prepare(heicBytes(w, "photo.heif", ""));          // Windows gives no type
  assert.equal(b.name, "photo.jpg");
  assert.equal(calls, 2);
  assert.equal(appended.length, 1, "converter downloaded once");
  assert.match(appended[0], /^https:\/\/cdn\.jsdelivr\.net\/npm\/heic-to@1\.6\.5\//);
  // full resolution is kept: nothing is scaled unless a maxSide is asked for
  console.log("ok 2: HEIC converted to JPEG, converter loaded once, full resolution kept");
}

// 3. a HEIC with a wrong name/type (".jpg") is recognised from its bytes
{
  const { w, appended } = boot({ convert: async () => new w.Blob(["ok"], { type: "image/jpeg" }) });
  const sneaky = heicBytes(w, "IMG_2231.JPG", "image/jpeg");
  assert.equal(w.HeicSupport.isHeic(sneaky), false);
  assert.equal(await w.HeicSupport.detect(sneaky), true);
  const out = await w.HeicSupport.prepare(sneaky);
  assert.equal(out.name, "IMG_2231.jpg");
  assert.equal(appended.length, 1);
  console.log("ok 3: HEIC disguised as .jpg is detected by content");
}

// 4. maxSide scales the converted photo down; smaller photos are left alone
{
  const mk = (dims) => {
    const env = boot({ dims, convert: async () => { const b = new env.w.Blob(["jpegdata"], { type: "image/jpeg" }); b.__tag = "converted"; return b; } });
    return env;
  };
  const large = mk({ w: 8000, h: 6000 });
  const scaled = await large.w.HeicSupport.prepare(heicBytes(large.w, "huge.heic", "image/heic"), { maxSide: 2400 });
  assert.equal(await new Promise((r) => { const fr = new large.w.FileReader(); fr.onload = () => r(fr.result); fr.readAsText(scaled); }), "scaled-2400x1800");
  const small = mk({ w: 1200, h: 900 });
  const same = await small.w.HeicSupport.prepare(heicBytes(small.w, "small.heic", "image/heic"), { maxSide: 2400 });
  assert.equal(await new Promise((r) => { const fr = new small.w.FileReader(); fr.onload = () => r(fr.result); fr.readAsText(same); }), "jpegdata");
  console.log("ok 4: optional maxSide scales down only when needed");
}

// 5. the browser's own decoder is used first when it can read HEIC
{
  const env = boot({ nativeOk: true, convert: async () => { throw new Error("converter must not be needed"); } });
  const f = heicBytes(env.w, "native.heic", "image/heic");
  const origCreate = env.w.URL.createObjectURL;
  env.w.URL.createObjectURL = (b) => (b === f ? "blob:native" : origCreate(b));
  const out = await env.w.HeicSupport.prepare(f);
  assert.equal(out.type, "image/jpeg");
  assert.equal(env.appended.length, 0, "no download when the browser can decode it");
  console.log("ok 5: native decoder preferred");
}

// 6. failures give a readable message
{
  const { w } = boot({ convert: async () => { throw { code: 100, message: "ERR_LIBHEIF format not supported" }; } });
  await assert.rejects(() => w.HeicSupport.prepare(heicBytes(w, "bad.heic", "image/heic")), /could not be converted from HEIC \(ERR_LIBHEIF format not supported\)/);
  const offline = boot({ loadFails: true });
  await assert.rejects(() => offline.w.HeicSupport.prepare(heicBytes(offline.w, "x.heic", "image/heic")), /could not be downloaded/);
  console.log("ok 6: conversion and download failures are reported with the reason");
}

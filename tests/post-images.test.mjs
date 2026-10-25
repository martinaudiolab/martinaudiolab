// Post photos are files of their own, not embedded in the page: the shared extractor, and the build's conversion
// of posts published before (run on a copy of the site).
import { ROOT, ROOT_URL } from "./_root.mjs";
import { builtSite } from "./_built-site.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { extractPostImages, lazyImages, postImageDir, postBodyHtml } = await import(ROOT_URL + "shared/site-posts.mjs");

// ---- 1. the extractor -------------------------------------------------------------------------------------------
{
  const html = '<p>x</p><img src="data:image/jpeg;base64,AAAA" alt="a"><img alt="b" src="data:image/png;base64,BBBB">' +
    '<img src="data:image/jpeg;base64,AAAA" alt="again"><img src="/images/posts/already.jpg" alt="">';
  const out = extractPostImages(html, "radio", "my-post");
  assert.equal(postImageDir("radio", "my-post"), "images/posts/radio/my-post/");
  assert.deepEqual(out.files, [{ path: "images/posts/radio/my-post/1.jpg", data: "AAAA" }, { path: "images/posts/radio/my-post/2.png", data: "BBBB" }], "one file per photo, the extension from its type");
  assert.ok(out.html.includes('<img src="/images/posts/radio/my-post/1.jpg" alt="a">') && out.html.includes('<img alt="b" src="/images/posts/radio/my-post/2.png">'));
  assert.equal((out.html.match(/my-post\/1\.jpg/g) || []).length, 2, "the same photo used twice is stored once");
  assert.ok(out.html.includes('src="/images/posts/already.jpg"') && !out.html.includes("data:"), "file addresses are left alone");
  assert.deepEqual(extractPostImages(out.html, "radio", "my-post").files, [], "nothing left to move");
  assert.equal(lazyImages('<img src="a"><img loading="eager" src="b">'), '<img loading="lazy" decoding="async" src="a"><img loading="eager" src="b">');
  console.log("ok 1: photos are moved into files, once each");
}

// ---- 2. the build converts an old post with embedded photos, and a second build changes nothing ---------------------
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mal-postimg-"));
  try {
    for (const dir of ["site", "build", "shared", "site-data", "shop-data"]) fs.cpSync(path.join(ROOT, dir), path.join(work, dir), { recursive: true });
    const index = fs.readFileSync(path.join(work, "site/stereo/index.html"), "utf8");
    const listed = index.match(/<h2><a href="([a-z0-9-]+)\.html"/)[1];
    const file = path.join(work, "site/stereo", listed + ".html");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
    const page = fs.readFileSync(file, "utf8");
    const body = postBodyHtml(page);
    fs.writeFileSync(file, page.replace(body, () => '<p>Old post</p><img src="data:image/jpeg;base64,' + jpeg + '" alt="bench">'));

    execFileSync(process.execPath, [path.join(work, "build/build-site.mjs")], { cwd: work });
    const built = fs.readFileSync(file, "utf8");
    const photo = path.join(work, "site", postImageDir("stereo", listed), "1.jpg");
    assert.ok(!built.includes("data:image"), "no embedded photo left");
    assert.ok(built.includes('<img loading="lazy" decoding="async" src="/' + postImageDir("stereo", listed) + '1.jpg" alt="bench">'));
    assert.deepEqual(fs.readFileSync(photo), Buffer.from(jpeg, "base64"), "the photo is written as a file");

    execFileSync(process.execPath, [path.join(work, "build/build-site.mjs")], { cwd: work });
    assert.equal(fs.readFileSync(file, "utf8"), built, "a second build leaves the page as it is");
    console.log("ok 2: the build converts old posts once");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---- 3. the site as deployed: no post page carries embedded photos -------------------------------------------------
{
  for (const folder of ["stereo", "radio", "test-equipment"]) {
    for (const name of fs.readdirSync(path.join(builtSite(), folder))) {
      if (name.endsWith(".html")) assert.ok(!fs.readFileSync(path.join(builtSite(), folder, name), "utf8").includes('src="data:image'), folder + "/" + name);
    }
  }
  console.log("ok 3: no post page embeds its photos");
}

// ---- 4. blank lines the editor leaves at the end of a post are dropped ---------------------------------------------
{
  const { trimTrailingBlank } = await import(ROOT_URL + "shared/site-posts.mjs");
  assert.equal(trimTrailingBlank('<p>Text</p><figure>x</figure><p><br></p><br>\n<p>&nbsp;</p>'), "<p>Text</p><figure>x</figure>");
  assert.equal(trimTrailingBlank("<p>A</p><br><p>B</p>"), "<p>A</p><br><p>B</p>", "blank lines between paragraphs stay");
  for (const folder of ["stereo", "radio", "test-equipment"]) {
    for (const name of fs.readdirSync(path.join(builtSite(), folder)).filter((n) => n.endsWith(".html") && n !== "index.html")) {
      const body = postBodyHtml(fs.readFileSync(path.join(builtSite(), folder, name), "utf8"));
      assert.equal(body, trimTrailingBlank(body), folder + "/" + name + " ends without blank lines");
    }
  }
  console.log("ok 4: posts end without trailing blank lines");
}

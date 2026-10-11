// The shop: read the listing data, and publish edits (data file, generated pages, photos).

import { normalizeShop, renderShop, validateShop } from "../../shared/shop-render.mjs";
import { HttpError } from "./errors.js";
import {
  addBlobEntry, commitEntries, decodeBase64Utf8, getBranchHead, getFile, listRepositoryPaths,
  readBranch, repoBase, writeBranch
} from "./github.js";
import { SHOP_DATA_PATH, loadShopFile, loadSiteContent } from "./repo.js";
import { validateUploads } from "./uploads.js";

const SHOP_UPLOAD_PATH = /^images\/shop\/[a-z0-9][a-z0-9._-]{0,100}\.(jpg|png|webp)$/;
const SHOP_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SHOP_REQUEST = 30_000_000;
const MAX_SHOP_IMAGE = 4_000_000;

/** GET /api/shop: the data file and its version. */
export async function getShopData(token, env) {
  return loadShopFile(token, repoBase(env), readBranch(env));
}

export async function publishShop(request, env, session, body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid shop data.");
  const baseSha = typeof body.baseSha === "string" ? body.baseSha : "";
  if (!/^[0-9a-f]{40,64}$/i.test(baseSha)) throw new HttpError(400, "The shop data version is missing. Reload the page and try again.");

  const shopData = normalizeShop(body.data);
  const check = validateShop(shopData);
  if (check.errors.length) throw new HttpError(400, check.errors.slice(0, 5).join(" "));

  const uploads = Array.isArray(body.images) ? body.images : [];
  const uploadedPaths = validateUploads(uploads, {
    pattern: SHOP_UPLOAD_PATH, maxBytes: MAX_SHOP_IMAGE, maxCount: 80,
    tooMany: "Too many new images in one publish.", sizeLabel: "4 MB"
  });

  const branch = writeBranch(env);
  const apiBase = repoBase(env);
  const token = session.accessToken;
  const head = await getBranchHead(token, apiBase, branch);
  const tip = head.reference.object.sha;

  const current = await getFile(token, apiBase, SHOP_DATA_PATH, tip);
  if (current.sha !== baseSha) {
    throw new HttpError(409, "The shop was changed somewhere else after this page loaded. Reload the page and apply your edits again.");
  }
  let previous = { items: [] };
  try { previous = JSON.parse(decodeBase64Utf8(current.content)); } catch (error) { }
  const previousItems = Array.isArray(previous.items) ? previous.items : [];

  const existing = await listRepositoryPaths(token, apiBase, head, "The repository is too large to publish the shop automatically.");

  // Every local image an item uses must be uploaded now or already in the repo.
  const used = new Set();
  shopData.items.forEach(function (item) {
    item.images.forEach(function (path) {
      if (/^https?:/.test(path)) return;
      const local = path.replace(/^\//, "");
      used.add(local);
      if (!uploadedPaths.has(local) && !existing.has("site/" + local)) {
        throw new HttpError(400, "\"" + item.title + "\" uses an image that is not in the repository: " + local);
      }
    });
  });
  uploadedPaths.forEach(function (path) {
    if (!used.has(path)) throw new HttpError(400, "Uploaded image is not used by any item: " + path);
  });

  const entries = [];
  for (const upload of uploads) {
    await addBlobEntry(token, apiBase, entries, "site/" + upload.path, { content: upload.data, encoding: "base64" });
  }
  await addBlobEntry(token, apiBase, entries, SHOP_DATA_PATH, { content: JSON.stringify(shopData, null, 2) + "\n", encoding: "utf-8" });
  const siteContent = (await loadSiteContent(token, apiBase, tip)).content;
  const pages = renderShop(shopData, { content: siteContent });
  for (const name of Object.keys(pages)) {
    await addBlobEntry(token, apiBase, entries, "site/shop/" + name, { content: pages[name], encoding: "utf-8" });
  }

  // Remove pages and uploaded photos that belonged to items that are gone now.
  const newSlugs = new Set(shopData.items.map(function (item) { return item.slug; }));
  let removed = 0;
  previousItems.forEach(function (item) {
    if (!item || typeof item.slug !== "string" || newSlugs.has(item.slug) || !SHOP_SLUG.test(item.slug)) return;
    removed += 1;
    const pagePath = "site/shop/" + item.slug + ".html";
    if (existing.has(pagePath)) entries.push({ path: pagePath, mode: "100644", type: "blob", sha: null });
  });
  const deletedImages = new Set();
  previousItems.forEach(function (item) {
    ((item && Array.isArray(item.images)) ? item.images : []).forEach(function (path) {
      if (typeof path !== "string" || used.has(path) || deletedImages.has(path)) return;
      if (!SHOP_UPLOAD_PATH.test(path) || !existing.has("site/" + path)) return;
      deletedImages.add(path);
      entries.push({ path: "site/" + path, mode: "100644", type: "blob", sha: null });
    });
  });

  const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const commit = await commitEntries(token, apiBase, branch, head, entries, "Update shop listings" + (note ? ": " + note : ""));
  const updated = await getFile(token, apiBase, SHOP_DATA_PATH, commit.sha);
  return { commit: commit.sha, sha: updated.sha, items: shopData.items.length, removed: removed, uploaded: uploads.length, data: shopData };
}

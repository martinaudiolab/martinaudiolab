// The site content edited in the admin panel: read it, and save it (JSON, generated pages, pictures).

import { contentImages, normalizeContent } from "../../shared/site-content.mjs";
import { normalizeShop, renderShop } from "../../shared/shop-render.mjs";
import { renderAbout, renderHome, renderRequest } from "../../shared/site-render.mjs";
import { HttpError } from "./errors.js";
import {
  addBlobEntry, commitEntries, getBranchHead, getFile, listRepositoryPaths,
  readBranch, repoBase, writeBranch
} from "./github.js";
import { CONTENT_PATH, SHOP_DATA_PATH, loadShopFile, loadSiteContent } from "./repo.js";
import { validateUploads } from "./uploads.js";

const SITE_UPLOAD_PATH = /^images\/site\/[a-z0-9][a-z0-9._-]{0,100}\.(jpg|png|webp)$/;
export const MAX_CONTENT_REQUEST = 12_000_000;
const MAX_SITE_IMAGE = 3_500_000;

/** GET /api/content: the site content, the shop title/intro, and the file versions. */
export async function getAdminContent(token, env) {
  const branch = readBranch(env);
  const apiBase = repoBase(env);
  const site = await loadSiteContent(token, apiBase, branch);
  const shop = await loadShopFile(token, apiBase, branch);
  const shopBlock = shop.data && shop.data.shop ? shop.data.shop : {};
  return {
    content: site.content,
    contentSha: site.sha,
    shop: { title: String(shopBlock.title || "Shop"), intro: String(shopBlock.intro || "") },
    shopSha: shop.sha
  };
}

export async function publishContent(request, env, session, body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid content.");
  const contentSha = typeof body.contentSha === "string" ? body.contentSha : "";
  const shopSha = typeof body.shopSha === "string" ? body.shopSha : "";
  if (contentSha && !/^[0-9a-f]{40,64}$/i.test(contentSha)) throw new HttpError(400, "The content version is invalid. Reload the page and try again.");
  if (!/^[0-9a-f]{40,64}$/i.test(shopSha)) throw new HttpError(400, "The shop version is missing. Reload the page and try again.");

  const content = normalizeContent(body.content);
  const shopIn = body.shop && typeof body.shop === "object" ? body.shop : {};
  const shopTitle = typeof shopIn.title === "string" && shopIn.title.trim() ? shopIn.title.trim().slice(0, 80) : "Shop";
  const shopIntro = typeof shopIn.intro === "string" ? shopIn.intro.replace(/\r\n/g, "\n").trim().slice(0, 600) : "";

  const uploads = Array.isArray(body.images) ? body.images : [];
  const uploadedPaths = validateUploads(uploads, {
    pattern: SITE_UPLOAD_PATH, maxBytes: MAX_SITE_IMAGE, maxCount: 12,
    tooMany: "Too many new images in one save.", sizeLabel: "3.5 MB"
  });

  const branch = writeBranch(env);
  const apiBase = repoBase(env);
  const token = session.accessToken;
  const head = await getBranchHead(token, apiBase, branch);
  const tip = head.reference.object.sha;

  const currentSite = await loadSiteContent(token, apiBase, tip);
  const currentShop = await loadShopFile(token, apiBase, tip);
  if (currentSite.sha !== contentSha || currentShop.sha !== shopSha) {
    throw new HttpError(409, "The site content was changed somewhere else after this page loaded. Reload the page and apply your edits again.");
  }

  const existing = await listRepositoryPaths(token, apiBase, head, "The repository is too large to save the site content automatically.");

  const used = new Set(contentImages(content));
  used.forEach(function (path) {
    if (!uploadedPaths.has(path) && !existing.has("site/" + path)) {
      throw new HttpError(400, "An image used on the homepage is not in the repository: " + path);
    }
  });
  uploadedPaths.forEach(function (path) {
    if (!used.has(path)) throw new HttpError(400, "Uploaded image is not used anywhere: " + path);
  });

  const entries = [];
  const add = function (path, text) { return addBlobEntry(token, apiBase, entries, path, { content: text, encoding: "utf-8" }); };

  for (const upload of uploads) await addBlobEntry(token, apiBase, entries, "site/" + upload.path, { content: upload.data, encoding: "base64" });
  await add(CONTENT_PATH, JSON.stringify(content, null, 2) + "\n");

  // The shop title and introduction live in the shop data, so there is one source for them.
  const shopData = currentShop.data && typeof currentShop.data === "object" ? currentShop.data : { items: [] };
  shopData.shop = Object.assign({}, shopData.shop || {}, { title: shopTitle, intro: shopIntro });
  await add(SHOP_DATA_PATH, JSON.stringify(shopData, null, 2) + "\n");

  const pages = renderShop(normalizeShop(shopData), { content: content });
  for (const name of Object.keys(pages)) await add("site/shop/" + name, pages[name]);
  await add("site/index.html", renderHome(content));
  await add("site/request.html", renderRequest(content));
  await add("site/about.html", renderAbout(content));

  // Remove site images that the previous content used and the new content does not.
  contentImages(currentSite.content).forEach(function (path) {
    if (used.has(path) || !SITE_UPLOAD_PATH.test(path) || !existing.has("site/" + path)) return;
    entries.push({ path: "site/" + path, mode: "100644", type: "blob", sha: null });
  });

  const commit = await commitEntries(token, apiBase, branch, head, entries, "Update site content");
  const updatedSite = await getFile(token, apiBase, CONTENT_PATH, commit.sha);
  const updatedShop = await getFile(token, apiBase, SHOP_DATA_PATH, commit.sha);
  return {
    commit: commit.sha, contentSha: updatedSite.sha, shopSha: updatedShop.sha,
    content: content, shop: { title: shopTitle, intro: shopIntro }, uploaded: uploads.length
  };
}

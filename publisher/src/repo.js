// The two JSON data files the admin edits, as stored in the repository.

import { CONTENT_PATH, normalizeContent } from "../../shared/site-content.mjs";
import { HttpError } from "./errors.js";
import { decodeBase64Utf8, getFile } from "./github.js";

export { CONTENT_PATH };
export const SHOP_DATA_PATH = "shop-data/items.json";

/** The site content at `ref`, normalized; a missing or unreadable file gives the defaults. */
export async function loadSiteContent(token, apiBase, ref) {
  try {
    const file = await getFile(token, apiBase, CONTENT_PATH, ref);
    return { content: normalizeContent(JSON.parse(decodeBase64Utf8(file.content))), sha: file.sha, exists: true };
  } catch (error) {
    if (error.status === 404 || error instanceof SyntaxError) return { content: normalizeContent({}), sha: "", exists: false };
    throw error;
  }
}

/** The shop data file at `ref`: { sha, data }. */
export async function loadShopFile(token, apiBase, ref) {
  const file = await getFile(token, apiBase, SHOP_DATA_PATH, ref);
  let data;
  try { data = JSON.parse(decodeBase64Utf8(file.content)); }
  catch (error) { throw new HttpError(409, "shop-data/items.json on GitHub is not valid JSON."); }
  return { sha: file.sha, data: data };
}

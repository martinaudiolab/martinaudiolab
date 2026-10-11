// Blog posts: publish a post (page, section listing, optional thumbnail), list a section, delete a post.

import { NAV_SCRIPT, navHtml } from "../../shared/site-nav.mjs";
import { SECTIONS } from "../../shared/sections.mjs";
import { crumbsHtml, fallbackThumb, heroFigure, listingWithThumb, thumbFile } from "../../shared/site-posts.mjs";
import { HttpError } from "./errors.js";
import {
  addBlobEntry, commitEntries, decodeBase64Utf8, getBranchHead, getFile,
  readBranch, repoBase, writeBranch
} from "./github.js";
import { loadSiteContent } from "./repo.js";
import { sanitizeContent } from "./sanitize.js";

// The blog sections come from shared/sections.mjs (key -> { folder, name }).
const CATEGORIES = Object.fromEntries(SECTIONS.map((s) => [s.key, { folder: s.folder, name: s.name }]));

/** Largest accepted /api/publish and /api/delete request bodies (characters). */
export const MAX_POST_REQUEST = 5_500_000;
export const MAX_DELETE_REQUEST = 1_100_000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function slugify(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function dateLabel(value) {
  const date = new Date(value + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC"
  }).format(date);
}

/** The complete HTML page for a published post. */
export function articleHtml(data, category, content, site, heroSrc) {
  const title = escapeHtml(data.title);
  const summary = escapeHtml(data.summary);
  const label = escapeHtml(dateLabel(data.date));
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' + title + ' - ' + escapeHtml(site.site_name) + '</title><meta name="description" content="' + summary + '"><link rel="stylesheet" href="/assets/css/style.css"></head><body class="navbar"><header class="site"><a class="brand" href="/">' + escapeHtml(site.site_name) + '</a>' + navHtml(site.nav_items, category.folder + "/index.html") + '</header><main>' + crumbsHtml(category.name, title, category.folder) + '<article class="post"><h1 class="post-title">' + title + '</h1><div class="meta">' + label + ' &nbsp;|&nbsp; <a href="index.html">' + escapeHtml(category.name) + '</a></div>' + (heroSrc ? heroFigure(heroSrc, data.title) : "") + '<div class="body">' + content + '</div></article></main><script src="/assets/js/lightbox.js" defer><\/script>' + NAV_SCRIPT() + '</body></html>\n';
}

function listingHtml(data, category, folder, hasThumbnail) {
  const slug = escapeHtml(data.slug);
  const src = hasThumbnail ? "/" + thumbFile(folder, data.slug) : fallbackThumb(folder);
  return listingWithThumb(data.slug, src,
    '<h2><a href="' + slug + '.html">' + escapeHtml(data.title) + '</a></h2><div class="meta">' + escapeHtml(dateLabel(data.date)) +
    ' &nbsp;|&nbsp; <a href="index.html">' + escapeHtml(category.name) + '</a></div><div class="body"><p>' + escapeHtml(data.summary) +
    '</p></div><a class="more" href="' + slug + '.html">Read the post</a>');
}

/** Adds the new post's listing right after the section page's intro paragraph. */
async function updateIndex(indexHtml, data, category, hasThumbnail) {
  let heading = "";
  let introCount = 0;
  const output = await new HTMLRewriter()
    .on("main h1", { text: function (text) { heading += text.text; } })
    .on("main .intro", { element: function (element) { introCount += 1; element.after(listingHtml(data, category, category.folder, hasThumbnail), { html: true }); } })
    .transform(new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text();
  if (heading.trim() !== category.name || introCount !== 1) {
    throw new HttpError(409, "The GitHub section index does not match " + category.name + ".");
  }
  return output;
}

export async function publishPost(request, env, session, body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid post data.");
  const category = CATEGORIES[body.category];
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const rawContent = typeof body.content === "string" ? body.content : "";
  if (!category) throw new HttpError(400, "Choose a valid post section.");
  if (!title || title.length > 120) throw new HttpError(400, "Post title must be between 1 and 120 characters.");
  if (!summary || summary.length > 280) throw new HttpError(400, "Post summary must be between 1 and 280 characters.");
  const parsedDate = new Date(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, "Choose a valid publish date.");
  }
  if (!rawContent.trim() || rawContent.length > 5_000_000) throw new HttpError(400, "Post content is empty or exceeds the 5 MB limit.");
  const slug = slugify(title);
  if (!slug) throw new HttpError(400, "Add a title with at least one letter or number.");
  // Optional thumbnail: a JPEG, base64 encoded, made in the browser.
  const thumbnail = typeof body.thumbnail === "string" ? body.thumbnail : "";
  if (thumbnail && (!/^[A-Za-z0-9+\/]+={0,2}$/.test(thumbnail) || !thumbnail.startsWith("/9j/") || thumbnail.length * 0.75 > 900000)) {
    throw new HttpError(400, "The thumbnail must be a JPEG under 900 KB.");
  }

  const branch = writeBranch(env);
  const token = session.accessToken;
  const folder = "site/" + category.folder;
  const filename = slug + ".html";
  const apiBase = repoBase(env);
  const head = await getBranchHead(token, apiBase, branch);
  const tip = head.reference.object.sha;

  try {
    await getFile(token, apiBase, folder + "/" + filename, tip);
    throw new HttpError(409, "A post with this title already exists. Change the title to make a unique filename.");
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const indexPath = folder + "/index.html";
  const indexFile = await getFile(token, apiBase, indexPath, tip);
  const indexOutput = await updateIndex(decodeBase64Utf8(indexFile.content), {
    title: title, summary: summary, date: date, slug: slug
  }, category, Boolean(thumbnail));
  const safeContent = await sanitizeContent(rawContent, env.SITE_ORIGIN);
  const data = { title: title, summary: summary, date: date, slug: slug, category: body.category };
  const site = (await loadSiteContent(token, apiBase, tip)).content;
  const article = articleHtml(data, category, safeContent, site, thumbnail ? "/" + thumbFile(category.folder, slug) : fallbackThumb(category.folder));

  const entries = [];
  await addBlobEntry(token, apiBase, entries, folder + "/" + filename, { content: article, encoding: "utf-8" });
  await addBlobEntry(token, apiBase, entries, indexPath, { content: indexOutput, encoding: "utf-8" });
  if (thumbnail) {
    await addBlobEntry(token, apiBase, entries, "site/" + thumbFile(category.folder, slug), { content: thumbnail, encoding: "base64" });
  }
  const commit = await commitEntries(token, apiBase, branch, head, entries, "Publish " + title);
  return { filename: filename, section: category.folder, commit: commit.sha };
}

/** Checks a section page is the expected one and counts the links to `slug` (used before and after a delete). */
async function inspectSectionIndex(indexHtml, category, slug) {
  let heading = "";
  let introCount = 0;
  let matchingLinks = 0;
  const selector = 'main article.post h2 a[href="' + slug + '.html"]';
  const html = await new HTMLRewriter()
    .on("main h1", { text: function (text) { heading += text.text; } })
    .on("main .intro", { element: function () { introCount += 1; } })
    .on(selector, { element: function () { matchingLinks += 1; } })
    .transform(new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text();
  if (heading.trim() !== category.name || introCount !== 1) {
    throw new HttpError(409, "The GitHub section index does not match " + category.name + ".");
  }
  return { html: html, matchingLinks: matchingLinks };
}

export async function getSectionIndex(token, env, categoryKey) {
  const category = CATEGORIES[categoryKey];
  if (!category) throw new HttpError(400, "Choose a valid post section.");
  const file = await getFile(token, repoBase(env), "site/" + category.folder + "/index.html", readBranch(env));
  return { indexSha: file.sha, indexHtml: decodeBase64Utf8(file.content) };
}

export async function deletePost(request, env, session, body) {
  if (!session.isAdmin) throw new HttpError(403, "Only repository administrators can delete published posts.");
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid delete request.");
  const category = CATEGORIES[body.category];
  const slug = typeof body.slug === "string" ? body.slug : "";
  const indexSha = typeof body.indexSha === "string" ? body.indexSha : "";
  const indexHtml = typeof body.indexHtml === "string" ? body.indexHtml : "";
  if (!category) throw new HttpError(400, "Choose a valid post section.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new HttpError(400, "Invalid post filename.");
  if (!/^[0-9a-f]{40,64}$/i.test(indexSha) || !indexHtml || indexHtml.length > 1_000_000) {
    throw new HttpError(400, "The section index data is missing or invalid. Refresh the post list and try again.");
  }

  const branch = readBranch(env);
  const token = session.accessToken;
  const folder = "site/" + category.folder;
  const indexPath = folder + "/index.html";
  const postPath = folder + "/" + slug + ".html";
  const apiBase = repoBase(env);
  const head = await getBranchHead(token, apiBase, branch);
  const tip = head.reference.object.sha;
  const currentIndex = await getFile(token, apiBase, indexPath, tip);
  if (currentIndex.sha !== indexSha) {
    throw new HttpError(409, "This section changed after the list loaded. Refresh the post list, then try again.");
  }

  const original = await inspectSectionIndex(decodeBase64Utf8(currentIndex.content), category, slug);
  if (original.matchingLinks !== 1) throw new HttpError(404, "That post is not listed in this section.");
  const updatedIndex = await inspectSectionIndex(indexHtml, category, slug);
  if (updatedIndex.matchingLinks !== 0) throw new HttpError(400, "The post link was not removed from the section index.");

  await getFile(token, apiBase, postPath, tip);   // 404 if the page is already gone
  const entries = [];
  await addBlobEntry(token, apiBase, entries, indexPath, { content: updatedIndex.html, encoding: "utf-8" });
  entries.push({ path: postPath, mode: "100644", type: "blob", sha: null });
  // the post's own thumbnail goes too, when it has one
  const thumbPath = "site/" + thumbFile(category.folder, slug);
  try {
    await getFile(token, apiBase, thumbPath, tip);
    entries.push({ path: thumbPath, mode: "100644", type: "blob", sha: null });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const commit = await commitEntries(token, apiBase, branch, head, entries, "Delete " + slug);
  return { filename: slug + ".html", section: category.folder, commit: commit.sha };
}

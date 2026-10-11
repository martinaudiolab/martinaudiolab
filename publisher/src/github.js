// Talking to the GitHub REST API: requests, branches, and the blobs -> tree -> commit -> ref
// sequence every publish uses.

import { HttpError } from "./errors.js";

export async function githubRequest(token, path, options) {
  const request = Object.assign({}, options || {});
  request.headers = Object.assign({
    Accept: "application/vnd.github+json",
    "User-Agent": "MartinAudioLabsPostBuilder/1.0",
    "X-GitHub-Api-Version": "2022-11-28"
  }, request.headers || {});
  if (token) request.headers.Authorization = "Bearer " + token;
  if (request.body && typeof request.body !== "string") {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(request.body);
  }
  const response = await fetch("https://api.github.com" + path, request);
  const responseText = await response.text();
  let result = {};
  try { result = responseText ? JSON.parse(responseText) : {}; }
  catch (error) { result = {}; }
  if (!response.ok) {
    const detail = String(result.message || responseText || "No response body.").replace(/\s+/g, " ").slice(0, 150);
    const acceptedPermissions = response.headers.get("X-Accepted-GitHub-Permissions");
    const requestId = response.headers.get("X-GitHub-Request-Id");
    const diagnostics = [
      acceptedPermissions ? "Accepted permissions: " + acceptedPermissions : "",
      requestId ? "GitHub request: " + requestId : ""
    ].filter(Boolean).join("; ");
    throw new HttpError(response.status, "GitHub HTTP " + response.status + ": " + detail + (diagnostics ? " (" + diagnostics + ")" : ""));
  }
  if (!responseText) return {};
  return result;
}

export function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
  return new TextDecoder("utf-8").decode(bytes);
}

/** "/repos/<owner>/<repository>" for the configured repository. */
export function repoBase(env) {
  return "/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPOSITORY;
}

/** The branch to read from. */
export function readBranch(env) {
  return env.GITHUB_BRANCH || "main";
}

/** The branch to write to; test mode (non-admin publishing) must never target main. */
export function writeBranch(env) {
  const branch = readBranch(env);
  if (env.ALLOW_NON_ADMIN_PUBLISHING === "true" && branch === "main") {
    throw new HttpError(503, "Non-admin test mode must use a branch other than main.");
  }
  return branch;
}

/** A file's metadata and base64 content at `ref` (a branch name or commit sha). */
export function getFile(token, apiBase, path, ref) {
  return githubRequest(token, apiBase + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(ref));
}

/** The branch tip and its commit: the starting point for a change. */
export async function getBranchHead(token, apiBase, branch) {
  const reference = await githubRequest(token, apiBase + "/git/ref/heads/" + encodeURIComponent(branch));
  const parent = await githubRequest(token, apiBase + "/git/commits/" + reference.object.sha);
  return { reference: reference, parent: parent };
}

/** Uploads one blob and appends its tree entry to `entries`. */
export async function addBlobEntry(token, apiBase, entries, path, payload) {
  const blob = await githubRequest(token, apiBase + "/git/blobs", { method: "POST", body: payload });
  entries.push({ path: path, mode: "100644", type: "blob", sha: blob.sha });
}

/** Commits `entries` on top of `head` and moves the branch to the new commit. Returns the commit. */
export async function commitEntries(token, apiBase, branch, head, entries, message) {
  const tree = await githubRequest(token, apiBase + "/git/trees", {
    method: "POST", body: { base_tree: head.parent.tree.sha, tree: entries }
  });
  const commit = await githubRequest(token, apiBase + "/git/commits", {
    method: "POST", body: { message: message, tree: tree.sha, parents: [head.reference.object.sha] }
  });
  await githubRequest(token, apiBase + "/git/refs/heads/" + encodeURIComponent(branch), {
    method: "PATCH", body: { sha: commit.sha, force: false }
  });
  return commit;
}

/** Every path in the repository at the branch tip's tree (used to check images exist and to clean up). */
export async function listRepositoryPaths(token, apiBase, head, refusal) {
  const listing = await githubRequest(token, apiBase + "/git/trees/" + head.parent.tree.sha + "?recursive=1");
  if (listing.truncated) throw new HttpError(503, refusal);
  return new Set(listing.tree.map(function (entry) { return entry.path; }));
}

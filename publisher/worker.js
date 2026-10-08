const SESSION_TTL = 7 * 24 * 60 * 60;
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "VIDEO", "AUDIO"]);
const ALLOWED_TAGS = new Set(["A", "BLOCKQUOTE", "BR", "CODE", "EM", "FIGURE", "H2", "H3", "H4", "HR", "IMG", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "U", "UL"]);
const CATEGORIES = {
  stereo: { folder: "stereo", name: "Stereo Repair" },
  radio: { folder: "radio", name: "Radio Repair" },
  "test-equipment": { folder: "test-equipment", name: "Test Equipment" }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function authStep(name, operation) {
  try {
    return await operation();
  } catch (error) {
    error.authStage = name;
    throw error;
  }
}

function jsonResponse(request, env, value, status) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  });
  const origin = request.headers.get("Origin");
  if (origin && origin === env.SITE_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  const responseStatus = status || 200;
  return new Response(responseStatus === 204 ? null : JSON.stringify(value), { status: responseStatus, headers: headers });
}

function redirect(url, cookie) {
  const headers = new Headers({ "Cache-Control": "no-store", Location: url });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, {
    status: 302,
    headers: headers
  });
}

function assertConfigured(env) {
  if (!env.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID.startsWith("REPLACE_") ||
      !env.GITHUB_CLIENT_SECRET || !env.SITE_ORIGIN || env.SITE_ORIGIN.includes("YOUR_SITE_HOST") ||
      !env.BUILDER_URL || env.BUILDER_URL.includes("YOUR_SITE_HOST") || !env.PUBLISHER_SESSIONS ||
      !env.GITHUB_OWNER || !env.GITHUB_REPOSITORY) {
    throw new HttpError(503, "The publisher Worker is not fully configured.");
  }
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const prefix = name + "=";
  const match = cookies.split(";").map(function (cookie) { return cookie.trim(); })
    .find(function (cookie) { return cookie.startsWith(prefix); });
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

async function githubRequest(token, path, options) {
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

function base64Url(bytes) {
  let binary = "";
  bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function exchangeOAuthCode(request, env, code, verifier) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: code,
      redirect_uri: new URL("/auth/callback", request.url).toString(),
      code_verifier: verifier
    })
  });
  const result = await response.json().catch(function () { return {}; });
  if (!response.ok || result.error || !result.access_token) {
    throw new HttpError(401, result.error_description || "GitHub authorization failed.");
  }
  return result;
}

async function refreshSession(session, env) {
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) throw new HttpError(401, "GitHub sign-in expired. Please connect again.");
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken
    })
  });
  const result = await response.json().catch(function () { return {}; });
  if (!response.ok || result.error || !result.access_token) {
    throw new HttpError(401, "GitHub sign-in expired. Please connect again.");
  }
  session.accessToken = result.access_token;
  session.refreshToken = result.refresh_token || session.refreshToken;
  session.expiresAt = Date.now() + (Number(result.expires_in) || 28_800) * 1000;
  return session;
}

function isRepositoryAdmin(repository) {
  return Boolean(repository.permissions && repository.permissions.admin === true);
}

function hasPublisherAccess(repository, env) {
  const permissions = repository.permissions || {};
  return isRepositoryAdmin(repository) ||
    (env.ALLOW_NON_ADMIN_PUBLISHING === "true" && permissions.push === true);
}

async function requirePublisherAccess(request, env, sessionId) {
  if (!sessionId) throw new HttpError(401, "Connect GitHub to continue.");
  const key = "session:" + sessionId;
  let session = await env.PUBLISHER_SESSIONS.get(key, "json");
  if (!session) throw new HttpError(401, "GitHub session expired. Connect again.");
  session = await refreshSession(session, env);
  const repository = await githubRequest(session.accessToken,
    "/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPOSITORY);
  if (!hasPublisherAccess(repository, env)) {
    await env.PUBLISHER_SESSIONS.delete(key);
    throw new HttpError(403, "This GitHub account does not have permission to publish to the repository.");
  }
  session.isAdmin = isRepositoryAdmin(repository);
  await env.PUBLISHER_SESSIONS.put(key, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return session;
}

function bearerSession(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
  return new TextDecoder("utf-8").decode(bytes);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function safeSpanStyle(value) {
  const styles = [];
  const size = value.match(/(?:^|;)\s*font-size\s*:\s*(\d{1,2})px\s*(?=;|$)/i);
  if (size && Number(size[1]) >= 10 && Number(size[1]) <= 72) styles.push("font-size: " + Number(size[1]) + "px");
  const color = value.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))\s*(?=;|$)/i);
  if (color) {
    if (color[1].charAt(0) === "#") styles.push("color: " + color[1]);
    else {
      const values = color[1].match(/\d+/g).map(Number);
      if (values.every(function (component) { return component <= 255; })) styles.push("color: rgb(" + values.join(", ") + ")");
    }
  }
  return styles.join("; ");
}

async function sanitizeContent(html, siteOrigin) {
  const input = new Response("<div>" + html + "</div>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new HTMLRewriter().on("*", {
    element: function (element) {
      const tagName = element.tagName.toUpperCase();
      if (DROP_TAGS.has(tagName)) {
        element.remove();
        return;
      }
      if (!ALLOWED_TAGS.has(tagName)) {
        element.removeAndKeepContent();
        return;
      }
      Array.from(element.attributes).forEach(function (attribute) {
        const name = attribute[0];
        const value = attribute[1] || "";
        if (tagName === "A" && name === "href") {
          try {
            const protocol = new URL(value, siteOrigin).protocol;
            if (["http:", "https:", "mailto:"].includes(protocol) || value.charAt(0) === "#") return;
          } catch (error) { }
        } else if (tagName === "IMG" && name === "src" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) {
          return;
        } else if (tagName === "IMG" && name === "alt") {
          return;
        } else if (tagName === "IMG" && name === "data-w" && ["25", "50", "75", "100"].includes(value)) {
          return;
        } else if (tagName === "IMG" && name === "data-a" && ["c", "l", "r"].includes(value)) {
          return;
        } else if (tagName === "SPAN" && name === "style") {
          const style = safeSpanStyle(value);
          if (style) {
            element.setAttribute("style", style);
            return;
          }
        }
        element.removeAttribute(name);
      });
      if (tagName === "IMG" && !element.hasAttribute("src")) element.remove();
    }
  }).transform(input).text();
}

function slugify(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function dateLabel(value) {
  const date = new Date(value + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC"
  }).format(date);
}

function navigationHtml(activeKey) {
  const links = [
    ["../index.html", "Home", ""],
    ["../stereo/index.html", "Stereo Repair", "stereo"],
    ["../radio/index.html", "Radio Repair", "radio"],
    ["../test-equipment/index.html", "Test Equipment", "test-equipment"],
    ["../contact.html", "Contact", ""]
  ];
  return links.map(function (link) {
    return '<a href="' + link[0] + '"' + (link[2] === activeKey ? ' class="on" aria-current="page"' : "") + ">" + link[1] + "</a>";
  }).join("");
}

function articleHtml(data, category, content) {
  const title = escapeHtml(data.title);
  const summary = escapeHtml(data.summary);
  const label = escapeHtml(dateLabel(data.date));
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' + title + ' - Martin Audio Labs</title><meta name="description" content="' + summary + '"><link rel="stylesheet" href="../style.css"></head><body><header class="site"><a class="brand" href="../index.html">Martin Audio Labs</a><nav>' + navigationHtml(data.category) + '<button class="theme" type="button" id="th">Theme</button></nav></header><main><a class="back" href="index.html">Back to ' + escapeHtml(category.name) + '</a><article class="post"><h1 class="post-title">' + title + '</h1><div class="meta">' + label + ' &nbsp;|&nbsp; <a href="index.html">' + escapeHtml(category.name) + '</a></div><div class="body">' + content + '</div></article></main><script>(function(){var r=document.documentElement;try{var t=localStorage.getItem("th");if(t)r.setAttribute("data-theme",t)}catch(e){}document.getElementById("th").onclick=function(){var d=r.getAttribute("data-theme")==="dark"||(!r.getAttribute("data-theme")&&matchMedia("(prefers-color-scheme:dark)").matches),n=d?"light":"dark";r.setAttribute("data-theme",n);try{localStorage.setItem("th",n)}catch(e){}}})()<\/script></body></html>\n';
}

function listingHtml(data, category) {
  return '<article class="post"><h2><a href="' + escapeHtml(data.slug) + '.html">' + escapeHtml(data.title) + '</a></h2><div class="meta">' + escapeHtml(dateLabel(data.date)) + ' &nbsp;|&nbsp; <a href="index.html">' + escapeHtml(category.name) + '</a></div><div class="body"><p>' + escapeHtml(data.summary) + '</p></div><a class="more" href="' + escapeHtml(data.slug) + '.html">Read the post</a></article>';
}

async function updateIndex(indexHtml, data, category) {
  let heading = "";
  let introCount = 0;
  const output = await new HTMLRewriter()
    .on("main h1", { text: function (text) { heading += text.text; } })
    .on("main .intro", { element: function (element) { introCount += 1; element.after(listingHtml(data, category), { html: true }); } })
    .transform(new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text();
  if (heading.trim() !== category.name || introCount !== 1) {
    throw new HttpError(409, "The GitHub section index does not match " + category.name + ".");
  }
  return output;
}

async function publishPost(request, env, session, body) {
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

  const owner = env.GITHUB_OWNER;
  const repository = env.GITHUB_REPOSITORY;
  const branch = env.GITHUB_BRANCH || "main";
  if (env.ALLOW_NON_ADMIN_PUBLISHING === "true" && branch === "main") {
    throw new HttpError(503, "Non-admin test mode must use a branch other than main.");
  }
  const folder = "site/" + category.folder;
  const filename = slug + ".html";
  const apiBase = "/repos/" + owner + "/" + repository;
  const reference = await githubRequest(session.accessToken, apiBase + "/git/ref/heads/" + encodeURIComponent(branch));
  const parent = await githubRequest(session.accessToken, apiBase + "/git/commits/" + reference.object.sha);

  try {
    await githubRequest(session.accessToken, apiBase + "/contents/" + encodePath(folder + "/" + filename) + "?ref=" + encodeURIComponent(reference.object.sha));
    throw new HttpError(409, "A post with this title already exists. Change the title to make a unique filename.");
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const indexPath = folder + "/index.html";
  const indexFile = await githubRequest(session.accessToken,
    apiBase + "/contents/" + encodePath(indexPath) + "?ref=" + encodeURIComponent(reference.object.sha));
  const indexOutput = await updateIndex(decodeBase64Utf8(indexFile.content), {
    title: title, summary: summary, date: date, slug: slug
  }, category);
  const safeContent = await sanitizeContent(rawContent, env.SITE_ORIGIN);
  const data = { title: title, summary: summary, date: date, slug: slug, category: body.category };
  const article = articleHtml(data, category, safeContent);

  const articleBlob = await githubRequest(session.accessToken, apiBase + "/git/blobs", {
    method: "POST", body: { content: article, encoding: "utf-8" }
  });
  const indexBlob = await githubRequest(session.accessToken, apiBase + "/git/blobs", {
    method: "POST", body: { content: indexOutput, encoding: "utf-8" }
  });
  const tree = await githubRequest(session.accessToken, apiBase + "/git/trees", {
    method: "POST",
    body: {
      base_tree: parent.tree.sha,
      tree: [
        { path: folder + "/" + filename, mode: "100644", type: "blob", sha: articleBlob.sha },
        { path: indexPath, mode: "100644", type: "blob", sha: indexBlob.sha }
      ]
    }
  });
  const commit = await githubRequest(session.accessToken, apiBase + "/git/commits", {
    method: "POST",
    body: {
      message: "Publish " + title,
      tree: tree.sha,
      parents: [reference.object.sha]
    }
  });
  await githubRequest(session.accessToken, apiBase + "/git/refs/heads/" + encodeURIComponent(branch), {
    method: "PATCH", body: { sha: commit.sha, force: false }
  });
  return { filename: filename, section: category.folder, commit: commit.sha };
}

async function startLogin(request, env) {
  assertConfigured(env);
  const state = crypto.randomUUID();
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  await env.PUBLISHER_SESSIONS.put("oauth:" + state, JSON.stringify({ verifier: verifier }), { expirationTtl: 600 });
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", new URL("/auth/callback", request.url).toString());
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "offline_access");
  authorize.searchParams.set("allow_signup", "false");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return redirect(authorize.toString(), "oauth_state=" + encodeURIComponent(state) + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600");
}

async function finishLogin(request, env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (url.searchParams.has("error")) throw new HttpError(401, "GitHub sign-in was cancelled or denied.");
  const stateKey = "oauth:" + state;
  const pending = state ? await env.PUBLISHER_SESSIONS.get(stateKey, "json") : null;
  if (!state || cookieValue(request, "oauth_state") !== state || !code || !pending || !pending.verifier) {
    throw new HttpError(400, "GitHub sign-in expired. Start again from the post builder.");
  }
  await env.PUBLISHER_SESSIONS.delete(stateKey);
  const tokens = await authStep("token exchange", function () {
    return exchangeOAuthCode(request, env, code, pending.verifier);
  });
  const repository = await authStep("repository lookup", function () {
    return githubRequest(tokens.access_token, "/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPOSITORY);
  });
  if (!hasPublisherAccess(repository, env)) {
    const error = new HttpError(403, "This GitHub account does not have permission to publish to the repository.");
    error.authStage = "repository permission check";
    error.authDiagnostic = {
      owner: repository.owner && repository.owner.login || "unknown",
      admin: Boolean(repository.permissions && repository.permissions.admin),
      push: Boolean(repository.permissions && repository.permissions.push)
    };
    throw error;
  }

  const sessionId = crypto.randomUUID();
  const ticket = crypto.randomUUID();
  const session = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    expiresAt: Date.now() + (Number(tokens.expires_in) || 28_800) * 1000,
    isAdmin: isRepositoryAdmin(repository)
  };
  await env.PUBLISHER_SESSIONS.put("session:" + sessionId, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  await env.PUBLISHER_SESSIONS.put("ticket:" + ticket, sessionId, { expirationTtl: 90 });
  const destination = new URL(env.BUILDER_URL);
  destination.hash = "ticket=" + encodeURIComponent(ticket);
  return redirect(destination.toString(), "oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") {
    if (request.headers.get("Origin") !== env.SITE_ORIGIN) return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
    return jsonResponse(request, env, {}, 204);
  }
  if (request.headers.get("Origin") !== env.SITE_ORIGIN) return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
  assertConfigured(env);

  if (url.pathname === "/api/session" && request.method === "POST") {
    const body = await request.json().catch(function () { return {}; });
    const ticket = typeof body.ticket === "string" ? body.ticket : "";
    const key = "ticket:" + ticket;
    const sessionId = ticket ? await env.PUBLISHER_SESSIONS.get(key) : null;
    if (!sessionId) throw new HttpError(401, "GitHub sign-in ticket expired. Connect again.");
    await env.PUBLISHER_SESSIONS.delete(key);
    return jsonResponse(request, env, { session: sessionId }, 200);
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    const sessionId = bearerSession(request);
    if (sessionId) await env.PUBLISHER_SESSIONS.delete("session:" + sessionId);
    return jsonResponse(request, env, { signedOut: true }, 200);
  }

  const sessionId = bearerSession(request);
  if (url.pathname === "/api/me" && request.method === "GET") {
    const session = await requirePublisherAccess(request, env, sessionId);
    return jsonResponse(request, env, { role: session.isAdmin ? "administrator" : "test publisher" }, 200);
  }

  if (url.pathname === "/api/publish" && request.method === "POST") {
    const session = await requirePublisherAccess(request, env, sessionId);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 5_500_000) throw new HttpError(413, "Post content exceeds the 5 MB limit.");
    const text = await request.text();
    if (text.length > 5_500_000) throw new HttpError(413, "Post content exceeds the 5 MB limit.");
    let body;
    try { body = JSON.parse(text); }
    catch (error) { throw new HttpError(400, "Invalid post data."); }
    const result = await publishPost(request, env, session, body);
    return jsonResponse(request, env, result, 201);
  }

  return jsonResponse(request, env, { error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/start" && request.method === "GET") return await startLogin(request, env);
      if (url.pathname === "/auth/callback" && request.method === "GET") return await finishLogin(request, env);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      return new Response("Not found.", { status: 404 });
    } catch (error) {
      const status = error.status || 500;
      const message = status >= 500 ? "The publisher service could not complete this request." : error.message;
      if (url.pathname === "/auth/callback" && env.BUILDER_URL && !env.BUILDER_URL.includes("YOUR_SITE_HOST")) {
        const destination = new URL(env.BUILDER_URL);
        const details = error.authDiagnostic || {};
        const fragment = new URLSearchParams({
          auth_error: error.authDiagnostic ? "not_admin" : "oauth_failed",
          login: details.login || "",
          owner: details.owner || "",
          admin: details.admin === undefined ? "unknown" : String(details.admin),
          push: details.push === undefined ? "unknown" : String(details.push),
          status: String(status),
          stage: error.authStage || "callback",
          detail: String(error.message || message).slice(0, 240)
        });
        destination.hash = fragment.toString();
        return redirect(destination.toString(), "oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
      }
      if (url.pathname.startsWith("/api/")) return jsonResponse(request, env, { error: message }, status);
      return new Response(message, {
        status: status,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};
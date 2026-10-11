// The publisher Worker: sign-in with GitHub and the API behind /admin.
// The entry point only routes requests; the work lives in ./src/:
//   auth.js     sign-in, sessions, permission check
//   content.js  site content (homepage, request, about, navigation)
//   shop.js     shop listings
//   posts.js    blog posts (publish, list a section, delete)
//   github.js   GitHub API requests and commits       repo.js  the two JSON data files
//   http.js     responses and request helpers         sanitize.js, uploads.js  input checks
// Pure rendering code is shared with the build in ../shared/.

import { CLEAR_STATE_COOKIE, adminUrl, finishLogin, requirePublisherAccess, startLogin } from "./src/auth.js";
import { MAX_CONTENT_REQUEST, getAdminContent, publishContent } from "./src/content.js";
import { HttpError } from "./src/errors.js";
import { assertConfigured, bearerSession, jsonResponse, readJsonBody, redirect } from "./src/http.js";
import { MAX_DELETE_REQUEST, MAX_POST_REQUEST, deletePost, getSectionIndex, publishPost } from "./src/posts.js";
import { MAX_SHOP_REQUEST, getShopData, publishShop } from "./src/shop.js";

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") {
    if (request.headers.get("Origin") !== env.SITE_ORIGIN) return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
    return jsonResponse(request, env, {}, 204);
  }
  if (request.headers.get("Origin") !== env.SITE_ORIGIN) return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
  assertConfigured(env);

  const route = request.method + " " + url.pathname;

  // sign-in handoff and sign-out
  if (route === "POST /api/session") {
    const body = await request.json().catch(function () { return {}; });
    const ticket = typeof body.ticket === "string" ? body.ticket : "";
    const key = "ticket:" + ticket;
    const sessionId = ticket ? await env.PUBLISHER_SESSIONS.get(key) : null;
    if (!sessionId) throw new HttpError(401, "GitHub sign-in ticket expired. Connect again.");
    await env.PUBLISHER_SESSIONS.delete(key);
    return jsonResponse(request, env, { session: sessionId }, 200);
  }

  if (route === "POST /api/logout") {
    const sessionId = bearerSession(request);
    if (sessionId) await env.PUBLISHER_SESSIONS.delete("session:" + sessionId);
    return jsonResponse(request, env, { signedOut: true }, 200);
  }

  // everything below needs a signed-in repository member
  const sessionId = bearerSession(request);
  const ok = async function (fn, status) {
    const session = await requirePublisherAccess(request, env, sessionId);
    return jsonResponse(request, env, await fn(session), status);
  };

  switch (route) {
    case "GET /api/me":
      return ok(function (session) { return { role: session.isAdmin ? "administrator" : "test publisher" }; }, 200);

    case "GET /api/posts":
      return ok(async function (session) {
        if (!session.isAdmin) throw new HttpError(403, "Only repository administrators can manage published posts.");
        const categoryKey = url.searchParams.get("category");
        const result = await getSectionIndex(session.accessToken, env, categoryKey);
        return Object.assign({ category: categoryKey }, result);
      }, 200);

    case "GET /api/content":
      return ok(function (session) { return getAdminContent(session.accessToken, env); }, 200);

    case "POST /api/content/publish":
      return ok(async function (session) {
        const body = await readJsonBody(request, MAX_CONTENT_REQUEST, "The update is too large. Use smaller images.", "Invalid content.");
        return publishContent(request, env, session, body);
      }, 201);

    case "GET /api/shop":
      return ok(function (session) { return getShopData(session.accessToken, env); }, 200);

    case "POST /api/shop/publish":
      return ok(async function (session) {
        const body = await readJsonBody(request, MAX_SHOP_REQUEST, "The shop update is too large. Publish fewer photos at once.", "Invalid shop data.");
        return publishShop(request, env, session, body);
      }, 201);

    case "POST /api/publish":
      return ok(async function (session) {
        const body = await readJsonBody(request, MAX_POST_REQUEST, "Post content exceeds the 5 MB limit.", "Invalid post data.");
        return publishPost(request, env, session, body);
      }, 201);

    case "POST /api/delete":
      return ok(async function (session) {
        const body = await readJsonBody(request, MAX_DELETE_REQUEST, "Delete request is too large.", "Invalid delete request.");
        return deletePost(request, env, session, body);
      }, 200);

    default:
      return jsonResponse(request, env, { error: "Not found." }, 404);
  }
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
      // a failed sign-in is reported on the admin page, with enough detail to see where it broke
      if (url.pathname === "/auth/callback" && env.SITE_ORIGIN && !env.SITE_ORIGIN.includes("YOUR_SITE_HOST")) {
        const destination = adminUrl(env);
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
        return redirect(destination.toString(), CLEAR_STATE_COOKIE);
      }
      if (url.pathname.startsWith("/api/")) return jsonResponse(request, env, { error: message }, status);
      return new Response(message, {
        status: status,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};

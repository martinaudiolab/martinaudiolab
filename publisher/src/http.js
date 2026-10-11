// Request and response helpers shared by every route.

import { HttpError } from "./errors.js";

/** JSON answer with the CORS headers the admin page needs (only for the configured site origin). */
export function jsonResponse(request, env, value, status) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  });
  const origin = request.headers.get("Origin");
  if (origin && origin === env.SITE_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  const responseStatus = status || 200;
  return new Response(responseStatus === 204 ? null : JSON.stringify(value), { status: responseStatus, headers: headers });
}

export function redirect(url, cookie) {
  const headers = new Headers({ "Cache-Control": "no-store", Location: url });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers: headers });
}

export function assertConfigured(env) {
  if (!env.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID.startsWith("REPLACE_") ||
      !env.GITHUB_CLIENT_SECRET || !env.SITE_ORIGIN || env.SITE_ORIGIN.includes("YOUR_SITE_HOST") ||
      !env.PUBLISHER_SESSIONS ||
      !env.GITHUB_OWNER || !env.GITHUB_REPOSITORY) {
    throw new HttpError(503, "The publisher Worker is not fully configured.");
  }
}

export function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const prefix = name + "=";
  const match = cookies.split(";").map(function (cookie) { return cookie.trim(); })
    .find(function (cookie) { return cookie.startsWith(prefix); });
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

export function bearerSession(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

/** Reads a JSON request body, refusing anything over `limit` characters. */
export async function readJsonBody(request, limit, tooLargeMessage, invalidMessage) {
  if (Number(request.headers.get("Content-Length") || 0) > limit) throw new HttpError(413, tooLargeMessage);
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, tooLargeMessage);
  try { return JSON.parse(text); }
  catch (error) { throw new HttpError(400, invalidMessage); }
}

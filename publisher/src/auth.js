// GitHub sign-in (OAuth with PKCE), sessions kept in KV, and the repository permission check.

import { HttpError } from "./errors.js";
import { assertConfigured, cookieValue, redirect } from "./http.js";
import { githubRequest } from "./github.js";

export const SESSION_TTL = 7 * 24 * 60 * 60;
export const CLEAR_STATE_COOKIE = "oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

/** Runs one sign-in step, tagging any failure with its name so the admin page can say where it broke. */
async function authStep(name, operation) {
  try {
    return await operation();
  } catch (error) {
    error.authStage = name;
    throw error;
  }
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

/** Resolves the signed-in session for a request, or throws 401/403. */
export async function requirePublisherAccess(request, env, sessionId) {
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

/** Every sign-in, successful or not, lands on the admin panel. */
export function adminUrl(env) {
  return new URL("/admin/", env.SITE_ORIGIN);
}

export async function startLogin(request, env) {
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

export async function finishLogin(request, env) {
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
  const destination = adminUrl(env);
  destination.hash = "ticket=" + encodeURIComponent(ticket);
  return redirect(destination.toString(), CLEAR_STATE_COOKIE);
}

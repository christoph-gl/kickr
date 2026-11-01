import { createHmac, timingSafeEqual } from "crypto";

// Two deployment modes, chosen by APP_AUTH_TOKEN:
// - Local (unset): the app only answers requests addressed to this machine, with
//   no login. Host/Origin checks block other websites and DNS rebinding.
// - Hosted (set): the app runs on your own HTTPS domain. Every request needs either
//   the browser session cookie (set by /login) or `Authorization: Bearer <token>`
//   (agents, MCP clients). proxy.ts enforces this for all pages and API routes.

export const SESSION_COOKIE = "inad_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function appAuthToken() {
  return process.env.APP_AUTH_TOKEN?.trim() || null;
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function hostnameOf(value: string) {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

function requestHost(req: Request) {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host");
}

export function isLocalRequest(req: Request) {
  const host = requestHost(req);
  const hostname = host ? hostnameOf(host) : null;
  if (!hostname || !isLocalHostname(hostname)) return false;

  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const originHostname = hostnameOf(origin);
  return originHostname !== null && isLocalHostname(originHostname);
}

/** Browsers send Origin on cross-site requests; reject ones from another site. */
export function isSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const host = requestHost(req);
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function tokenMatches(candidate: string, token: string) {
  return safeEqual(candidate.trim(), token);
}

export function hasValidBearer(req: Request, token: string) {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && tokenMatches(match[1], token));
}

/** Cookie value derived from the token, so the token itself never sits in the browser. */
export function sessionCookieValue(token: string) {
  return createHmac("sha256", token).update("iamnotadoctor-session-v1").digest("hex");
}

export function hasValidSessionCookie(cookieValue: string | undefined, token: string) {
  return Boolean(cookieValue && safeEqual(cookieValue, sessionCookieValue(token)));
}

/** Origin as the browser sees it, e.g. https://kickr.example.com behind a reverse proxy. */
export function publicOrigin(req: Request) {
  const host = requestHost(req);
  if (!host) return new URL(req.url).origin;
  return `${isHttpsRequest(req) ? "https" : "http"}://${host}`;
}

export function isHttpsRequest(req: Request) {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(req.url).protocol === "https:";
}

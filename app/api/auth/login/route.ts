import { NextResponse } from "next/server";
import {
  appAuthToken,
  isHttpsRequest,
  isSameOrigin,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieValue,
  tokenMatches,
} from "@/lib/access-control";

export const dynamic = "force-dynamic";

// Hosted mode only: exchange APP_AUTH_TOKEN for a browser session cookie.
export async function POST(req: Request) {
  const token = appAuthToken();
  if (!token) {
    return NextResponse.json({ error: "Login is only used in hosted mode" }, { status: 404 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const candidate = typeof body?.token === "string" ? body.token : "";
  if (!candidate || !tokenMatches(candidate, token)) {
    // Slow down guessing.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return NextResponse.json({ error: "Wrong access token" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, sessionCookieValue(token), {
    httpOnly: true,
    secure: isHttpsRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

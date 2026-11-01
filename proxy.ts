import { NextResponse, type NextRequest } from "next/server";
import {
  appAuthToken,
  hasValidBearer,
  hasValidSessionCookie,
  isLocalRequest,
  isSameOrigin,
  publicOrigin,
  SESSION_COOKIE,
} from "@/lib/access-control";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

// Gate every page and API route. See lib/access-control.ts for the two modes.
export function proxy(request: NextRequest) {
  const token = appAuthToken();

  if (!token) {
    return isLocalRequest(request)
      ? NextResponse.next()
      : new NextResponse("Not found", { status: 404 });
  }

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (hasValidBearer(request, token)) return NextResponse.next();
  if (
    hasValidSessionCookie(request.cookies.get(SESSION_COOKIE)?.value, token) &&
    isSameOrigin(request)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="iamnotadoctor"' } }
    );
  }
  // Use the forwarded public host, so the browser stays on your domain behind a reverse proxy.
  const login = new URL("/login", publicOrigin(request));
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next.js build assets and public files (sounds), which hold no rider data.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:mp3|ico|png|svg|webmanifest)$).*)"],
};

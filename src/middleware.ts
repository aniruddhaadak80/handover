import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, isSessionId, newSessionId } from "@/lib/session-shared";

/**
 * Mints the anonymous owner cookie before any page or API handler runs, so
 * server components can read ownership without being able to set cookies.
 * Edge-safe: no Node built-ins, no database access.
 */
export function middleware(request: NextRequest): NextResponse {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (isSessionId(existing)) {
    return NextResponse.next();
  }
  const response = NextResponse.next();
  response.cookies.set(SESSION_COOKIE, newSessionId(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml)$).*)"],
};
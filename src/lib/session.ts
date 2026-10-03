import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isSessionId,
  newSessionId,
  newShareToken,
} from "./session-shared";

export { SESSION_COOKIE, SESSION_TTL_SECONDS, isSessionId, newSessionId, newShareToken };

/**
 * Ownership model: no accounts. Every browser gets an unguessable session id
 * in an HTTP-only cookie, and that id is the only thing that can read or write
 * a board. `middleware.ts` mints it, so server components can trust it.
 */
export async function getSessionId(): Promise<string> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  return isSessionId(value) ? value : "anonymous";
}

export async function ensureSessionId(): Promise<{ sessionId: string; created: boolean }> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (isSessionId(value)) return { sessionId: value, created: false };
  const sessionId = newSessionId();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return { sessionId, created: true };
}
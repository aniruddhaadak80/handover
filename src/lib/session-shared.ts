/**
 * Edge-safe session primitives.
 *
 * Kept separate from `session.ts` so `middleware.ts` never drags `next/headers`
 * or a Node-only crypto import into the Edge runtime. Web Crypto is available
 * in both runtimes, so there is exactly one implementation.
 */
export const SESSION_COOKIE = "hv_sid";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

const HEX = "0123456789abcdef";

/** Cryptographically random lowercase hex string. */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += HEX[(byte >> 4) & 15] + HEX[byte & 15];
  }
  return out;
}

export function isSessionId(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function newSessionId(): string {
  return randomHex(16);
}

export function newShareToken(): string {
  return randomHex(12);
}
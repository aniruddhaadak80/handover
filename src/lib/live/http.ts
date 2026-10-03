/** Small dependency-free JSON fetcher with timeout, bounded retry and a stale cache. */

export type FetchResult<T> = {
  data: T;
  status: "live" | "cached";
  fetchedAt: string;
  url: string;
};

type CacheEntry = { at: number; value: unknown };

const CACHE_TTL_MS = 1000 * 60 * 30;
const CACHE = new Map<string, CacheEntry>();

export function clearFetchCache(): void {
  CACHE.clear();
}

function fromCache<T>(key: string): FetchResult<T> | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return { data: hit.value as T, status: "cached", fetchedAt: new Date(hit.at).toISOString(), url: key };
}

export type FetchJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  /** Return a stale cache entry instead of throwing when the network fails. */
  allowStale?: boolean;
  headers?: Record<string, string>;
};

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<FetchResult<T>> {
  const { timeoutMs = 8000, retries = 2, allowStale = true, headers } = options;

  const cached = fromCache<T>(url);
  if (cached) return cached;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "handover-care-board/1.0", ...headers },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`upstream responded ${response.status}`);
      }
      const data = (await response.json()) as T;
      const fetchedAt = new Date().toISOString();
      CACHE.set(url, { at: Date.now(), value: data });
      return { data, status: "live", fetchedAt, url };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (allowStale) {
    const stale = fromCache<T>(url);
    if (stale) return { ...stale, status: "cached" };
  }
  throw new Error(
    `request failed for ${redactUrl(url)}: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

/** Only the origin and path are ever surfaced in errors. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "upstream";
  }
}

/**
 * Trim a label field to a display length. openFDA returns these sections as
 * either a string or an array of strings depending on the submission, so both
 * shapes have to normalize to one string.
 */
export function clampText(value: unknown, maxLength = 1400): string | null {
  let text: string | null = null;
  if (typeof value === "string") {
    text = value;
  } else if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    text = typeof first === "string" ? first : null;
  }
  if (text === null) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}\u2026` : trimmed;
}

export function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    return typeof first === "string" ? first.trim() : null;
  }
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
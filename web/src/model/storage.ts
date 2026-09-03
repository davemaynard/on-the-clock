// localStorage, guarded. If the browser blocks storage the tracker still works for
// the session and says so, rather than pretending it saved.

let available = true;
try {
  localStorage.setItem("__on-the-clock", "1");
  localStorage.removeItem("__on-the-clock");
} catch {
  available = false;
}

/** Whether picks will survive a reload in this browser. */
export const storageAvailable = (): boolean => available;

// Bumped when the shape of saved state changes, so state saved against an older page
// can never be read into a newer one. v3: row indices instead of names.
const PREFIX = "on-the-clock:v3";

/** A namespaced key for one league. */
export const storageKey = (league: string, name?: string): string =>
  `${PREFIX}:${league}${name ? `:${name}` : ""}`;

export function read(key: string): string | null {
  if (!available) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  if (!available) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    available = false;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const writeJson = (key: string, value: unknown): void => write(key, JSON.stringify(value));

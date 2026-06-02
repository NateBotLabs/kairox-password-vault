/**
 * Typed wrappers around chrome.storage.session (cleared on browser close)
 * and chrome.storage.local (persisted).
 *
 * Sensitive session data (auth token, email) goes to storage.session.
 * User preferences (server URL, auto-lock timeout) go to storage.local.
 */

// ── Session storage ────────────────────────────────────────────────────────────

export interface SessionData {
  /** JWT returned by the API server after login. */
  authToken: string;
  email: string;
}

export async function getSession(): Promise<SessionData | null> {
  const result = await chrome.storage.session.get(['authToken', 'email']);
  if (!result.authToken || !result.email) return null;
  return { authToken: result.authToken as string, email: result.email as string };
}

export async function setSession(data: SessionData): Promise<void> {
  await chrome.storage.session.set(data);
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.clear();
}

// ── Local storage ──────────────────────────────────────────────────────────────

const DEFAULT_SERVER_URL     = 'http://localhost:3000';
const DEFAULT_AUTO_LOCK_MINS = 15;

export async function getServerUrl(): Promise<string> {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  return (serverUrl as string | undefined) ?? DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ serverUrl: url });
}

export async function getAutoLockMinutes(): Promise<number> {
  const { autoLockMins } = await chrome.storage.local.get('autoLockMins');
  return (autoLockMins as number | undefined) ?? DEFAULT_AUTO_LOCK_MINS;
}

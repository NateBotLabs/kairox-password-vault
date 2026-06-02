/**
 * Typed message protocol between content scripts / popup and the background
 * service worker. All chrome.runtime.sendMessage calls use these types.
 *
 * Security contract:
 *   - Content scripts provide `url` fields from window.location — the background
 *     ALSO validates sender.tab.url from Chrome (unforgeable) before serving creds.
 *   - Passwords never appear in BgRequest; only `AUTOFILL_FILL` replies contain them.
 *   - Passwords are sent only back to the tab whose URL was validated.
 */

import type { CollectionDto, EntryKind, LoginEntry, VaultEntry } from '$sdk/types';

export type { CollectionDto, EntryKind, LoginEntry, VaultEntry };

// ── Requests (caller → background) ────────────────────────────────────────────

export type BgRequest =
  | { type: 'GET_STATUS' }
  | { type: 'UNLOCK'; email: string; password: string }
  | { type: 'REGISTER'; email: string; password: string }
  | { type: 'LOCK' }
  | { type: 'GET_SERVER_URL' }
  | { type: 'SET_SERVER_URL'; url: string }
  /** Called by the popup to find entries matching the active tab. */
  | { type: 'LIST_ENTRIES_FOR_URL'; url: string }
  /**
   * Called by content script after user picks an entry in the overlay.
   * Background uses sender.tab.url (from Chrome, not caller-provided) to
   * re-validate origin before decrypting and returning credentials.
   */
  | { type: 'AUTOFILL_REQUEST'; entryId: string; collectionId: string }
  | { type: 'LIST_COLLECTIONS' }
  | { type: 'LIST_ENTRIES'; collectionId: string }
  | { type: 'CREATE_ENTRY'; collectionId: string; entry: EntryKind }
  | { type: 'CREATE_COLLECTION' }
  | { type: 'DELETE_ENTRY'; entryId: string; collectionId: string };

// ── Responses (background → caller) ───────────────────────────────────────────

export type BgResponse<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ── Named response shapes ──────────────────────────────────────────────────────

export interface StatusData {
  locked: boolean;
  authenticated: boolean;
  email: string | null;
}

/** Candidate entry shown in the autofill overlay — no passwords exposed. */
export interface AutofillCandidate {
  id: string;
  collectionId: string;
  name: string;
  username: string;
  url?: string;
}

/** Returned only after successful origin validation in AUTOFILL_REQUEST. */
export interface AutofillCredentials {
  username: string;
  password: string;
  totp?: string;
}

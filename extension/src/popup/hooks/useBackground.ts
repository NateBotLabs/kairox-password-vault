/**
 * Typed bridge to the background service worker.
 * All popup ↔ background communication goes through this hook.
 */

import type {
  AutofillCandidate,
  BgRequest,
  BgResponse,
  CollectionDto,
  EntryKind,
  LoginEntry,
  StatusData,
  VaultEntry,
} from '../../shared/messages.js';

export type { StatusData, AutofillCandidate, CollectionDto, LoginEntry, VaultEntry };

function send<T>(req: BgRequest): Promise<BgResponse<T>> {
  return chrome.runtime.sendMessage(req) as Promise<BgResponse<T>>;
}

async function call<T>(req: BgRequest): Promise<T> {
  const resp = await send<T>(req);
  if (!resp.ok) throw new Error(resp.error);
  return resp.data;
}

export const bg = {
  getStatus: ()                                   => call<StatusData>({ type: 'GET_STATUS' }),
  unlock:    (email: string, password: string)    => call<StatusData>({ type: 'UNLOCK',   email, password }),
  register:  (email: string, password: string)    => call<StatusData>({ type: 'REGISTER', email, password }),
  lock:      ()                                   => call<null>({ type: 'LOCK' }),
  getServerUrl: ()                                => call<string>({ type: 'GET_SERVER_URL' }),
  setServerUrl: (url: string)                     => call<null>({ type: 'SET_SERVER_URL', url }),

  listCollections: ()                             => call<CollectionDto[]>({ type: 'LIST_COLLECTIONS' }),
  createCollection: ()                            => call<CollectionDto>({ type: 'CREATE_COLLECTION' }),
  listEntries: (collectionId: string)             => call<VaultEntry[]>({ type: 'LIST_ENTRIES', collectionId }),
  createEntry: (collectionId: string, entry: EntryKind) =>
    call<VaultEntry>({ type: 'CREATE_ENTRY', collectionId, entry }),
  deleteEntry: (entryId: string, collectionId: string) => call<null>({ type: 'DELETE_ENTRY', entryId, collectionId }),

  listEntriesForUrl: (url: string)                => call<AutofillCandidate[]>({ type: 'LIST_ENTRIES_FOR_URL', url }),
};

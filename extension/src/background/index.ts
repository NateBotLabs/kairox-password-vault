/**
 * Background service worker entry point.
 *
 * Responsibilities:
 *  - Hold the ExtensionVaultClient (owns all key material via WASM session).
 *  - Handle typed messages from the popup and content scripts.
 *  - Validate origins before returning credentials (autofill security gate).
 *  - Manage auto-lock via chrome.alarms.
 *
 * Service worker lifecycle note:
 *   Chrome may terminate and restart the SW at any time. The in-memory vault
 *   (KairoxVault WASM instance) is lost on restart — the vault appears locked
 *   and the user must re-enter their password. chrome.storage.session preserves
 *   the JWT token so we can re-authenticate the HTTP client after re-unlock.
 */

/// <reference types="chrome" />

import { ExtensionVaultClient } from './vault-client.js';
import type {
  AutofillCandidate,
  AutofillCredentials,
  BgRequest,
  BgResponse,
  CollectionDto,
  StatusData,
  VaultEntry,
} from '../shared/messages.js';
import {
  clearSession,
  getAutoLockMinutes,
  getServerUrl,
  getSession,
  setServerUrl,
  setSession,
} from '../shared/storage.js';


// ── Client singleton ───────────────────────────────────────────────────────────

let client: ExtensionVaultClient | null = null;

async function getClient(): Promise<ExtensionVaultClient> {
  if (!client) {
    const url = await getServerUrl();
    client = new ExtensionVaultClient(url);

    // Restore JWT from session storage so HTTP calls work after SW restart.
    // The vault itself stays locked until the user re-enters their password.
    const saved = await getSession();
    if (saved) {
      client.token = saved.authToken;
    }
  }
  return client;
}

// ── Auto-lock ──────────────────────────────────────────────────────────────────

const ALARM_NAME = 'kairox-auto-lock';

async function resetAutoLock(): Promise<void> {
  const mins = await getAutoLockMinutes();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: mins });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  client?.lock();
  clearSession().catch(() => undefined);
});

// ── Message handler ────────────────────────────────────────────────────────────

function ok<T>(data: T): BgResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): BgResponse<never> {
  return { ok: false, error: String(error instanceof Error ? error.message : error) };
}

chrome.runtime.onMessage.addListener(
  (
    request: BgRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BgResponse) => void,
  ): true => {
    handleMessage(request, sender)
      .then(sendResponse)
      .catch(err => sendResponse(fail(err)));
    return true; // keep channel open for async response
  },
);

async function handleMessage(
  req: BgRequest,
  sender: chrome.runtime.MessageSender,
): Promise<BgResponse> {
  const c = await getClient();

  switch (req.type) {
    case 'GET_STATUS': {
      const saved = await getSession();
      const data: StatusData = {
        locked:          c.isLocked,
        authenticated:   c.isAuthenticated,
        email:           saved?.email ?? null,
      };
      return ok(data);
    }

    case 'UNLOCK': {
      await c.login(req.email, req.password);
      await setSession({ authToken: c.token!, email: req.email });
      await resetAutoLock();
      return ok<StatusData>({ locked: false, authenticated: true, email: req.email });
    }

    case 'REGISTER': {
      await c.register(req.email, req.password);
      await setSession({ authToken: c.token!, email: req.email });
      await resetAutoLock();
      return ok<StatusData>({ locked: false, authenticated: true, email: req.email });
    }

    case 'LOCK': {
      c.lock();
      await clearSession();
      await chrome.alarms.clear(ALARM_NAME);
      return ok(null);
    }

    case 'GET_SERVER_URL': {
      return ok(await getServerUrl());
    }

    case 'SET_SERVER_URL': {
      await setServerUrl(req.url);
      c.updateBaseUrl(req.url);
      return ok(null);
    }

    case 'LIST_ENTRIES_FOR_URL': {
      if (c.isLocked) return ok([] as AutofillCandidate[]);
      await resetAutoLock();
      const candidates = await c.findCandidatesForUrl(req.url);
      return ok(candidates);
    }

    case 'AUTOFILL_REQUEST': {
      if (c.isLocked) return fail('Vault is locked');

      // Use Chrome-provided sender.tab.url — cannot be spoofed by a content script.
      const tabUrl = sender.tab?.url;
      if (!tabUrl) return fail('Cannot determine tab URL');

      // Re-validate origin against the stored entry before decrypting.
      const candidates = await c.findCandidatesForUrl(tabUrl);
      const allowed    = candidates.find(
        e => e.id === req.entryId && e.collectionId === req.collectionId,
      );
      if (!allowed) return fail('Origin mismatch — autofill denied');

      await resetAutoLock();
      const creds = await c.getCredentials(req.entryId, req.collectionId);
      return ok(creds as AutofillCredentials);
    }

    case 'LIST_COLLECTIONS': {
      if (c.isLocked) return fail('Vault is locked');
      await resetAutoLock();
      const collections = await c.listCollections();
      return ok(collections as CollectionDto[]);
    }

    case 'LIST_ENTRIES': {
      if (c.isLocked) return fail('Vault is locked');
      await resetAutoLock();
      const entries = await c.listEntries(req.collectionId);
      return ok(entries as VaultEntry[]);
    }

    case 'CREATE_ENTRY': {
      if (c.isLocked) return fail('Vault is locked');
      await resetAutoLock();
      const entry = await c.createEntry(req.collectionId, req.entry);
      return ok(entry as VaultEntry);
    }

    case 'CREATE_COLLECTION': {
      if (c.isLocked) return fail('Vault is locked');
      await resetAutoLock();
      const col = await c.createCollection();
      return ok(col as CollectionDto);
    }

    case 'DELETE_ENTRY': {
      if (c.isLocked) return fail('Vault is locked');
      await resetAutoLock();
      await c.deleteEntry(req.entryId, req.collectionId);
      return ok(null);
    }
  }
}

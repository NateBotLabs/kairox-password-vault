/**
 * Raw HTTP client for the kairox-api server.
 * Returns typed responses; throws ApiError on non-2xx.
 */

import type {
  AuthResponse,
  CollectionDto,
  EntryDto,
  UserDto,
  WrappedKeyDto,
} from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean { return this.status === 401; }
  get isNotFound():     boolean { return this.status === 404; }
  get isConflict():     boolean { return this.status === 409; }
}

// ── Low-level fetch wrapper ────────────────────────────────────────────────────

async function request<T>(
  baseUrl: string,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token)              headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => ({ error: 'empty response' }));

  if (!res.ok) {
    throw new ApiError(res.status, (json as { error?: string }).error ?? 'request failed');
  }

  return json as T;
}

// ── Typed API surface ─────────────────────────────────────────────────────────

export function createApiClient(baseUrl: string, getToken: () => string | null) {
  const g = <T>(path: string) =>
    request<T>(baseUrl, 'GET', path, getToken());
  const p = <T>(path: string, body: unknown) =>
    request<T>(baseUrl, 'POST', path, getToken(), body);
  const pu = <T>(path: string, body: unknown) =>
    request<T>(baseUrl, 'PUT', path, getToken(), body);
  const d = <T>(path: string) =>
    request<T>(baseUrl, 'DELETE', path, getToken());

  return {
    auth: {
      /** Fetch the Argon2 salt stored for this email (not secret). */
      getSalt: (email: string) =>
        g<{ salt: string }>(`/api/v1/auth/salt?email=${encodeURIComponent(email)}`),

      register: (body: {
        email: string;
        auth_key: string;
        public_key: string;
        salt: string;
      }) => p<AuthResponse>('/api/v1/auth/register', body),

      login: (body: { email: string; auth_key: string }) =>
        p<AuthResponse>('/api/v1/auth/login', body),
    },

    users: {
      me: () => g<UserDto>('/api/v1/users/me'),
      /** Returns the X25519 public key of any user — needed to wrap a CK for them. */
      publicKey: (userId: string) =>
        g<{ public_key: string }>(`/api/v1/users/${userId}/public-key`),
    },

    collections: {
      list: () => g<CollectionDto[]>('/api/v1/collections'),
      create: (body: { wrapped_key: string }) =>
        p<CollectionDto>('/api/v1/collections', body),
      /** Fetch the calling user's wrapped Collection Key. */
      getWrappedKey: (collectionId: string) =>
        g<WrappedKeyDto>(`/api/v1/collections/${collectionId}/wrapped-key`),
      /** Grant another user access by uploading their wrapped CK (owner only). */
      addWrappedKey: (
        collectionId: string,
        body: { user_id: string; key_version: number; wrapped_key: string },
      ) => p<void>(`/api/v1/collections/${collectionId}/wrapped-keys`, body),
      /** Revoke a member's access (owner only). Rotate the CK afterwards. */
      revokeAccess: (collectionId: string, userId: string) =>
        d<void>(`/api/v1/collections/${collectionId}/members/${userId}`),
    },

    entries: {
      list: (collectionId: string) =>
        g<EntryDto[]>(`/api/v1/collections/${collectionId}/entries`),
      create: (body: { collection_id: string; ciphertext: string }) =>
        p<EntryDto>('/api/v1/entries', body),
      get: (entryId: string) => g<EntryDto>(`/api/v1/entries/${entryId}`),
      update: (entryId: string, body: { ciphertext: string; expected_version: number }) =>
        pu<EntryDto>(`/api/v1/entries/${entryId}`, body),
      delete: (entryId: string) => d<void>(`/api/v1/entries/${entryId}`),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

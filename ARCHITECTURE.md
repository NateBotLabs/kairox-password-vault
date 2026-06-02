# kairox-password-vault — Production Architecture

> **Version:** 0.1 — MVP Foundation  
> **Stack:** Rust · Axum · PostgreSQL · MinIO · Tauri · React · WASM

---

## Table of Contents

1. [Security Principles](#1-security-principles)
2. [Cryptographic System](#2-cryptographic-system)
3. [Key Hierarchy & Lifecycle](#3-key-hierarchy--lifecycle)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Multi-User & Access Control Model](#5-multi-user--access-control-model)
6. [Rust Workspace Structure](#6-rust-workspace-structure)
7. [Sync Engine Design](#7-sync-engine-design)
8. [Database Schema](#8-database-schema)
9. [API Design](#9-api-design)
10. [Browser Extension (MV3)](#10-browser-extension-mv3)
11. [Self-Hosting (Docker Compose)](#11-self-hosting-docker-compose)
12. [Threat Model](#12-threat-model)
13. [Implementation Roadmap](#13-implementation-roadmap)
14. [Design Traps to Avoid](#14-design-traps-to-avoid)

---

## 1. Security Principles

### The Zero-Knowledge Contract

```
SERVER KNOWS:          SERVER NEVER KNOWS:
─────────────────────  ─────────────────────────────────────
User email             Master password (or derivative)
Argon2 salt            Master key
Public key             Private key
Encrypted vault blobs  Plaintext vault entries
Collection IDs         Collection key (CK)
Wrapped CK ciphertext  Decrypted CK
Device ID              Session decryption keys
Sync timestamps        Any password, username, URL
```

### Trust Boundary Rules

1. **Encryption always happens on the client** — the API accepts and returns opaque ciphertext.
2. **Access control is key possession** — owning a collection key (CK) IS the permission.
3. **The server is an encrypted blob store** — it enforces auth tokens, not semantic data rules.
4. **Passkey / master password never leaves the device** — only the derived encryption key is used for wrapping, and that never travels over the wire.

---

## 2. Cryptographic System

### Algorithm Selection

| Purpose              | Algorithm              | Library (Rust)         | Rationale                            |
|----------------------|------------------------|------------------------|--------------------------------------|
| Password KDF         | Argon2id               | `argon2`               | Memory-hard, GPU-resistant           |
| Symmetric encryption | XChaCha20-Poly1305     | `chacha20poly1305`     | Fast, extended nonce (no nonce reuse risk), AEAD |
| Asymmetric encryption| X25519 + XChaCha20    | `x25519-dalek`         | Key wrapping for sharing             |
| Signing              | Ed25519                | `ed25519-dalek`        | Device attestation, vault proofs     |
| HKDF expand          | HKDF-SHA256            | `hkdf`                 | Key derivation from master key       |
| Nonce generation     | CSPRNG (OsRng)         | `rand`                 | Always OS-sourced randomness         |
| Zeroization          | `zeroize` + `secrecy`  | `zeroize`              | Wipe secrets on drop                 |

### Nonce Safety

- XChaCha20 uses a 192-bit (24-byte) nonce — extended nonce space.
- **Nonces MUST be random** (never sequential counters for vault entries).
- Nonces are stored prepended to ciphertext: `[24-byte nonce || ciphertext || 16-byte tag]`.
- Never reuse a nonce with the same key. Use `OsRng` always.

### What Is Encrypted vs Plaintext

```
PLAINTEXT (server/DB stores openly):
  - user.email
  - user.argon2_salt
  - user.public_key (X25519)
  - user.signing_public_key (Ed25519)
  - collection.id, collection.org_id
  - wrapped_collection_key.user_id, .collection_id
  - device.id, device.user_id, device.public_key
  - sync.blob_path, sync.version, sync.updated_at

ENCRYPTED (server/S3 stores ciphertext only):
  - vault entries (all fields: name, username, password, URL, notes, TOTP)
  - collection key (CK) — stored once per user, wrapped with their public key
  - private key — stored wrapped with master key
  - org member metadata (optional: names, roles can be encrypted too)
```

---

## 3. Key Hierarchy & Lifecycle

### Full Key Derivation Chain

```
Master Password (never leaves device)
       │
       │ Argon2id(password, salt, mem=64MB, iter=3, par=4)
       ▼
  Master Key (256-bit, in-memory only, zeroized on lock)
       │
       ├── HKDF(info="kairox-symmetric-v1")
       │         ▼
       │    Symmetric Key → encrypt/decrypt User Private Key (stored encrypted)
       │
       └── HKDF(info="kairox-auth-v1")
                 ▼
            Auth Key → derive session token (never the master key itself)

  User Private Key (X25519, decrypted in memory after unlock)
       │
       │ Decrypt with Symmetric Key
       ▼
  User Key Pair
  ├── Public Key  → stored server-side (plaintext, used for key wrapping)
  └── Private Key → stored server-side (XChaCha20-encrypted with Symmetric Key)

  Collection Key (CK, 256-bit random)
       │
       │ Encrypted with User Public Key (X25519 ECDH + XChaCha20)
       ▼
  Wrapped CK → stored server-side per user

  Vault Entry
       │
       │ Encrypted with CK + random nonce
       ▼
  Ciphertext blob → uploaded to S3/MinIO
```

### Key Rotation Strategy

1. **Collection key rotation:**
    - Generate new CK.
    - Re-encrypt all collection entries with new CK (client-side batch).
    - Re-wrap new CK for all current members.
    - Atomic server-side commit: new blob + new wrapped keys in a single transaction.
    - Old CK is discarded; old blobs replaced.

2. **Master password change:**
    - Derive new Symmetric Key from new password.
    - Re-encrypt User Private Key with new Symmetric Key.
    - All collection keys remain valid (they're wrapped with the public key, which doesn't change).

3. **User revocation:**
    - Remove user's wrapped CK from server.
    - Rotate CK (above) to ensure they can't use any cached version.

### Versioning

All encrypted payloads carry a 1-byte version header:
```
[1-byte version | 24-byte nonce | ciphertext | 16-byte tag]
```
Version `0x01` = XChaCha20-Poly1305. Future versions can migrate gracefully.

---

## 4. System Architecture Overview

### Component Map

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT TIER (zero-trust: all crypto here)                           │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ Tauri Desktop│  │ React Web App    │  │ Chrome Extension MV3 │   │
│  │              │  │                  │  │                      │   │
│  │ ┌──────────┐ │  │  ┌────────────┐  │  │ ┌────────────────┐   │   │
│  │ │kairox-   │ │  │  │kairox-     │  │  │ │kairox-         │   │   │
│  │ │crypto    │ │  │  │crypto-wasm │  │  │ │crypto-wasm     │   │   │
│  │ │(native)  │ │  │  │           │  │  │ │(bundled)       │   │   │
│  │ └──────────┘ │  │  └────────────┘  │  │ └────────────────┘   │   │
│  └──────┬───────┘  └────────┬─────────┘  └──────────┬───────────┘   │
│         └──────────────────┬┘                        │               │
│                            │  HTTPS + Bearer token   │               │
└────────────────────────────┼─────────────────────────┘               │
                             │                                          │
┌────────────────────────────▼─────────────────────────────────────────┤
│  EDGE / REVERSE PROXY (Traefik)                                       │
│  TLS termination, rate limiting, request routing                      │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────────────┐
│  SERVER TIER (blind to plaintext)                                      │
│                                                                        │
│  ┌────────────────────────────────────────┐  ┌───────────────────┐    │
│  │  kairox-api (Rust/Axum)                │  │  Worker Service   │    │
│  │                                        │  │  (async tasks)    │    │
│  │  /auth   /devices  /vault  /orgs       │  │                   │    │
│  │  /keys   /blobs    /sync               │  │  - Key rotation   │    │
│  │                                        │  │  - Cleanup        │    │
│  │  Middleware:                           │  │  - Audit logs     │    │
│  │  - JWT validation                      │  └───────────────────┘    │
│  │  - Rate limiting                       │                           │
│  │  - Audit logging                       │                           │
│  └──────────────────┬─────────────────────┘                          │
│                     │                                                  │
│         ┌───────────┴───────────┐                                     │
│         ▼                       ▼                                      │
│  ┌─────────────┐        ┌────────────────┐                            │
│  │ PostgreSQL  │        │ MinIO (S3)     │                            │
│  │             │        │                │                            │
│  │ - Users     │        │ - Vault blobs  │                            │
│  │ - Devices   │        │ - Backups      │                            │
│  │ - Wrapped   │        │                │                            │
│  │   keys      │        │                │                            │
│  │ - Org/Coll  │        │                │                            │
│  └─────────────┘        └────────────────┘                            │
└───────────────────────────────────────────────────────────────────────┘
```

### Trust Boundaries

```
Zone A (TRUSTED — user controls this):
  Device memory after vault unlock
  Master key, collection keys (in-memory, zeroized on lock)

Zone B (SEMI-TRUSTED — client code):
  Tauri / Web App / Extension
  WASM module
  IPC channels (must validate origin)

Zone C (UNTRUSTED — treat as hostile):
  Server API
  Database
  S3/MinIO
  Network
  Other browser tabs/extensions
```

---

## 5. Multi-User & Access Control Model

### Entity Relationships

```
Organization
  ├── has many Members (User + Role)
  ├── has many Collections
  │     ├── Collection Key (CK, 256-bit random)
  │     ├── Wrapped CK entries (one per member with access)
  │     └── Vault entries (encrypted with CK)
  └── Roles: Admin | Manager | Viewer
```

### Key Distribution Flow (Inviting a User)

```
Admin wants to give Alice access to "Finance" collection:

1. Admin decrypts Finance CK from their own wrapped key (locally)
2. Admin fetches Alice's public key from server
3. Admin wraps Finance CK with Alice's public key:
   wrapped = ECDH_encrypt(alice.public_key, finance_CK)
4. Admin uploads wrapped CK to server: POST /collections/{id}/members
5. Alice syncs, fetches her wrapped keys
6. Alice decrypts Finance CK with her private key (locally)
7. Alice decrypts vault entries using CK
```

### Role Implementation

Roles are **NOT server-enforced ACLs**. They are **key distribution shortcuts**:

```
Admin Role    → receives wrapped CK for ALL collections
Manager Role  → receives wrapped CK for configured subset
Viewer Role   → receives wrapped CK for read-only subset
```

The server validates that wrapped keys are uploaded by someone who possesses the CK (via signed proof), but never touches the CK itself.

### Read-Only Enforcement

Read-only is enforced cryptographically in MVP v2:
- Generate a separate "read key" derived from CK with `HKDF(CK, info="read-v1")`
- Viewers get wrapped read key (can decrypt but not re-encrypt with full CK)
- For MVP: read-only flag is server-side hint only; full crypto enforcement is v2

---

## 6. Rust Workspace Structure

```
kairox-password-vault/
├── Cargo.toml                    # workspace
├── crates/
│   ├── kairox-crypto/            # CORE — no I/O, no async
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── kdf.rs            # Argon2id, HKDF
│   │   │   ├── aead.rs           # XChaCha20-Poly1305 encrypt/decrypt
│   │   │   ├── keys.rs           # KeyPair, WrappedKey, CollectionKey
│   │   │   ├── vault_entry.rs    # VaultEntry serialization + encryption
│   │   │   ├── key_wrap.rs       # X25519 ECDH key wrapping
│   │   │   └── zeroize.rs        # SecretBytes wrapper
│   │   └── Cargo.toml            # no_std compatible (for WASM)
│   │
│   ├── kairox-crypto-wasm/       # WASM bindings (wasm-bindgen)
│   │   ├── src/
│   │   │   └── lib.rs            # #[wasm_bindgen] exports
│   │   └── Cargo.toml
│   │
│   ├── kairox-api/               # Axum server
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── routes/
│   │   │   │   ├── auth.rs       # register, login, logout
│   │   │   │   ├── devices.rs    # device trust management
│   │   │   │   ├── vault.rs      # blob upload/download/sync
│   │   │   │   ├── collections.rs
│   │   │   │   ├── keys.rs       # wrapped key CRUD
│   │   │   │   └── orgs.rs
│   │   │   ├── middleware/
│   │   │   │   ├── auth.rs       # JWT validation
│   │   │   │   ├── rate_limit.rs
│   │   │   │   └── audit.rs
│   │   │   ├── db/
│   │   │   │   ├── models.rs
│   │   │   │   └── queries.rs
│   │   │   └── storage/
│   │   │       └── s3.rs         # MinIO/S3 client
│   │   └── Cargo.toml
│   │
│   ├── kairox-sync/              # Sync logic (shared client+server logic)
│   │   ├── src/
│   │   │   ├── snapshot.rs       # encrypted snapshot model
│   │   │   ├── conflict.rs       # conflict detection
│   │   │   └── queue.rs          # offline operation queue
│   │   └── Cargo.toml
│   │
│   └── kairox-types/             # Shared types (no crypto, no I/O)
│       ├── src/
│       │   ├── vault.rs          # VaultEntry, Collection, Org
│       │   ├── api.rs            # Request/response DTOs
│       │   └── error.rs
│       └── Cargo.toml
│
├── apps/
│   ├── desktop/                  # Tauri app
│   │   ├── src-tauri/
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── commands/     # Tauri IPC commands
│   │   │   │   │   ├── vault.rs
│   │   │   │   │   ├── crypto.rs
│   │   │   │   │   └── sync.rs
│   │   │   │   └── state.rs      # AppState (locked/unlocked)
│   │   │   └── Cargo.toml
│   │   └── src/                  # React frontend (same as web)
│   │
│   ├── web/                      # React SPA
│   │   ├── src/
│   │   │   ├── crypto/           # WASM loader + JS wrapper
│   │   │   ├── store/            # Zustand store
│   │   │   ├── api/              # API client
│   │   │   └── components/
│   │   └── package.json
│   │
│   └── extension/                # Chrome MV3
│       ├── src/
│       │   ├── background/       # service worker
│       │   ├── content/          # content script (autofill)
│       │   ├── popup/            # React popup
│       │   └── crypto/           # WASM bundle
│       └── manifest.json
│
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── .env.example
│   └── traefik/
│
└── migrations/                   # SQLx migrations
    ├── 001_init.sql
    └── ...
```

---

## 7. Sync Engine Design

### MVP: Encrypted Snapshot Sync

The sync model for MVP is deliberately simple:

```
SYNC FLOW (client perspective):

1. PULL
   GET /vault/sync?after={last_sync_version}
   → Returns: [{blob_id, collection_id, version, blob_url, deleted}]
   → Client downloads changed blobs from S3
   → Client decrypts blobs with CK
   → Client merges into local DB (last-write-wins on version number)

2. PUSH
   POST /vault/sync
   Body: [{collection_id, encrypted_blob, client_version}]
   → Server stores blob in S3
   → Server updates version counter
   → Returns: [{blob_id, server_version}]
```

### Conflict Resolution (MVP)

Strategy: **Last Write Wins (LWW)** with monotonic version numbers.

```
Client version < Server version → server wins, client discards local change
Client version = Server version → safe to overwrite
Client version > Server version → impossible (server is authoritative)
Concurrent writes to same entry → detected by version mismatch → client re-fetches
```

### Conflict Resolution (v2)

Introduce CRDT-style per-field timestamps:
- Each vault entry field has a `modified_at` timestamp
- Field-level merge: take the value with the highest `modified_at`
- Conflicts surfaced to user only when timestamps are identical and values differ

### Offline Queue

Local SQLite DB (via Tauri) queues operations when offline:

```sql
CREATE TABLE offline_queue (
  id          INTEGER PRIMARY KEY,
  op_type     TEXT NOT NULL,  -- 'create' | 'update' | 'delete'
  entry_id    TEXT NOT NULL,
  encrypted   BLOB NOT NULL,
  collection  TEXT NOT NULL,
  queued_at   INTEGER NOT NULL,
  retry_count INTEGER DEFAULT 0
);
```

On reconnect: flush queue in order → resolve conflicts → update local state.

### Version Model

```
server_version: i64  — global monotonic counter per org
entry_version: i64   — monotonic counter per collection blob
client_cursor: i64   — "I have all changes up to this version"
```

---

## 8. Database Schema

### PostgreSQL Tables

```sql
-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  email_verified        BOOLEAN DEFAULT FALSE,
  argon2_salt           BYTEA NOT NULL,           -- 32 random bytes
  argon2_params         JSONB NOT NULL,           -- {m_cost, t_cost, p_cost}
  -- Keys stored as base64url strings
  public_key            TEXT NOT NULL,            -- X25519 public key
  encrypted_private_key TEXT NOT NULL,            -- XChaCha20 encrypted
  signing_public_key    TEXT NOT NULL,            -- Ed25519 public key
  -- Metadata
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DEVICES
-- ============================================================
CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL,  -- 'desktop' | 'web' | 'mobile' | 'extension'
  public_key      TEXT NOT NULL,  -- Device-specific Ed25519 key
  trust_level     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'trusted' | 'revoked'
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, public_key)
);

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,           -- Could be encrypted in v2
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE org_members (
  org_id    UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' | 'manager' | 'viewer'
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

-- ============================================================
-- COLLECTIONS
-- ============================================================
CREATE TABLE collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES orgs(id) ON DELETE CASCADE,  -- NULL = personal
  owner_id    UUID NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,    -- Collection name (encrypt in v2)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Wrapped collection keys — one row per (user, collection) pair
CREATE TABLE wrapped_collection_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key     TEXT NOT NULL,  -- base64url(XChaCha20(CK, user_public_key))
  key_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection_id, user_id)
);

-- ============================================================
-- VAULT BLOBS (metadata only — contents in S3)
-- ============================================================
CREATE TABLE vault_blobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  blob_path     TEXT NOT NULL,        -- S3 key: "blobs/{collection_id}/{version}"
  version       BIGINT NOT NULL,
  size_bytes    INTEGER,
  deleted       BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_blobs_collection ON vault_blobs(collection_id, version);

-- ============================================================
-- SYNC STATE
-- ============================================================
CREATE TABLE sync_cursors (
  user_id         UUID NOT NULL REFERENCES users(id),
  device_id       UUID NOT NULL REFERENCES devices(id),
  collection_id   UUID NOT NULL REFERENCES collections(id),
  last_version    BIGINT NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id, collection_id)
);

-- ============================================================
-- AUDIT LOG (append-only)
-- ============================================================
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  device_id   UUID REFERENCES devices(id),
  action      TEXT NOT NULL,     -- 'vault.sync', 'key.rotate', 'member.add'
  target_id   UUID,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### S3/MinIO Bucket Layout

```
kairox-vault/
├── blobs/
│   └── {collection_id}/
│       └── {version}.enc       # Full encrypted snapshot per version
├── backups/
│   └── {org_id}/
│       └── {date}/
│           └── full.enc        # Encrypted full backup
└── tmp/
    └── {upload_id}             # Multipart upload staging
```

---

## 9. API Design

All endpoints require `Authorization: Bearer {jwt}` unless marked public.

### Auth Endpoints

```
POST /auth/register
  Body:  { email, argon2_salt, argon2_params, public_key,
           encrypted_private_key, signing_public_key }
  Returns: { user_id }
  Note: Server never sees password. Client derives keys first.

POST /auth/challenge        [public]
  Body:  { email }
  Returns: { challenge_nonce, argon2_salt, argon2_params }
  Note: Client uses salt to derive auth key, signs challenge

POST /auth/session          [public]
  Body:  { email, signed_challenge, device_id }
  Returns: { access_token, refresh_token }
  Note: Auth key is derived from master key via HKDF — never the master key itself

POST /auth/logout
  Body:  { refresh_token }
  Returns: 204

POST /auth/refresh          [semi-public]
  Body:  { refresh_token }
  Returns: { access_token }
```

### Device Endpoints

```
POST /devices/register
  Body:  { name, platform, public_key }
  Returns: { device_id, trust_level }

GET /devices
  Returns: [{ device_id, name, platform, last_seen_at, trust_level }]

POST /devices/{id}/trust
  Returns: { trust_level: "trusted" }

DELETE /devices/{id}
  Returns: 204
```

### Vault / Sync Endpoints

```
GET /vault/sync?after={version}&collections[]={id}
  Returns: [{ blob_id, collection_id, version, blob_url, deleted }]
  Note: blob_url is a pre-signed S3 URL (15 min expiry)

POST /vault/sync
  Body:  [{ collection_id, client_version, size_bytes }]
  Returns: [{ blob_id, upload_url, server_version }]
  Note: Client uploads to upload_url directly, then confirms

POST /vault/sync/{blob_id}/confirm
  Body:  { etag }
  Returns: { server_version }

DELETE /vault/entries/{id}
  Returns: 204 (tombstone record kept for sync)
```

### Collection + Key Endpoints

```
GET /collections
  Returns: [{ id, name, org_id, key_version }]

POST /collections
  Body:  { name, org_id?, wrapped_key }
  Returns: { id }

GET /collections/{id}/keys
  Returns: { wrapped_key, key_version }

POST /collections/{id}/members
  Body:  { user_id, wrapped_key, signed_proof }
  Returns: 201
  Note: signed_proof = Ed25519 signature proving sender knows CK

DELETE /collections/{id}/members/{user_id}
  Returns: 204 (does NOT rotate key — caller must trigger rotation separately)

POST /collections/{id}/rotate
  Body:  { new_wrapped_keys: [{ user_id, wrapped_key }], blob_id }
  Returns: { key_version }
```

### Org Endpoints

```
POST /orgs
  Body:  { name }
  Returns: { id }

GET /orgs/{id}/members
  Returns: [{ user_id, email, role, public_key }]

POST /orgs/{id}/invites
  Body:  { email, role }
  Returns: { invite_token }

POST /orgs/{id}/invites/{token}/accept
  Returns: { user_id, wrapped_keys: [] }
```

---

## 10. Browser Extension (MV3)

### Architecture

```
Extension processes:

Service Worker (background.js)
  - Holds session token (in-memory only, never localStorage)
  - Vault cache (decrypted, in-memory, cleared on lock)
  - Handles API calls
  - Responds to content script requests via chrome.runtime.sendMessage
  - Alarms API for auto-lock timer

Content Script (content.js)
  - Injected ONLY into https:// pages (never http://)
  - Detects login forms via heuristics (input[type=password] + nearby inputs)
  - Sends fill requests to service worker (never handles credentials directly)
  - Validates current tab URL before any fill action

Popup (popup.html)
  - React app
  - Shows matching credentials for current tab
  - Unlock vault UI
  - Uses chrome.runtime.sendMessage to service worker
```

### Autofill Security

```javascript
// content.js — origin validation before fill
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  // Only respond to messages from our own service worker
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'FILL_CREDENTIALS') {
    // Double-check current location matches expected origin
    const currentOrigin = window.location.origin;
    if (currentOrigin !== msg.expectedOrigin) {
      console.warn('[kairox] Origin mismatch — fill blocked');
      return;
    }
    fillForm(msg.username, msg.password);
  }
});
```

### Phishing Protection

- URL matching uses **registered domain** (eTLD+1), not full URL.
- `https://login.paypal.com.evil.com` → registered domain `evil.com` → no match.
- Uses `tldts` or `publicsuffix.org` list for parsing.
- Show full URL to user before filling (no silent autofill).
- HTTPS-only: extension never fills on `http://` pages.

### Permissions (manifest.json)

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "alarms", "activeTab"],
  "host_permissions": ["https://your-server-domain/*"],
  "content_scripts": [{
    "matches": ["https://*/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

Minimal permissions: `activeTab` only (not `tabs` — reduces attack surface).

---

## 11. Self-Hosting (Docker Compose)

### docker-compose.yml

```yaml
version: "3.9"

services:
  api:
    image: ghcr.io/yourorg/kairox-api:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      DATABASE_URL: ${DATABASE_URL}
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: ${S3_BUCKET:-kairox-vault}
      S3_ACCESS_KEY: ${MINIO_ROOT_USER}
      S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      RUST_LOG: info
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`${DOMAIN}`) && PathPrefix(`/api`)"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
    networks: [kairox]

  web:
    image: ghcr.io/yourorg/kairox-web:latest
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.web.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.web.tls.certresolver=letsencrypt"
    networks: [kairox]

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-kairox}
      POSTGRES_USER: ${POSTGRES_USER:-kairox}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-kairox}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks: [kairox]

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks: [kairox]

  traefik:
    image: traefik:v3
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/certs
      - ./traefik/traefik.yml:/etc/traefik/traefik.yml:ro
    networks: [kairox]

volumes:
  postgres_data:
  minio_data:
  traefik_certs:

networks:
  kairox:
    driver: bridge
```

### .env.example

```bash
# Domain
DOMAIN=vault.yourdomain.com

# Database
POSTGRES_DB=kairox
POSTGRES_USER=kairox
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DATABASE_URL=postgresql://kairox:CHANGE_ME@postgres:5432/kairox

# MinIO
MINIO_ROOT_USER=CHANGE_ME_ACCESS_KEY
MINIO_ROOT_PASSWORD=CHANGE_ME_SECRET_KEY_32CHARS
S3_BUCKET=kairox-vault

# JWT — generate with: openssl rand -base64 64
JWT_SECRET=CHANGE_ME_GENERATE_RANDOM_SECRET
```

### Production Hardening Checklist

```
□ Run API container as non-root user (USER 1001 in Dockerfile)
□ Mount volumes with :ro where possible
□ Set POSTGRES_PASSWORD to 32+ char random string
□ JWT_SECRET minimum 64 bytes, random
□ Enable Traefik TLS with Let's Encrypt (not self-signed)
□ Restrict MinIO to internal network (no public port exposure)
□ Enable PostgreSQL SSL connection
□ Set up daily automated backups (pg_dump → encrypt → S3)
□ Configure rate limiting in Traefik (100 req/s per IP)
□ Enable security headers: HSTS, CSP, X-Frame-Options
□ Monitor with Prometheus + Grafana (optional)
□ Log rotation configured
□ Regular security updates via Watchtower or manual
```

---

## 12. Threat Model

### T1 — Server/Database Compromise

**Attack:** Attacker gains full read access to PostgreSQL and S3.

**Mitigation:** All vault content is encrypted. They obtain:
- Encrypted blobs (useless without CK)
- Wrapped CKs (useless without user private key)
- Encrypted private keys (useless without master key)
- Email addresses (exposed — use breach notification)
- Argon2 salts (not useful alone — need the password)

**Residual risk:** Email enumeration. Consider hashing emails server-side.

---

### T2 — Malicious Server / Admin Abuse

**Attack:** Malicious server returns a fake public key for a user during key wrapping.

**Mitigation:**
- Key pinning: clients cache public keys and warn on change.
- Key transparency log: append-only log of public key changes (future).
- Out-of-band verification: users can compare key fingerprints.
- For MVP: warn on public key changes, require re-authentication to accept new key.

---

### T3 — MITM (Man-in-the-Middle)

**Attack:** Network attacker intercepts API traffic.

**Mitigation:**
- TLS 1.3 required (Traefik enforces this).
- Certificate pinning in Tauri desktop app (custom TLS config).
- HSTS header with `includeSubDomains` and `preload`.
- All API communication over HTTPS only.

---

### T4 — Replay Attacks

**Attack:** Attacker replays a captured upload request with stale ciphertext.

**Mitigation:**
- JWT tokens have short expiry (15 min access, 30 day refresh).
- Upload confirmations require ETag from S3 (proves actual upload).
- Sync version numbers are server-monotonic (replay of old version rejected).
- Challenge-response for auth (challenge_nonce is single-use).

---

### T5 — Browser Extension Vulnerabilities

**Attack:** Malicious web page script exfiltrates credentials via XSS.

**Mitigation:**
- Content script never holds decrypted credentials.
- All credential access goes through service worker (isolated process).
- Service worker validates origin before sending fill message.
- Autofill never fires on `http://` pages.
- CSP in extension popup prevents inline scripts.
- No `eval()`, no remote scripts in extension.

---

### T6 — Device Theft (Device Compromise)

**Attack:** Physical device stolen while vault is unlocked.

**Mitigation:**
- Auto-lock timer (configurable, default 5 min idle).
- Biometric re-auth for unlock (Tauri on desktop, WebAuthn on web).
- Remote device revocation via another device.
- Master key is in-memory only — not written to disk.
- Tauri: use OS keychain for session token, not flat file.

---

### T7 — Downgrade Attacks

**Attack:** Server returns old vault blob version to serve stale/malicious data.

**Mitigation:**
- Clients track last-seen version per collection.
- Reject blobs with version < last-seen-version.
- Version number is signed in the blob header (v2).
- Traefik enforces TLS 1.3 only (no protocol downgrade).

---

### T8 — Phishing

**Attack:** Fake login page harvests master password.

**Mitigation:**
- Extension shows domain in UI — users learn to check.
- Consider passkey/WebAuthn as master auth (phishing-resistant by design).
- Never ask for master password in extension popup (only in dedicated unlock screen).
- Educate users: password prompt should only appear on the vault's own domain.

---

## 13. Implementation Roadmap

### Phase 0 — Cryptographic Core (Week 1-2)

**Goal:** `kairox-crypto` crate, fully tested, no UI.

```
□ Implement Argon2id key derivation
□ Implement XChaCha20-Poly1305 encrypt/decrypt
□ Implement X25519 ECDH key wrapping
□ Implement VaultEntry serialization (MessagePack or CBOR)
□ Implement key hierarchy (master → symmetric → wrap private key)
□ Implement collection key generation + wrapping
□ Write unit tests for all crypto operations
□ Write property-based tests (proptest): encrypt→decrypt roundtrip
□ Write fuzz targets (cargo-fuzz): decrypt with random inputs
□ Compile to WASM, verify JS bindings work
```

**Critical constraint:** `kairox-crypto` must compile with `no_std` + `alloc` for WASM.

---

### Phase 1 — Server MVP (Week 3-5)

**Goal:** Working API that stores/retrieves encrypted blobs.

```
□ Set up Axum project structure
□ SQLx + PostgreSQL migrations
□ Auth: register, challenge, session endpoints
□ Device registration
□ Vault blob upload/download (pre-signed S3 URLs)
□ Wrapped key CRUD
□ JWT middleware
□ Basic rate limiting
□ Docker Compose working: postgres + minio + api
□ Integration tests for all endpoints
```

---

### Phase 2 — Desktop App MVP (Week 6-9)

**Goal:** Working Tauri app that can unlock, display, and edit vault.

```
□ Tauri project setup with React frontend
□ Master password unlock → key derivation → store in memory
□ Fetch + decrypt vault entries
□ Create/edit/delete vault entries
□ Collection key management
□ Basic sync (full snapshot)
□ Auto-lock
□ OS keychain for session token
```

---

### Phase 3 — Web App (Week 10-12)

**Goal:** Same features as desktop, running in browser.

```
□ WASM bundle with kairox-crypto-wasm
□ React web app sharing components with Tauri frontend
□ Session management (memory only, no localStorage for secrets)
□ Full sync
□ Progressive Web App manifest (offline support)
```

---

### Phase 4 — Multi-User & Organizations (Week 13-16)

**Goal:** Invite users, share collections.

```
□ Organization creation and management
□ User invitation flow
□ Key distribution (wrap CK for new member)
□ Role assignment
□ Collection key rotation
□ User revocation
```

---

### Phase 5 — Browser Extension (Week 17-20)

**Goal:** Chrome MV3 extension with autofill.

```
□ Extension manifest and service worker setup
□ Popup UI (React)
□ Native app communication (or standalone API client)
□ Form detection
□ Autofill with origin validation
□ Phishing protection
□ Auto-lock synced with desktop app (if native messaging)
```

---

## 14. Design Traps to Avoid

### Crypto Traps

| Trap | Why Bad | Do Instead |
|------|---------|------------|
| Deriving auth token directly from master key | Compromise of auth token = master key exposed | Use HKDF to derive separate auth key |
| Sequential nonces for AEAD | Nonce reuse with same key = catastrophic | Random 24-byte nonces (XChaCha20's extended nonce) |
| Storing master key or CK on server (even encrypted) | Trust boundary violation | Keys live on client only |
| SHA256(password) as encryption key | Trivially brute-forced | Always Argon2id |
| RSA for key wrapping | Larger keys, more footguns | X25519 ECDH |
| AES-GCM with 96-bit nonces | Nonce collision at 2^48 messages | XChaCha20-Poly1305 (192-bit nonce) |
| Relying on server-side ACLs for privacy | Server compromise = data exposed | Cryptographic key ownership |

### Architecture Traps

| Trap | Why Bad | Do Instead |
|------|---------|------------|
| Storing decrypted data in localStorage | Browser extension can steal it | In-memory only, zeroize on lock |
| Single vault blob for all collections | One user = full re-download for all | Per-collection blobs |
| Sync via `updated_at` only | Clock skew causes data loss | Monotonic version numbers |
| Rolling your own crypto primitives | Almost certainly wrong | Use `RustCrypto` crates |
| Trusting content script with credentials | Isolated DOM = XSS accessible | Credentials only in service worker |
| Complex DB ACL system | Orthogonal to crypto security, false sense of safety | Keep DB simple, rely on crypto |
| Password-derived key sent to server for auth | Server learns master key derivative | Challenge-response; HKDF for auth key |

### Operational Traps

| Trap | Why Bad | Do Instead |
|------|---------|------------|
| No key rotation support | Cannot revoke access properly | Design rotation into schema from day 1 |
| No device revocation | Stolen device = permanent access | Device trust model with revocation list |
| Backup of plaintext decryption | Backups bypass all security | Backup encrypted blobs only |
| Long-lived access tokens (days) | Compromise window is huge | 15 min access token, 30 day refresh |
| No audit logging | Cannot detect breaches | Append-only audit log for all sensitive actions |

---

## Appendix: Recommended Rust Crates

```toml
# Cryptography
argon2 = { version = "0.5", features = ["zeroize"] }
chacha20poly1305 = "0.10"
x25519-dalek = { version = "2", features = ["static_secrets", "zeroize"] }
ed25519-dalek = { version = "2", features = ["zeroize"] }
hkdf = "0.12"
sha2 = "0.10"
rand = { version = "0.8", features = ["getrandom"] }
zeroize = { version = "1", features = ["derive"] }
secrecy = "0.8"

# Serialization
serde = { version = "1", features = ["derive"] }
ciborium = "0.2"        # CBOR — compact binary, works in no_std
base64ct = "1"          # Constant-time base64

# Web / API
axum = "0.7"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio-rustls", "uuid", "chrono"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["trace", "cors"] }
jsonwebtoken = "9"

# Storage
aws-sdk-s3 = "1"        # Works with MinIO

# WASM
wasm-bindgen = "0.2"
js-sys = "0.3"
getrandom = { version = "0.2", features = ["js"] }

# Testing
proptest = "1"
cargo-fuzz = "0.12"     # dev tool
```

---

*End of Architecture Document v0.1*whats
# 🔐 Kairox-password-vault

A self-hostable, zero-knowledge, multi-user password vault system built for individuals, teams, and organizations.

Designed with a Rust cryptographic core and a strict security principle:

> The server stores data, not secrets.

---

## 🌌 What this is

`kairox-password-vault` is a distributed password management system where:

* Every secret is encrypted on the client
* The server never sees plaintext data
* Access control is enforced through cryptographic keys, not database rules
* Teams can securely share vaults without trusting the server

Think of it as:

> encrypted vault collections shared through math, not permissions

---

## 🔐 Core principles

### 🧠 Zero-Knowledge by design

* No plaintext passwords stored server-side
* No master passwords on the backend
* Server only handles encrypted blobs and wrapped keys

### 🧬 Cryptographic access control

Instead of server-side roles, access is determined by keys:

* Users possess identity keypairs
* Vault data is split into **collections**
* Each collection has a **Collection Key (CK)**
* CK is encrypted per user (“key wrapping”)

If you can decrypt the key, you have access.

---

## 👥 Multi-user model

### Organizations

Users belong to organizations containing shared vault collections.

### Collections

Vault is split into logical encrypted groups:

* Personal vault
* Team vaults
* Finance vault
* Admin vault

Each collection:

* has its own encryption key
* is independent
* can be shared selectively

---

## 🧩 Access control model

There are no server-enforced roles.

Instead:

### Roles = key bundles

| Role    | Meaning                   |
| ------- | ------------------------- |
| Admin   | Has all collection keys   |
| Manager | Has subset of collections |
| Viewer  | Read-only subset          |

### How access works

1. Collection data is encrypted with a Collection Key (CK)
2. CK is encrypted for each authorized user using their public key
3. Users decrypt CK locally
4. Users decrypt vault entries locally

The server cannot determine access rights.

---

## 🧬 Cryptography design

### Key hierarchy

```text id="crypt1"
Master Password
   ↓ Argon2id
Master Key
   ↓
User Identity Keypair
   ↓
Collection Key (CK)
   ↓
Encrypted Vault Entries
```

### Algorithms

* Key derivation: Argon2id
* Encryption: XChaCha20-Poly1305
* Key wrapping: public-key encryption
* Secure random: OS entropy sources
* Memory safety: zeroization on drop

---

## 🔄 Key rotation & revocation

To revoke a user:

* Remove their wrapped Collection Keys
* Optionally rotate Collection Keys
* Re-encrypt affected data client-side

> Revocation is cryptographic, not administrative.

---

## 🧱 System architecture

```text id="arch1"
Clients
  ├── Web App (React)
  ├── Desktop App (Tauri)
  ├── Browser Extension (MV3)
  └── Mobile App (future)
          │
          ▼
   Rust Crypto SDK (WASM + Native)
          │
          ▼
     API Server (Rust / Axum)
          │
   ┌──────┴────────┐
   ▼               ▼
PostgreSQL     Object Storage (encrypted vaults)
                (MinIO / S3)
```

---

## 🐳 Self-hosting

Run the entire system locally or on a VPS:

```bash id="docker1"
git clone https://github.com/your-org/kairox-password-vault
cd kairox-password-vault

cp .env.example .env
docker compose up -d
```

---

## 📦 Services included

* Rust API server (Axum)
* PostgreSQL (metadata + sync state)
* MinIO (encrypted vault storage)
* Reverse proxy (Traefik or Nginx)

---

## 🔐 Security model

### What the server knows

* User IDs
* Encrypted vault blobs
* Wrapped collection keys
* Device metadata

### What the server NEVER knows

* Master passwords
* Decryption keys
* Vault contents
* Collection access meaning

---

## 🌐 Sync model

### MVP: Snapshot sync

* Entire vault encrypted per collection
* Uploaded as encrypted blobs
* Clients resolve conflicts locally

### Future:

* delta sync
* CRDT-based merging
* real-time sync via websockets

---

## 🧠 Browser extension (MV3)

* Autofill passwords securely
* Strict origin validation
* No page context exposure
* Secure messaging to desktop/native app
* Minimal permissions

---

## 🧩 Repository structure

```text id="repo1"
apps/
  web/
  desktop/
  extension/

backend/
  api/
  workers/

crates/
  crypto/
  vault/
  sync/
  sdk/

deploy/
  docker-compose.yml
  traefik/
  minio/

docs/
```

---

## ⚠️ Threat model

The system is designed to withstand:

* server compromise
* database leaks
* malicious hosting providers
* MITM attempts
* stolen backups
* browser extension attacks (partially mitigated)

Not fully protected against:

* compromised client devices
* keyloggers
* malware on user machines

---

## 🚀 Roadmap

### Phase 1 (MVP)

* Vault encryption engine
* single-user vaults
* basic sync API
* web UI

### Phase 2

* multi-user organizations
* collection-based access control
* browser extension
* desktop app

### Phase 3

* mobile support
* secure sharing UX
* key rotation automation
* passkey unlock

---

## 🧊 Philosophy

> - Security is not permissions enforced by a server.
> - Security is what remains true even if the server lies.
> - Your secrets should exist everywhere you need them, but nowhere they can be seen.

---

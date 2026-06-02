# Kairox Password Vault

A self-hostable, zero-knowledge password manager for individuals and teams.

> **The server stores data, not secrets.**

All encryption and decryption happens on the client. The server handles only encrypted blobs and cryptographically wrapped keys — it cannot read vault contents under any circumstances.

---

## Features

- **Zero-knowledge** — master passwords and encryption keys never leave the client
- **Multi-user** — share vault collections with teams via cryptographic key wrapping
- **Self-hostable** — single `docker compose up -d` deployment
- **Cross-platform** — web app, desktop (Tauri), and browser extension (Chrome MV3)
- **Offline-capable** — vault data is decrypted locally; API calls only for sync

---

## Cryptography

| Primitive | Algorithm |
| --- | --- |
| Key derivation | Argon2id (64 MiB, 3 iterations, 4 lanes) |
| Symmetric encryption | XChaCha20-Poly1305 |
| Key wrapping | X25519 ECDH + HKDF-SHA256 |
| Subkey derivation | HKDF-SHA256 (domain-separated) |
| Memory safety | `zeroize` + `secrecy` — keys zeroed on drop |

**Key hierarchy:**

```text
Master Password
   ↓  Argon2id
Master Key (32 bytes)
   ↓  HKDF  (domain: "kairox-symmetric-v1")
Symmetric Key  →  encrypts vault entries
   ↓  HKDF  (domain: "kairox-identity-v1")
X25519 Identity Keypair  →  receives wrapped Collection Keys
```

Each vault **collection** has its own random Collection Key (CK). The CK is encrypted ("wrapped") for every authorized user using their X25519 public key. Access is purely cryptographic — removing a user means revoking their wrapped key.

---

## Repository layout

```text
crates/
  kairox-crypto/    Rust crypto core → compiles to WASM + native rlib
  kairox-types/     Shared domain types (VaultEntry, EncryptedEntry, WrappedKey)
  kairox-api/       Axum API server

sdk/                TypeScript SDK — wraps the WASM crypto in a Web Worker
web/                React web app + Tauri desktop app (src-tauri/)
extension/          Chrome MV3 browser extension

src/lib.rs          Workspace root placeholder
Dockerfile          Multi-stage build for kairox-api
docker-compose.yml  API server + PostgreSQL
justfile            Dev task runner
```

---

## Quick start (Docker)

```bash
git clone https://github.com/nathan6552/kairox-password-vault
cd kairox-password-vault

cp .env.example .env
# Edit .env — at minimum set a strong JWT_SECRET

docker compose up -d
```

The API server starts on port 3000. Open the web app separately (see below) or build it into a static bundle served by the API.

---

## Development setup

**Prerequisites:** Rust, Node.js 20+, [wasm-pack](https://rustwasm.github.io/wasm-pack/), [just](https://github.com/casey/just)

```bash
# 1. Build the WASM crypto package
just wasm

# 2. Install JS dependencies and build the SDK
just sdk-install
just sdk-build

# 3. Start a local Postgres container + the API server
just db-start
just dev          # cargo run -p kairox-api  →  localhost:3000

# 4. Start the web dev server (separate terminal)
just web-dev      # Vite  →  http://localhost:5173
```

All `just` recipes are in [justfile](justfile).

---

## Browser extension

The Chrome MV3 extension lives in `extension/`. After building, load `extension/dist/` as an unpacked extension in `chrome://extensions`.

```bash
cd extension
npm install
npm run build
```

Features: autofill on HTTPS login forms, Shadow DOM overlay, origin validation to prevent cross-site credential injection, auto-lock via `chrome.alarms`.

---

## What the server knows

| Stored | Not stored |
| --- | --- |
| User IDs, email, Argon2 salt | Master passwords |
| Encrypted vault blobs | Plaintext vault entries |
| Wrapped Collection Keys | Decryption keys |
| JWT auth tokens | Collection membership meaning |

The server cannot distinguish a read from a write, or determine which entries belong to which user, without the client's keys.

---

## Security model

- **Server compromise** — attacker gets encrypted blobs only; useless without client keys
- **Database leak** — same as above; all sensitive data is ciphertext
- **Malicious admin** — cannot read vault contents; can only delete data
- **MITM** — mitigated by TLS; auth key is a hash-of-hash, not the master key
- **Autofill phishing** — extension validates exact domain + port before serving credentials
- **Not covered** — compromised client device, keyloggers, malware

---

## Roadmap

- [x] Crypto core (Argon2id, XChaCha20-Poly1305, X25519 ECIES)
- [x] API server (Axum + PostgreSQL + JWT)
- [x] TypeScript SDK with WASM Web Worker isolation
- [x] React web app
- [x] Tauri desktop app
- [x] Chrome MV3 browser extension with autofill
- [ ] Key rotation UI
- [ ] Delta sync (currently full snapshot per collection)
- [ ] Passkey / WebAuthn unlock
- [ ] Mobile (React Native or Flutter)
- [ ] Firefox extension

---

## License

[MIT](LICENSE)

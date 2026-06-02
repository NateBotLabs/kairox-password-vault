-- Users: email + argon2(auth_key) verifier + X25519 public key (32 bytes).
-- The server never sees the master password or symmetric key.
CREATE TABLE IF NOT EXISTS users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    auth_hash   TEXT        NOT NULL,   -- argon2(auth_key derived from MasterKey)
    public_key  BYTEA       NOT NULL,   -- X25519 public key, 32 bytes
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Collections: logical groups of encrypted entries.
-- The collection name / metadata lives inside encrypted entries, not here.
CREATE TABLE IF NOT EXISTS collections (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wrapped keys: the Collection Key encrypted per authorized user.
-- wrapped_bytes = keywrap::wrap_key(user_public_key, collection_key, collection_id_as_aad)
-- The server stores this opaque blob; it cannot derive the Collection Key.
CREATE TABLE IF NOT EXISTS wrapped_keys (
    collection_id   UUID    NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id         UUID    NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    key_version     INTEGER NOT NULL DEFAULT 1,
    wrapped_bytes   BYTEA   NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (collection_id, user_id)
);

-- Encrypted vault entries. ciphertext = aead::encrypt(collection_key, cbor(VaultEntry), entry_id_as_aad)
CREATE TABLE IF NOT EXISTS entries (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id   UUID        NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    version         INTEGER     NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ciphertext      BYTEA       NOT NULL
);

CREATE INDEX IF NOT EXISTS entries_collection_idx ON entries(collection_id);

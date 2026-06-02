// ── Base64 ────────────────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  // Works in all modern browsers and Node 16+
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ── UUID helpers ──────────────────────────────────────────────────────────────

/** Generate a random UUID v4 as a lowercase hex string (no dashes). */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Set version 4 and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Convert a UUID hex string (32 hex chars, no dashes) to a 16-byte Uint8Array. */
export function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── VaultEntry serialization ──────────────────────────────────────────────────
// Using JSON for simplicity. The server stores only the opaque ciphertext, so
// the format is an internal detail of the client.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeEntry(entry: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(entry));
}

export function decodeEntry<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

// ── Timestamp ─────────────────────────────────────────────────────────────────

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

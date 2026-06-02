/**
 * Copies the compiled WASM artifact into public/wasm/ before every build.
 * Run wasm-pack build --target web in crates/kairox-crypto first.
 */
const { mkdirSync, copyFileSync, existsSync } = require('fs');
const path = require('path');

const src  = path.resolve(__dirname, '../../crates/kairox-crypto/pkg/kairox_crypto_bg.wasm');
const dest = path.resolve(__dirname, '../public/wasm/kairox_crypto_bg.wasm');

mkdirSync(path.dirname(dest), { recursive: true });

if (!existsSync(src)) {
  console.warn(
    '[kairox-extension] WASM not found at', src,
    '\nRun: cd crates/kairox-crypto && wasm-pack build --target web',
  );
  process.exit(0); // non-fatal during development
}

copyFileSync(src, dest);
console.log('[kairox-extension] Copied', path.basename(src), '→ public/wasm/');

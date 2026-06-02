import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Point directly at the SDK source so Vite resolves worker.ts correctly.
      // The built dist/ references './worker.ts' which doesn't exist there —
      // Vite returns an HTML 404, causing a MIME-type rejection in the browser.
      '@kairox/sdk': path.resolve(__dirname, '../sdk/src/index.ts'),
    },
  },

  // Don't pre-bundle the WASM package — it contains binary assets Vite
  // can't process, and the generated JS handles its own fetch internally.
  optimizeDeps: {
    exclude: ['kairox-crypto-wasm'],
  },

  // Workers must be ES modules so they can `import` the WASM package
  worker: {
    format: 'es',
  },

  server: {
    fs: {
      // The SDK source lives outside the web project root (../sdk/src).
      // Without this Vite returns 403 for /@fs/…/sdk/src/worker.ts requests,
      // which the browser receives as HTML → empty ErrorEvent → "Worker error".
      allow: [path.resolve(__dirname, '..')],
    },

    // Required for SharedArrayBuffer / high-res timers used by some WASM runtimes
    headers: {
      'Cross-Origin-Opener-Policy':    'same-origin',
      'Cross-Origin-Embedder-Policy':  'require-corp',
      // 'wasm-unsafe-eval' allows WebAssembly compilation without permitting
      // arbitrary eval(). 'unsafe-inline' is required only in dev because
      // @vitejs/plugin-react injects an inline HMR preamble script.
      // These headers are never sent by `vite build` (production builds don't
      // use server.headers — set CSP via your reverse proxy / server instead).
      'Content-Security-Policy':       "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:",
    },
    // Proxy API calls so the dev server and API share the same origin
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});

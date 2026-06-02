import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: 'manifest.json',
      watchFilePaths: ['manifest.json'],
    }),
  ],
  resolve: {
    alias: {
      // Import SDK types, api client, and utils directly from source —
      // avoids pulling in VaultSession (which uses new Worker(), invalid in a SW)
      '$sdk/types': fileURLToPath(new URL('../sdk/src/types.ts', import.meta.url)),
      '$sdk/api':   fileURLToPath(new URL('../sdk/src/api.ts',   import.meta.url)),
      '$sdk/utils': fileURLToPath(new URL('../sdk/src/utils.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});

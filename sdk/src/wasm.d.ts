// Type declaration for Vite's ?url query suffix on .wasm files.
// Vite resolves the import to the asset's served URL at build time.
// Without this, tsc rejects the import in worker.ts.
declare module '*.wasm?url' {
  const url: string;
  export default url;
}

// wasm-bindgen-rayon resolves the package root for its nested workers.
// Keep the pinned vendor files byte-for-byte intact.
export function GET() {
  return new Response(
    'export * from "/zcash-wallet/engine/zcash_wallet_wasm.js"; export {default} from "/zcash-wallet/engine/zcash_wallet_wasm.js";',
    {
      headers: {
        "Content-Type": "text/javascript",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    },
  );
}

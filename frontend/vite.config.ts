import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import wails from "@wailsio/runtime/plugins/vite";
import { withContentSecurityPolicy } from "./src/lib/csp";

/**
 * The Quick Look extension loads its page with WKWebView's loadFileURL, so
 * the page is a file:// document. Module scripts are subject to CORS, which a
 * file:// origin cannot satisfy, so the bundle is built as one classic
 * script (IIFE, dynamic imports inlined) and its tag rewritten to match.
 */
function classicScript(): Plugin {
  return {
    name: "quicklook-classic-script",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(/<script type="module" crossorigin/g, "<script defer");
    },
  };
}

/** The app page's Content-Security-Policy, in production builds only. */
function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: withContentSecurityPolicy,
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `vite build --mode quicklook`: the preview page for the Quick Look
  // extension (quicklook/), built on its own so the app bundle is untouched
  // and the extension can carry the folder in its Resources. Relative paths
  // (base './') because it is loaded from disk, not served.
  if (mode === "quicklook") {
    return {
      base: "./",
      plugins: [svelte(), classicScript()],
      build: {
        outDir: "dist-quicklook",
        emptyOutDir: true,
        rollupOptions: {
          input: "quicklook.html",
          output: { format: "iife", inlineDynamicImports: true },
        },
      },
    };
  }
  return {
    server: {
      host: "127.0.0.1",
      port: Number(process.env.WAILS_VITE_PORT) || 9245,
      strictPort: true,
    },
    plugins: [svelte(), wails("./bindings"), contentSecurityPolicy()],
  };
});

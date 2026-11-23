import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser calls the API on its own origin (see src/shared/api/identity.ts:
// API_BASE is ""), because the session cookies are host-only __Host- cookies.
// In production the Cloudflare Worker reverse-proxies /api and /auth to the
// backend; in local development the page origin is this Vite server, so the
// API and Git prefixes are proxied to the Go API here.
// Override the backend address with API_PROXY_TARGET (default http://127.0.0.1:8080).
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": { target: apiProxyTarget },
      "/auth": { target: apiProxyTarget },
      "/git/": { target: apiProxyTarget },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
  },
});

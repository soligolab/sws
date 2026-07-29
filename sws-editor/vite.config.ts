import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Default proxy target for `pnpm dev`. The editor is an admin tool and connects
// to the admin port (8444). Override at the shell with
// `VITE_RUNTIME_URL=https://px30.local:8444 pnpm dev` to point the editor
// at a runtime running on another machine — useful for editing a project
// hosted on a device while developing on a laptop.
const RUNTIME_TARGET = process.env.VITE_RUNTIME_URL ?? "https://localhost:8444";
const WS_TARGET = RUNTIME_TARGET.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  server: {
    proxy: {
      "/api": {
        target: RUNTIME_TARGET,
        secure: false,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
            console.error("[api proxy]", err.message);
          });
        },
      },
      "/ws": {
        target: WS_TARGET,
        secure: false,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
            console.error("[ws proxy]", err.message);
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:  "index.html",
        admin: "index-admin.html",
      },
      output: {
        manualChunks(id) {
          // Stable vendor chunks — cached by the browser between app deploys.
          if (id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/react/")) {
            return "react-vendor";
          }
          if (id.includes("/node_modules/@codemirror/") ||
              id.includes("/node_modules/codemirror/")) {
            return "codemirror";
          }
          if (id.includes("/node_modules/@tanstack/")) {
            return "router";
          }
          if (id.includes("/node_modules/i18next") ||
              id.includes("/node_modules/react-i18next")) {
            return "i18n";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    // Solo i test unitari. `e2e/` sono spec Playwright: vitest le raccoglieva e
    // le contava come 5 file falliti a ogni esecuzione (fallisce l'import di
    // `@playwright/test` fuori dal suo runner), rendendo `pnpm test` rosso
    // sempre e quindi inutile come verifica. Le e2e girano con `pnpm test:e2e`.
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
});

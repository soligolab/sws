import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Default proxy target for `pnpm dev`. Override at the shell with
// `VITE_RUNTIME_URL=https://px30.local:8443 pnpm dev` to point the editor
// at a runtime running on another machine — useful for editing a project
// hosted on a device while developing on a laptop.
const RUNTIME_TARGET = process.env.VITE_RUNTIME_URL ?? "https://localhost:8443";
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
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
});

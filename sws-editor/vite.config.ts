import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://localhost:8443",
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
        target: "wss://localhost:8443",
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

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ── L'identità di QUESTO bundle ──────────────────────────────────────────────
//
// Fino al 09-10-2026 ogni «versione» visibile all'utente veniva dal binario
// Rust (`runtime_version`, da `GET /api/system`): nessuna descriveva il
// JavaScript in esecuzione. Con la pagina d'ingresso servita senza
// `Cache-Control`, il browser può tenersi un `index-admin.html` vecchio — e
// quello nomina i bundle con l'hash, quindi trattiene indietro tutto — mentre
// il server è aggiornato. Il maintainer lo ha vissuto, e ha chiesto «una
// data/ora di build e una revisione».
//
// Qui il timestamp si può incidere davvero: `vite.config.ts` viene valutato a
// ogni build, a differenza di un `build.rs` di cargo che cargo riesegue solo
// quando cambiano i suoi `rerun-if-changed` (per questo, lato Rust, la data è
// la mtime del binario e non un valore inciso).
const VERSIONE = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const GIT = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // Senza git — una build da sorgenti copiati — si dichiara di non saperlo
    // invece di inventare: un «sconosciuta» leggibile, non un trattino muto.
    return "sconosciuta";
  }
})();

// Default proxy target for `pnpm dev`. The editor is an admin tool and connects
// to the admin port (8444). Override at the shell with
// `VITE_RUNTIME_URL=https://px30.local:8444 pnpm dev` to point the editor
// at a runtime running on another machine — useful for editing a project
// hosted on a device while developing on a laptop.
const RUNTIME_TARGET = process.env.VITE_RUNTIME_URL ?? "https://localhost:8444";
const WS_TARGET = RUNTIME_TARGET.replace(/^http/, "ws");

export default defineConfig({
  define: {
    __SWS_VERSIONE__: JSON.stringify(VERSIONE),
    __SWS_GIT__: JSON.stringify(GIT),
    __SWS_BUILD_MS__: JSON.stringify(Date.now()),
  },
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
        // Finestra staccata dei log. È un file reale in `dist`, quindi il
        // runtime lo serve da `ServeDir` per match diretto: l'URL deve essere
        // esattamente `/index-log.html`, perché `/log` cadrebbe nel fallback
        // SPA e restituirebbe l'IDE (router.rs, not_found_service).
        log:   "index-log.html",
        // Finestra staccata della chat dell'assistente. Stesso vincolo del log:
        // l'URL deve essere esattamente `/index-chat.html`, perché `/chat`
        // cadrebbe nel fallback SPA e restituirebbe l'IDE.
        chat:  "index-chat.html",
        // La console di amministrazione (06-10-2026). **Applicazione a sé**,
        // non una schermata dell'IDE: da lì si decide su quale versione gira
        // ogni azienda, e lo strumento che governa le versioni non può essere
        // fissato a una di esse (decisione 44). Oggi la serve il runtime
        // dell'IDE, domani il gateway.
        // Stesso vincolo di log e chat sull'URL: `/index-console.html`
        // esatto, perché `/amministrazione` cadrebbe nel fallback SPA.
        console: "index-console.html",
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
    // Anche i test colocati in src/ (es. expr/engine.test.ts,
    // canvas/trendModel.test.ts): con il solo tests/** giravano MAI —
    // scoperto il 2026-08-23, i "7 test del motore espressioni" non erano
    // mai stati eseguiti davvero.
    include: ["tests/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
  },
});

/** Le immagini del progetto nel cloud (25-10-2026): un `<image href>` non manda
 *  la sessione, e l'URL `/api/…` andava alla radice del gateway (401). Nel
 *  cloud si scaricano col token sotto il prefisso del progetto; dal 30-10-2026
 *  anche in locale quando c'è una sessione vera. Senza sessione l'URL resta
 *  com'è. */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImmagineSvg, serveScaricare } from "../src/canvas/ImmagineSvg";
import { setAuthToken } from "../src/api/client";

const chiamate: { url: string; auth: string | null }[] = [];

beforeEach(() => {
  chiamate.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    chiamate.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization") });
    return new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200 });
  }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:prova" }));
});

afterEach(() => {
  setAuthToken(null);
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("le immagini del progetto nel disegno", () => {
  it("senza sessione (pannello, viewer anonimo, IDE senza utenti) l'URL resta quello", () => {
    expect(serveScaricare("/api/project/images/garage.jpeg")).toBe(false);
    const { container } = render(<svg><ImmagineSvg href="/api/project/images/garage.jpeg" /></svg>);
    expect(container.querySelector("image")?.getAttribute("href")).toBe("/api/project/images/garage.jpeg");
    expect(chiamate).toEqual([]);
  });

  it("nel cloud si scarica col token, sotto il prefisso del progetto", async () => {
    window.history.replaceState({}, "", "/p/-/CasaDomotica/");
    setAuthToken("tok-gateway");
    const { container } = render(<svg><ImmagineSvg href="/api/project/images/garage-cloud.jpeg" /></svg>);
    await waitFor(() => expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:prova"));
    expect(chiamate[0].url).toBe("/p/-/CasaDomotica/api/project/images/garage-cloud.jpeg");
    expect(chiamate[0].auth).toBe("Bearer tok-gateway");
  });

  // 30-10-2026: l'IDE locale ha i suoi utenti, e senza token
  // `/api/project/images/…` risponde 401 — lo sfondo della planimetria non si
  // vedeva. Il sentinella "no-auth" invece non è una sessione.
  it("in locale con una sessione vera si scarica col token", async () => {
    setAuthToken("no-auth");
    expect(serveScaricare("/api/project/images/planimetria.png")).toBe(false);
    setAuthToken("tok-ide");
    expect(serveScaricare("/api/project/images/planimetria.png")).toBe(true);
    const { container } = render(<svg><ImmagineSvg href="/api/project/images/planimetria.png" /></svg>);
    await waitFor(() => expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:prova"));
    expect(chiamate[0].url).toBe("/api/project/images/planimetria.png");
    expect(chiamate[0].auth).toBe("Bearer tok-ide");
  });

  it("un URL esterno non si tocca, nemmeno nel cloud", () => {
    window.history.replaceState({}, "", "/p/-/CasaDomotica/");
    expect(serveScaricare("https://esempio.it/foto.jpg")).toBe(false);
  });
});

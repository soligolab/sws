/** La foto di una pagina dev'essere completa (10-11-2026, collaudo della foto
 *  dal browser): tubi, `data_log`, `alarm_bell` e gli altri widget in HTML
 *  mancavano dal PNG, e una foto senza tubi inganna l'assistente.
 *
 *  - L'SVG va all'`Image` come `data:` **con** i `<foreignObject>`: così Chromium
 *    e Firefox li disegnano senza macchiare il canvas (come `blob:` invece sì —
 *    misurato col Chromium di playwright: `blob:` macchiato, `data:` rosso pieno).
 *  - Se il browser macchia lo stesso (`toBlob` lancia `SecurityError`), al loro
 *    posto va un segnaposto col nome del tipo, e lo dice un avviso.
 *
 *  jsdom non disegna: qui si guarda l'SVG che il browser riceverebbe. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { rasterizzaPagina, segnapostoHtml } from "../src/boot/rasterizza";
import type { SynopticPage } from "../src/types";

let svgs: string[] = [];
let macchia = 0;

beforeEach(() => {
  void i18n.changeLanguage("it");
  svgs = [];
  macchia = 0;
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "";
    set src(u: string) {
      if (u.startsWith("data:image/svg+xml")) svgs.push(decodeURIComponent(u.slice(u.indexOf(",") + 1)));
      setTimeout(() => this.onload?.(), 5);
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ fillRect() {}, drawImage() {}, measureText: (t: string) => ({ width: t.length * 7 }) }) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => {
    if (macchia > 0) {
      macchia -= 1;
      throw new DOMException("Tainted canvases may not be exported.", "SecurityError");
    }
    cb(new Blob(["png"], { type: "image/png" }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PAGINA: SynopticPage = {
  id: "p", name: "P", width: 800, height: 480, background: "#0f172a",
  objects: [
    { id: "tubo", type: "pipe", x: 100, y: 100, width: 300, height: 100, stroke: "#475569", stroke_width: 18,
      points: [{ x: 100, y: 120 }, { x: 250, y: 120 }, { x: 250, y: 200 }, { x: 400, y: 200 }] },
    { id: "campana", type: "alarm_bell", x: 500, y: 40, width: 64, height: 64 },
    { id: "registro", type: "data_log", x: 30, y: 260, width: 400, height: 200, tag: "t.p" },
  ],
};

describe("la foto di una pagina è completa", () => {
  it("una pagina con un tubo esce col tubo", async () => {
    await rasterizzaPagina(PAGINA);
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    // Il percorso del tubo passa dai suoi punti.
    expect(svg).toMatch(/<path[^>]*d="M\s*100[ ,]120/);
    expect(svg).toContain("#475569");
  });

  it("i widget in HTML restano nell'SVG, e l'SVG arriva come data:", async () => {
    const { avvisi } = await rasterizzaPagina(PAGINA);
    expect(svgs[0]).toContain("<foreignObject");
    expect(avvisi).toEqual([]);
  });

  it("se il browser macchia il canvas, segnaposto col nome del tipo e avviso", async () => {
    macchia = 1;
    const { avvisi } = await rasterizzaPagina(PAGINA);
    expect(svgs).toHaveLength(2);
    const seconda = svgs[1];
    expect(seconda).not.toContain("<foreignObject");
    expect(seconda).toContain(">alarm_bell<");
    expect(seconda).toContain(">data_log<");
    expect(seconda).toMatch(/<path[^>]*d="M\s*100[ ,]120/);
    expect(avvisi.join(" ")).toMatch(/alarm_bell/);
    expect(avvisi.join(" ")).toMatch(/data_log/);
  });

  it("il segnaposto non lascia passare markup dal nome", () => {
    expect(segnapostoHtml(0, 0, 10, 10, "<script>")).not.toContain("<script>");
  });
});

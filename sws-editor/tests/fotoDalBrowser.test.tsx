/** La foto di una pagina di un progetto web per l'assistente (10-11-2026).
 *
 *  Il server manda `fotografa` con la pagina che il modello vede, le bozze
 *  `prj:` compilate e gli sfondi del banco; il browser la disegna con lo stesso
 *  `SvgCanvas` dell'editor (`boot/rasterizza.ts`) e risponde con `foto`.
 *
 *  jsdom non sa disegnare un SVG su un canvas: qui si ferma il passaggio
 *  `Image` → `toBlob` e si guarda l'**SVG** che il browser avrebbe disegnato,
 *  che è dove le bozze e gli sfondi devono esserci. Il PNG finto ha la misura
 *  del canvas, così si prova anche che la foto è alla misura della pagina. */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";

const ascoltatori: ((m: unknown) => void)[] = [];
const fotoMandate: unknown[] = [];
vi.mock("@/ws/aiStream", () => ({
  ascolta: (fn: (m: unknown) => void) => { ascoltatori.push(fn); return () => {}; },
  chiedi: () => true,
  approvaSfondo: () => true,
  mandaFoto: (id: string, esito: unknown) => { fotoMandate.push({ id, ...(esito as object) }); return true; },
}));

import { fotografa, simboliUsati, type RichiestaFoto } from "../src/ai/fotoDalBrowser";
import { ChatPanel } from "../src/components/ChatPanel";
import { immagineInSospeso } from "../src/canvas/immaginiInSospeso";
import { impostaLibreriaPerTest, trovaSimboloLib } from "../src/symbols/lib/libreria";
import type { ManifestLib, SimboloLib } from "../src/symbols/lib/manifest";
import type { EditorAi } from "../src/ai/editor";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
const file = Object.fromEntries(manifesto.symbols.map((s) => [s.file, readFileSync(resolve(LIB, s.file), "utf8")]));
const pompa = manifesto.symbols.find((s) => s.id === "lib:process/centrifugal-pump")!;

// Una bozza dell'assistente: la pompa sotto un altro nome, con un segno
// riconoscibile nell'SVG.
const voce: SimboloLib = {
  ...pompa, id: "prj:bozza-foto", file: "prj/bozza-foto.svg", family: "project", kind: "project",
  label: "Bozza", labels: { it: "Bozza", en: "Draft" }, replaces: undefined,
};
const svgBozza = file["process/centrifugal-pump.svg"].replace("<defs>", "<defs><!--SEGNO-BOZZA-->");
const JPG = btoa("jpeg del banco");
const SRC = "/api/project/images/ai-sfondo-3.jpg";

function richiesta(): RichiestaFoto {
  return {
    pagina: {
      id: "nuova", name: "Nuova", width: 640, height: 400, background: "#ffffff",
      objects: [
        { id: "fondo", type: "image", x: 0, y: 0, width: 640, height: 400, src: SRC },
        { id: "b", type: "symbol", symbol_id: "prj:bozza-foto", x: 20, y: 20, width: 120, height: 100 },
      ],
    },
    simboli: [{ voce, svg: svgBozza }],
    sfondi: [{ src: SRC, jpg: JPG }],
    faceplates: [],
    misura: { larghezza: 640, altezza: 400 },
  };
}

/** Un PNG con solo l'intestazione: basta per leggerne la misura. */
function pngFinto(w: number, h: number): Blob {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return new Blob([b], { type: "image/png" });
}

let svgDisegnati: string[] = [];

function leggiByte(b: Blob): Promise<number[]> {
  return new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok([...new Uint8Array(r.result as ArrayBuffer)]);
    r.readAsArrayBuffer(b);
  });
}



beforeEach(() => {
  svgDisegnati = [];
  fotoMandate.length = 0;
  ascoltatori.length = 0;
  act(() => impostaLibreriaPerTest(manifesto, file));
  Element.prototype.scrollIntoView = () => {};
  // L'SVG arriva all'`Image` come `data:`: lo si legge da lì, e si "carica" subito.
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "";
    set src(u: string) {
      if (u.startsWith("data:image/svg+xml")) svgDisegnati.push(decodeURIComponent(u.slice(u.indexOf(",") + 1)));
      setTimeout(() => this.onload?.(), 10);
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return { fillRect() {}, drawImage() {}, measureText: (t: string) => ({ width: t.length * 7 }), fillStyle: "", font: "" } as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    cb(pngFinto(this.width, this.height));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("la foto dal browser", () => {
  it("disegna la pagina della richiesta alla sua misura, con la bozza prj: e lo sfondo del banco", async () => {
    const foto = await fotografa(richiesta());
    const testa = new DataView(Uint8Array.from(await leggiByte(foto.png)).buffer);
    expect([testa.getUint32(16), testa.getUint32(20)]).toEqual([640, 400]);
    await waitFor(() => expect(svgDisegnati).toHaveLength(1));
    const svg = svgDisegnati[0];
    expect(svg, "la bozza prj: deve essere disegnata").toContain("SEGNO-BOZZA");
    expect(svg, "lo sfondo del banco deve essere nell'immagine").toContain(`data:image/jpeg;base64,${JPG}`);
  });

  it("dopo la foto le bozze e gli sfondi non restano nell'editor", async () => {
    await fotografa(richiesta());
    expect(trovaSimboloLib("prj:bozza-foto")).toBeUndefined();
    expect(immagineInSospeso(SRC)).toBeUndefined();
  });

  it("trova i simboli anche dentro i faceplate e le griglie", () => {
    expect(simboliUsati(
      { objects: [{ symbol_id: "lib:a" }, { cells: [{ symbol_id: "prj:b" }] }] },
      [{ objects: [{ symbol_id: "lib:a" }, { symbol_id: "lib:c" }] }],
    ).sort()).toEqual(["lib:a", "lib:c", "prj:b"]);
  });

  it("la chat risponde a `fotografa` con il PNG, o con l'errore", async () => {
    const editor: EditorAi = {
      diff: async () => [],
      applica: async () => ({ ok: true }),
      fotografa: vi.fn(async () => ({ png: pngFinto(640, 400), avvisi: ["un avviso"] })),
    };
    render(<ChatPanel open onClose={() => {}} editor={editor} />);
    act(() => ascoltatori.forEach((f) => f({ t: "fotografa", id: "foto-7", ...richiesta() })));
    await waitFor(() => expect(fotoMandate).toHaveLength(1));
    const r = fotoMandate[0] as { id: string; png: string; avvisi: string[] };
    expect(r.id).toBe("foto-7");
    expect(r.avvisi).toEqual(["un avviso"]);
    expect(atob(r.png).slice(1, 4)).toBe("PNG");
    expect(editor.fotografa).toHaveBeenCalledWith(expect.objectContaining({ pagina: expect.objectContaining({ id: "nuova" }) }));

    vi.mocked(editor.fotografa).mockRejectedValueOnce(new Error("toBlob rotto"));
    act(() => ascoltatori.forEach((f) => f({ t: "fotografa", id: "foto-8", ...richiesta() })));
    await waitFor(() => expect(fotoMandate).toHaveLength(2));
    expect(fotoMandate[1]).toEqual({ id: "foto-8", errore: "toBlob rotto" });
  });
});

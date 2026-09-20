// La rasterizzazione delle pagine di boot (T-72 F4): le due trasformazioni pure
// che rendono un SVG caricabile in un `<img>`. La resa vera si guarda a occhio.
import { describe, expect, it } from "vitest";
import { incorporaImmagini, neutralizzaNonStatico, righeDiTesto, sostituisciVarBrand, spezzaTestiACapo } from "@/boot/rasterizza";
import type { SynopticPage } from "@/types";

describe("var(--brand-*) diventa un valore concreto", () => {
  const svg = '<rect fill="var(--brand-surface, #1e293b)" stroke="var(--brand-border)"/><text fill="var(--synoptic-text)"/>';

  it("usa il valore calcolato dall'app quando c'è", () => {
    const r = sostituisciVarBrand(svg, (n) => (n === "--brand-surface" ? "#ffffff" : undefined));
    expect(r).toContain('fill="#ffffff"');
  });

  it("ripiega sul fallback scritto accanto, altrimenti trasparente", () => {
    const r = sostituisciVarBrand(svg, () => undefined);
    expect(r).toContain('fill="#1e293b"');
    expect(r).toContain('stroke="transparent"');
  });

  it("non tocca le variabili che l'SVG definisce da sé", () => {
    expect(sostituisciVarBrand(svg, () => undefined)).toContain("var(--synoptic-text)");
  });

  it("regge un fallback con funzioni (rgba, var annidata) senza mangiarsi il resto", () => {
    const r = sostituisciVarBrand('<g fill="var(--brand-x, rgba(0, 0, 0, 0.5))" opacity="1"/>', () => undefined);
    expect(r).toBe('<g fill="rgba(0, 0, 0, 0.5)" opacity="1"/>');
  });
});

describe("le immagini si incorporano", () => {
  const leggi = async (href: string) => (href === "/api/project/images/logo.png" ? "data:image/png;base64,AAAA" : null);

  it("sostituisce l'href delle immagini di progetto con il data URI", async () => {
    const r = await incorporaImmagini('<image x="0" href="/api/project/images/logo.png" width="10"/>', leggi);
    expect(r).toBe('<image x="0" href="data:image/png;base64,AAAA" width="10"/>');
  });

  it("regge xlink:href, apici singoli e &amp; nell'URL", async () => {
    const r = await incorporaImmagini(
      "<image xlink:href='/api/project/images/logo.png'/><image href=\"/api/x?a=1&amp;b=2\"/>",
      async (h) => (h === "/api/x?a=1&b=2" || h.endsWith("logo.png") ? "data:image/png;base64,BB" : null));
    expect(r.match(/data:image\/png;base64,BB/g)).toHaveLength(2);
  });

  it("lascia com'è ciò che non si può leggere e ciò che è già data:", async () => {
    const svg = '<image href="https://esterno/x.png"/><image href="data:image/png;base64,ZZ"/>';
    expect(await incorporaImmagini(svg, leggi)).toBe(svg);
  });

  it("un errore di lettura non rompe le altre immagini", async () => {
    const r = await incorporaImmagini(
      '<image href="/api/a.png"/><image href="/api/project/images/logo.png"/>',
      async (h) => { if (h === "/api/a.png") throw new Error("boom"); return "data:image/png;base64,AAAA"; });
    expect(r).toContain('href="/api/a.png"');
    expect(r).toContain("data:image/png;base64,AAAA");
  });
});

// «Tainted canvases may not be exported» (20-09-2026): un testo con `text_wrap` è un `<foreignObject>`, e
// un `<foreignObject>` macchia il canvas del PNG.
describe("un testo a capo non deve arrivare al PNG come foreignObject", () => {
  // 10 px a carattere, così i conti si fanno a mente.
  const misura = (t: string) => t.length * 10;

  it("manda a capo le parole dentro la larghezza", () => {
    expect(righeDiTesto("Avvio in corso del pannello", 120, misura)).toEqual(["Avvio in", "corso del", "pannello"]);
  });

  it("rispetta gli a-capo scritti a mano, anche le righe vuote", () => {
    expect(righeDiTesto("uno\n\ndue", 200, misura)).toEqual(["uno", "", "due"]);
  });

  it("spezza una parola più larga della riga invece di sforare", () => {
    expect(righeDiTesto("abcdefghij", 50, misura)).toEqual(["abcde", "fghij"]);
  });

  const pagina = (o: object): SynopticPage => ({
    id: "b", name: "b", kind: "boot", objects: [{ id: "t", type: "text", x: 100, y: 200, width: 120, height: 100, text: "Avvio in corso del pannello", text_wrap: true, ...o } as never],
  });

  it("sostituisce il testo con un oggetto per riga, senza text_wrap e senza tag", () => {
    const r = spezzaTestiACapo(pagina({ font_size: 20, text_valign: "top" }), (_f, t) => misura(t));
    expect(r.objects.map((o) => o.text)).toEqual(["Avvio in", "corso del", "pannello"]);
    expect(r.objects.every((o) => o.type === "text" && !o.text_wrap && o.tag === undefined)).toBe(true);
    // Il passo è la line-height (1.25 × 20 = 25), a partire dall'alto del riquadro.
    expect(r.objects[1].y - r.objects[0].y).toBeCloseTo(25);
  });

  it("l'allineamento orizzontale e verticale seguono il riquadro", () => {
    const r = spezzaTestiACapo(pagina({ font_size: 20, text_anchor: "middle", text_valign: "middle" }), (_f, t) => misura(t));
    expect(r.objects[0].x).toBe(160);            // 100 + 120/2
    const alto = spezzaTestiACapo(pagina({ font_size: 20, text_valign: "top" }), (_f, t) => misura(t)).objects[0].y;
    expect(r.objects[0].y).toBeGreaterThan(alto); // 3 righe da 25 in un riquadro da 100: centrate, non in cima
  });

  it("lo sfondo del testo diventa un rettangolo dietro", () => {
    const r = spezzaTestiACapo(pagina({ bg_color: "#123456" }), (_f, t) => misura(t));
    expect(r.objects[0]).toMatchObject({ type: "rect", fill: "#123456", x: 100, y: 200, width: 120, height: 100 });
  });

  it("i testi senza text_wrap e gli altri oggetti non si toccano, e la pagina originale nemmeno", () => {
    const p: SynopticPage = { id: "b", name: "b", objects: [
      { id: "a", type: "text", x: 0, y: 0, text: "uno" }, { id: "r", type: "rect", x: 0, y: 0 },
    ] as never };
    const r = spezzaTestiACapo(p, (_f, t) => misura(t));
    expect(r.objects).toEqual(p.objects);
    const conWrap = pagina({});
    spezzaTestiACapo(conWrap, (_f, t) => misura(t));
    expect(conWrap.objects).toHaveLength(1);
  });

  it("ciò che macchierebbe il canvas si toglie e si dice", () => {
    const svg = '<g><foreignObject x="0"><div>ciao</div></foreignObject><image href="https://esterno/x.png"/><image href="data:image/png;base64,AA"/><rect/></g>';
    const r = neutralizzaNonStatico(svg);
    expect(r.svg).toBe('<g><image href="data:image/png;base64,AA"/><rect/></g>');
    expect(r.avvisi).toHaveLength(2);
  });

  it("un SVG pulito passa com'è, senza avvisi", () => {
    const svg = '<g><text>ciao</text><image href="data:image/png;base64,AA"/></g>';
    expect(neutralizzaNonStatico(svg)).toEqual({ svg, avvisi: [] });
  });
});


// La rasterizzazione delle pagine di boot (T-72 F4): le due trasformazioni pure
// che rendono un SVG caricabile in un `<img>`. La resa vera si guarda a occhio.
import { describe, expect, it } from "vitest";
import { incorporaImmagini, sostituisciVarBrand } from "@/boot/rasterizza";

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

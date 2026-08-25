import { describe, expect, it } from "vitest";
import { defaultObjectTextColor, relativeLuminance } from "../src/theme";

// Q18: il colore predefinito del testo di un sinottico si ricava dallo SFONDO
// DELLA PAGINA, non dal tema dell'app.
//
// Il caso che ha motivato la correzione: tema app chiaro + pagina con sfondo
// scuro scelto dal progettista dava testo scuro su scuro, cioè invisibile. Non
// era una svista di chi disegnava — era una combinazione che nessuno aveva
// messo alla prova.

describe("colore del testo dallo sfondo pagina", () => {
  it("su sfondo scuro il testo è chiaro", () => {
    // #0f172a è lo sfondo dei progetti demo di questo repo.
    expect(defaultObjectTextColor("#0f172a")).toBe("#e2e8f0");
    expect(defaultObjectTextColor("#000")).toBe("#e2e8f0");
  });

  it("su sfondo chiaro il testo è scuro", () => {
    expect(defaultObjectTextColor("#ffffff")).toBe("#0f172a");
    expect(defaultObjectTextColor("#f8fafc")).toBe("#0f172a");
  });

  /// Il caso preciso di Q18: tema app chiaro, pagina scura. Prima di questa
  /// correzione qui usciva il token dell'app, cioè testo scuro — invisibile.
  it("non dipende dal tema dell'app", () => {
    // La funzione non riceve il tema: è la garanzia strutturale che non possa
    // dipenderne. Il test lo fissa perché non venga reintrodotto.
    expect(defaultObjectTextColor.length).toBe(1);
  });

  it("senza sfondo si ricade sul token di tema, come prima", () => {
    expect(defaultObjectTextColor(undefined)).toBe("var(--brand-text, #e2e8f0)");
    expect(defaultObjectTextColor("")).toBe("var(--brand-text, #e2e8f0)");
  });

  /// Uno sfondo che non è un colore piatto — un gradiente, un `var(...)`, un
  /// nome CSS — non si può giudicare: meglio il comportamento di prima che una
  /// scelta a caso.
  it("uno sfondo non interpretabile non viene indovinato", () => {
    expect(defaultObjectTextColor("linear-gradient(#fff,#000)")).toBe("var(--brand-text, #e2e8f0)");
    expect(defaultObjectTextColor("var(--brand-bg)")).toBe("var(--brand-text, #e2e8f0)");
    expect(defaultObjectTextColor("rebeccapurple")).toBe("var(--brand-text, #e2e8f0)");
  });

  it("accetta anche la forma a tre cifre", () => {
    expect(defaultObjectTextColor("#fff")).toBe("#0f172a");
    expect(defaultObjectTextColor("#000")).toBe("#e2e8f0");
  });

  /// Il verde puro è chiaro nonostante il rosso e il blu a zero: la luminanza
  /// pesa il verde per il 72%. Una media aritmetica sbaglierebbe questo caso,
  /// ed è l'errore facile da fare riscrivendo la funzione.
  it("pesa i canali come la luminanza, non come una media", () => {
    expect(defaultObjectTextColor("#00ff00")).toBe("#0f172a");
    expect(defaultObjectTextColor("#0000ff")).toBe("#e2e8f0");
  });

  it("la luminanza è monotona dal nero al bianco", () => {
    const nero = relativeLuminance("#000000")!;
    const grigio = relativeLuminance("#808080")!;
    const bianco = relativeLuminance("#ffffff")!;
    expect(nero).toBeCloseTo(0, 5);
    expect(bianco).toBeCloseTo(1, 5);
    expect(nero).toBeLessThan(grigio);
    expect(grigio).toBeLessThan(bianco);
  });
});

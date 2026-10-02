/** I preset Pixsys sono il catalogo vero, e il nome dice la risoluzione.
 *
 *  La nomenclatura, data dal maintainer il 02-10-2026:
 *
 *    {WP|TC} + cifra del touch + due cifre di schermo
 *      WP = WebPanel, TC = TouchController
 *      5, 6 = touch capacitivo · 7, 8 = resistivo
 *      70 → 7" 1024×600 · 00 → 8" 1024×768 · 15 → 10,1" 1280×800
 *      20 → 12,1" 1280×800 · 30 → 15,6" 1920×1080
 *
 *  **Ma le combinazioni non sono tutte quelle che la regola genererebbe.** Per
 *  ogni schermo esiste **un** modello capacitivo e **uno** resistivo, e la
 *  cifra dipende dalla serie: 5/7 sul 7", 6/8 su tutti gli altri. Venti
 *  modelli, non quaranta — il resto non esiste a catalogo. Questo è il motivo
 *  per cui l'elenco qui sotto è scritto e non calcolato: una regola che
 *  genera più di quello che esiste non è la regola giusta, e un `WP670`
 *  prodotto da un ciclo for sarebbe un modello inventato.
 *
 *  Prima di questa nomenclatura i nomi non stavano in nessun file del repo, e
 *  il seme del 19-09-2026 era fermo lì. Ora la coerenza si **verifica**: il
 *  nome dice già quanto deve essere grande la pagina, quindi un `WP615` nato
 *  per sbaglio con 1920×1080 diventa rosso qui — e lo stesso vale fra sei mesi
 *  per chi la regola non la ricorda.
 */
import { describe, expect, it } from "vitest";
import brand from "../public/branding/pixsys/brand.json";

/** Il catalogo: per ogni schermo il capacitivo e il resistivo. */
const CATALOGO = [
  { cap: "570", res: "770", pollici: '7"', w: 1024, h: 600 },
  { cap: "600", res: "800", pollici: '8"', w: 1024, h: 768 },
  { cap: "615", res: "815", pollici: '10,1"', w: 1280, h: 800 },
  { cap: "620", res: "820", pollici: '12,1"', w: 1280, h: 800 },
  { cap: "630", res: "830", pollici: '15,6"', w: 1920, h: 1080 },
];
const GRUPPI: Record<string, string> = { WP: "WebPanel", TC: "TouchController" };

/** Ogni voce che il catalogo prevede: sigla, codice, touch, schermo. */
const attesi = Object.keys(GRUPPI).flatMap((sigla) =>
  CATALOGO.flatMap((s) => [
    { sigla, codice: s.cap, touch: "capacitivo", ...s },
    { sigla, codice: s.res, touch: "resistivo", ...s },
  ]),
);

type Preset = { label: string; group?: string; width: number; height: number };
const preset = brand.device_presets as Preset[];

describe("i preset Pixsys sono il catalogo, e lo rispettano", () => {
  it("ci sono esattamente i venti modelli che esistono, e nessun altro", () => {
    // Dieci codici per linea: per ogni schermo un capacitivo e un resistivo.
    // Le altre combinazioni che la nomenclatura permetterebbe — un WP670, un
    // TC515 — a catalogo non ci sono, e un preset che le offrisse manderebbe
    // qualcuno a cercare un prodotto inesistente.
    expect(preset).toHaveLength(attesi.length);
    expect(new Set(preset.map((p) => p.label)).size).toBe(attesi.length);
    for (const a of attesi)
      expect(
        preset.some((p) => p.label.startsWith(`${a.sigla}${a.codice} —`)),
        `manca ${a.sigla}${a.codice}`,
      ).toBe(true);
  });

  it("ogni voce porta la risoluzione, i pollici, il touch e il gruppo del suo modello", () => {
    for (const p of preset) {
      const m = /^(WP|TC)(\d{3}) — /.exec(p.label);
      expect(m, `nome fuori nomenclatura: ${p.label}`).not.toBeNull();
      const [, sigla, codice] = m!;
      const a = attesi.find((x) => x.sigla === sigla && x.codice === codice);
      expect(a, `${p.label}: modello che non sta a catalogo`).toBeDefined();
      expect([p.width, p.height], `${p.label}: dimensione diversa da quella del modello`)
        .toEqual([a!.w, a!.h]);
      expect(p.label, `${p.label}: pollici sbagliati`).toContain(a!.pollici);
      expect(p.label, `${p.label}: touch sbagliato per il codice ${codice}`).toContain(a!.touch);
      expect(p.group, `${p.label}: gruppo sbagliato per la sigla ${sigla}`).toBe(GRUPPI[sigla]);
    }
  });

  it("dentro ogni gruppo gli schermi crescono", () => {
    // Chi cerca sa che pannello ha davanti, non il numero di modello.
    for (const gruppo of Object.values(GRUPPI)) {
      const larghezze = preset.filter((p) => p.group === gruppo).map((p) => `${p.width}x${p.height}`);
      const primaVolta = larghezze.filter((c, i) => larghezze.indexOf(c) === i);
      expect(primaVolta, `${gruppo}: schermi fuori ordine`)
        .toEqual(["1024x600", "1024x768", "1280x800", "1920x1080"]);
    }
  });

  it("non è rimasto nessun modello di una serie che non esiste più", () => {
    // La serie TD è stata eliminata dal catalogo (maintainer, 02-10-2026):
    // il TD710 era nei preset dal 19-09 come «confermato».
    expect(preset.filter((p) => /^TD/.test(p.label))).toHaveLength(0);
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import "../src/i18n";
import { ObjectProps } from "../src/editor/EditorShell";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
import type { SynopticObject } from "../src/types";
import inventario from "./fixtures/campiPannelloProprieta.json";

/** L'inventario dei campi del pannello proprietà, tipo per tipo.
 *
 *  ## Perché esiste
 *
 *  T-56 riordina `ObjectProps` — ~2.700 righe, una catena di rami per tipo —
 *  in sezioni canoniche. Un riordino di quella scala perde un campo senza
 *  fallire: il pannello si disegna lo stesso, e l'assenza la scopre chi va a
 *  cercare quel campo, settimane dopo, su un progetto vero.
 *
 *  Questo test cattura l'elenco **prima** del riordino e lo confronta a ogni
 *  esecuzione. Non giudica l'ordine né l'aspetto — quelli cambiano di
 *  proposito: giudica che l'insieme dei campi e delle sezioni sia lo stesso.
 *
 *  ## Come si aggiorna
 *
 *  Aggiungere un campo a un tipo fa fallire questo test, ed è giusto: si
 *  aggiorna `tests/fixtures/campiPannelloProprieta.json` **guardando il
 *  diff**. Una riga in più è un campo nuovo; una in meno, in una sessione che
 *  non voleva toglierne, è il guasto che questo test esiste per vedere.
 */

/** Apre tutte le sezioni pieghevoli, ripetutamente: una sezione può contenerne
 *  un'altra, quindi un giro solo non basta.
 *
 *  `fireEvent.click` e non `nodo.click()`: il secondo dispaccia un evento
 *  nativo che React processa fuori da `act()`, e con l'annidamento arrivato
 *  col passo 3 ha semplicemente **smesso di aprire le sezioni** — il test
 *  continuava a passare dichiarando campi che non c'erano più. Un aiutante di
 *  test che fallisce in silenzio è peggio di nessun test. */
function apriTutto(): void {
  for (let giro = 0; giro < 8; giro++) {
    const chiuse = screen.queryAllByRole("button", { expanded: false });
    if (chiuse.length === 0) return;
    for (const b of chiuse) fireEvent.click(b);
  }
  throw new Error("otto giri e ci sono ancora sezioni chiuse: l'inventario sarebbe incompleto");
}

/** Etichette dei campi e titoli delle sezioni, come li vede chi guarda. */
function inventarioDi(tipo: string): { sezioni: string[]; campi: string[] } {
  const obj = { id: `x-${tipo}`, type: tipo, x: 10, y: 10, width: 100, height: 40 } as SynopticObject;
  const { container, unmount } = render(
    <ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />,
  );
  apriTutto();
  const sezioni = screen
    .queryAllByRole("button")
    .filter((b) => b.getAttribute("aria-expanded") !== null)
    .map((b) => (b.textContent ?? "").replace(/^[▼▶]\s*/, "").trim())
    .filter(Boolean);
  // Le etichette di `RigaProprieta`: il div che precede il controllo. Si
  // riconoscono dal fatto di essere il primo figlio di un contenitore che ne
  // ha due — è la forma che il componente condiviso garantisce.
  const campi = Array.from(container.querySelectorAll("div > div:first-child"))
    .filter((d) => d.children.length === 0 && (d.textContent ?? "").trim().length > 0)
    .map((d) => (d.textContent ?? "").trim());
  unmount();
  return {
    sezioni: Array.from(new Set(sezioni)).sort(),
    campi: Array.from(new Set(campi)).sort(),
  };
}

const TIPI = PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as string));

describe("pannello proprietà — nessun campo perso nel riordino (T-56)", () => {
  beforeAll(() => {
    // Senza, ogni tipo erediterebbe le sezioni lasciate aperte dal precedente.
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
  });

  it("la palette non ha perso né guadagnato tipi senza che l'inventario lo sappia", () => {
    expect(TIPI.slice().sort()).toEqual(Object.keys(inventario).sort());
  });

  for (const tipo of TIPI) {
    it(`${tipo}: sezioni e campi invariati`, () => {
      const atteso = (inventario as Record<string, { sezioni: string[]; campi: string[] }>)[tipo];
      expect(atteso, `tipo «${tipo}» assente dall'inventario`).toBeDefined();
      expect(inventarioDi(tipo)).toEqual(atteso);
    });
  }
});

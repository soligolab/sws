import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import "../src/i18n";
import { GRUPPI_PROPRIETA, GruppoAttivo, ObjectProps, type GruppoProprieta } from "../src/editor/EditorShell";
import { slotDi } from "../src/editor/proprieta/slotTag";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
import type { SynopticObject } from "../src/types";
import { writeFileSync } from "node:fs";
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
 *  Dall'11-09-2026 le sezioni sono divise nei quattro gruppi della barra a
 *  destra, e se ne vede uno per volta: l'inventario **gira tutti e quattro i
 *  gruppi** e somma. È il punto in cui questo test guadagna il suo valore vero
 *  — se una sezione finisse nel gruppo sbagliato, o in nessuno, l'inventario
 *  cambierebbe e il confronto lo direbbe.
 *
 *  ## Come si aggiorna
 *
 *  Aggiungere un campo a un tipo fa fallire questo test, ed è giusto: si
 *  aggiorna `tests/fixtures/campiPannelloProprieta.json` **guardando il
 *  diff**. Una riga in più è un campo nuovo; una in meno, in una sessione che
 *  non voleva toglierne, è il guasto che questo test esiste per vedere.
 *
 *  Per riscriverla (01-11-2026, il pannello per frequenza la cambia a ogni
 *  fase): `SWS_RIGENERA_INVENTARIO=1 pnpm exec vitest run tests/pannelloProprieta.test.tsx`,
 *  poi `git diff` sulla fixture, letto riga per riga, prima del commit.
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

/** Etichette dei campi e titoli delle sezioni di **un solo gruppo**, come li
 *  vede chi guarda. */
function inventarioDelGruppo(tipo: string, gruppo: GruppoProprieta) {
  const obj = { id: `x-${tipo}`, type: tipo, x: 10, y: 10, width: 100, height: 40 } as SynopticObject;
  const { container, unmount } = render(
    <GruppoAttivo.Provider value={gruppo}>
      <ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
    </GruppoAttivo.Provider>,
  );
  apriTutto();
  const sezioni = screen
    .queryAllByRole("button")
    .filter((b) => b.getAttribute("aria-expanded") !== null)
    .map((b) => (b.textContent ?? "").replace(/^[▼▶]\s*/, "").trim())
    .filter(Boolean);
  // Le etichette di `RigaProprieta`: il div che precede il controllo. Si
  // riconoscono dal fatto di essere il primo figlio di un contenitore che ne
  // ha due — è la forma che il componente condiviso garantisce. Il contenitore
  // è un `<label>` quando l'etichetta sta **a fianco** del campo: senza quel
  // secondo selettore, X, Y, W, H e Nome sparirebbero dall'inventario e la
  // rete smetterebbe di guardarli proprio mentre li si sposta.
  const campi = Array.from(container.querySelectorAll("div > div:first-child, label > div:first-child"))
    .filter((d) => d.children.length === 0 && (d.textContent ?? "").trim().length > 0)
    .map((d) => (d.textContent ?? "").trim());
  // Dal 01-11-2026 i tag non collegati non si vedono: stanno nel menu «+ Collega…»
  // di «Collegamenti». Si contano da lì, o l'inventario non li vedrebbe più.
  campi.push(...Array.from(container.querySelectorAll('[data-testid="collega-slot"] option'))
    .slice(1).map((o) => `+ ${(o.textContent ?? "").trim()}`));
  unmount();
  return { sezioni, campi };
}

/** L'inventario completo di un tipo: la somma dei quattro gruppi. */
function inventarioDi(tipo: string): { sezioni: string[]; campi: string[] } {
  const sezioni: string[] = [];
  const campi: string[] = [];
  for (const g of GRUPPI_PROPRIETA) {
    const parziale = inventarioDelGruppo(tipo, g.id);
    sezioni.push(...parziale.sezioni);
    campi.push(...parziale.campi);
  }
  return {
    sezioni: Array.from(new Set(sezioni)).sort(),
    campi: Array.from(new Set(campi)).sort(),
  };
}

// Il faceplate non è più nella palette (29-10-2026, si trascina dal suo ramo),
// ma un'istanza ha il suo pannello proprietà e va inventariato come gli altri.
const TIPI = [...PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as string)), "faceplate"];

describe("pannello proprietà — nessun campo perso nel riordino (T-56)", () => {
  beforeAll(() => {
    // Senza, ogni tipo erediterebbe le sezioni lasciate aperte dal precedente.
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
  });

  if (process.env.SWS_RIGENERA_INVENTARIO) {
    it("riscrive la fixture", () => {
      const nuovo = Object.fromEntries(TIPI.map((tipo) => [tipo, inventarioDi(tipo)]));
      writeFileSync(`${process.cwd()}/tests/fixtures/campiPannelloProprieta.json`, JSON.stringify(nuovo, null, 2) + "\n");
    }, 120_000);
    return;
  }

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

/** Regola UI 2 del maintainer (23-08-2026): mai due punti del pannello che
 *  scrivono lo stesso campo. Fino al 01-11-2026 la guardia guardava solo
 *  `obj.tag` («Tag» o «Tag di stato»); da quando i tag stanno tutti in
 *  «Collegamenti» guarda **ogni slot** di `slotTag.ts`.
 *
 *  Si dà a ogni campo tag un valore riconoscibile, si accendono le modalità che
 *  li fanno comparire, e si conta in quanti campi del pannello intero compare
 *  quel valore: dev'essere uno. Per valore e non per etichetta, così un campo
 *  rimasto in un ramo con un'etichetta diversa non sfugge. */
describe("regola UI 2: ogni tag dell'oggetto si scrive da un punto solo", () => {
  for (const tipo of TIPI) {
    it(`${tipo}: ogni slot in un campo solo`, () => {
      const base = {
        id: `x-${tipo}`, type: tipo, x: 10, y: 10, width: 100, height: 40,
        blink_mode: "tag", symbol_spin: "tag", pipe_flow: true, pie_mode: "donut",
      } as SynopticObject;
      const obj = { ...base } as Record<string, unknown>;
      for (const s of slotDi(base)) obj[s.campo] = `tag-${s.campo}`;
      const { container, unmount } = render(
        <GruppoAttivo.Provider value="tutti">
          <ObjectProps obj={obj as unknown as SynopticObject} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
        </GruppoAttivo.Provider>,
      );
      apriTutto();
      const valori = Array.from(container.querySelectorAll("input")).map((i) => i.value);
      for (const s of slotDi(base)) {
        expect(valori.filter((v) => v === `tag-${s.campo}`).length, `${tipo}.${s.campo}`).toBe(1);
      }
      unmount();
    });
  }
});

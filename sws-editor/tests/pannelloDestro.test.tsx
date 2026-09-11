import { render, screen, fireEvent } from "@testing-library/react";
import { useContext, useState } from "react";
import { describe, it, expect, vi } from "vitest";
import i18n from "../src/i18n";
import { BarraIcone } from "../src/editor/stilePannelli";
import { GRUPPI_PROPRIETA, GruppoAttivo, PannelloDestro, barraGruppiVisibile, gruppiPerTipo, gruppoEffettivo, gruppoMemorizzato } from "../src/editor/EditorShell";
import type { GruppoProprieta } from "../src/editor/EditorShell";

/** La barra dei gruppi del pannello destro (T-56, seguito dell'11-09-2026).
 *
 *  Due cose separate, provate separatamente: **quando** la barra si vede — una
 *  decisione con quattro casi, che nel pannello sarebbe sepolta in una catena
 *  di rami — e **come si comporta** la barra stessa, che è lo stesso
 *  componente usato a sinistra.
 */

describe("quando si vede la barra dei gruppi", () => {
  const rect = { id: "r1", type: "rect" };
  const grid = { id: "g1", type: "grid" };
  const nessuna = {};

  it("con un oggetto solo selezionato, sì", () => {
    expect(barraGruppiVisibile(rect, false, nessuna)).toBe(true);
  });

  it("senza selezione, no: il pannello mostra le proprietà di pagina", () => {
    expect(barraGruppiVisibile(null, false, nessuna)).toBe(false);
  });

  it("con più oggetti, no: le proprietà comuni non hanno le sezioni canoniche", () => {
    expect(barraGruppiVisibile(rect, true, nessuna)).toBe(false);
  });

  it("su una griglia senza celle selezionate, sì: è un oggetto come gli altri", () => {
    expect(barraGruppiVisibile(grid, false, nessuna)).toBe(true);
    // E le celle di un'ALTRA griglia non contano.
    expect(barraGruppiVisibile(grid, false, { cella: "g2" })).toBe(true);
  });

  it("con una cella, un intervallo o una sotto-cella di QUESTA griglia, no", () => {
    // Lì il pannello mostra l'editor della cella: la barra non avrebbe niente
    // da governare, e una barra che non fa niente è peggio di una assente.
    expect(barraGruppiVisibile(grid, false, { cella: "g1" })).toBe(false);
    expect(barraGruppiVisibile(grid, false, { intervallo: "g1" })).toBe(false);
    expect(barraGruppiVisibile(grid, false, { sottoCella: "g1" })).toBe(false);
  });
});

describe("la barra delle icone", () => {
  const monta = (attiva = "oggetto") => {
    const onScegli = vi.fn();
    render(<BarraIcone voci={GRUPPI_PROPRIETA} attiva={attiva} onScegli={onScegli} lato="destra" />);
    return onScegli;
  };

  it("ha una voce per gruppo, e una sola risulta scelta", () => {
    monta();
    const voci = screen.getAllByRole("tab");
    expect(voci).toHaveLength(GRUPPI_PROPRIETA.length);
    expect(voci.filter((b) => b.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("ogni icona porta il nome del gruppo, non solo il glifo", () => {
    // Senza il `title` la barra è una fila di simboli da indovinare.
    monta();
    for (const g of GRUPPI_PROPRIETA) {
      expect(screen.getByTitle(i18n.t(g.chiave))).toBeTruthy();
    }
  });

  it("il clic riporta il gruppo scelto, non quello attivo", () => {
    const onScegli = monta();
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(onScegli).toHaveBeenCalledWith(GRUPPI_PROPRIETA[2].id);
  });
});

describe("il gruppo ricordato fra una sessione e l'altra", () => {
  it("torna quello scelto l'ultima volta", () => {
    expect(gruppoMemorizzato("comportamento")).toBe("comportamento");
  });

  it("senza memoria si parte da Oggetto", () => {
    expect(gruppoMemorizzato(null)).toBe("oggetto");
  });

  it("un gruppo che non esiste più non lascia il pannello senza sezioni", () => {
    // Il caso si presenta rinominando o togliendo un gruppo: chi aveva
    // memorizzato quello vecchio deve ritrovarsi su Oggetto, non sul nulla.
    expect(gruppoMemorizzato("avanzate")).toBe("oggetto");
  });
});

/** **Il filo fra la barra e le sezioni**, che alla prima stesura non c'era.
 *
 *  Il `Provider` del contesto era stato dimenticato: la barra si illuminava, il
 *  titolo cambiava da OGGETTO a DATO, e sotto restavano le sezioni del gruppo
 *  Oggetto, perché `CollapsibleSection` leggeva il valore di default del
 *  contesto. Nessun test se n'era accorto — quello dell'inventario **fornisce
 *  lui** il contesto, quindi provava le sezioni e non il cablaggio.
 *
 *  Questi due provano il cablaggio, con un figlio finto che dichiara solo cosa
 *  vede: se il `Provider` sparisce di nuovo, diventano rossi. */
function Spia() {
  return <span data-testid="gruppo-visto">{useContext(GruppoAttivo)}</span>;
}

function montaPannello(iniziale: GruppoProprieta = "oggetto") {
  function Guscio() {
    const [gruppo, setGruppo] = useState<GruppoProprieta>(iniziale);
    return (
      <PannelloDestro
        larghezza={280}
        onRidimensiona={() => {}}
        titolo={gruppo}
        gruppo={gruppo}
        gruppiVisibili={GRUPPI_PROPRIETA}
        onScegliGruppo={setGruppo}
        mostraBarra
        bloccato={false}
      >
        <Spia />
      </PannelloDestro>
    );
  }
  return render(<Guscio />);
}

describe("la barra comanda davvero le sezioni", () => {
  it("il contenuto vede il gruppo che il pannello dichiara", () => {
    montaPannello("dato");
    expect(screen.getByTestId("gruppo-visto").textContent).toBe("dato");
  });

  it("cliccando un'altra icona il contenuto vede il gruppo nuovo", () => {
    montaPannello("oggetto");
    expect(screen.getByTestId("gruppo-visto").textContent).toBe("oggetto");
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(screen.getByTestId("gruppo-visto").textContent).toBe(GRUPPI_PROPRIETA[2].id);
  });

  it("senza barra il contenuto vede comunque il gruppo giusto", () => {
    // Selezione multipla e celle di griglia: la barra non c'è, ma il contesto
    // deve valere lo stesso — altrimenti le sezioni sparirebbero tutte.
    render(
      <PannelloDestro larghezza={280} onRidimensiona={() => {}} titolo="x"
        gruppo="resa" gruppiVisibili={GRUPPI_PROPRIETA} onScegliGruppo={() => {}}
        mostraBarra={false} bloccato={false}>
        <Spia />
      </PannelloDestro>,
    );
    expect(screen.getByTestId("gruppo-visto").textContent).toBe("resa");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

describe("la scheda Testo c'è solo dove serve", () => {
  it("su un testo la barra ha una scheda in più", () => {
    const suTesto = gruppiPerTipo("text").map((g) => g.id);
    const suRect  = gruppiPerTipo("rect").map((g) => g.id);
    expect(suTesto).toContain("testo");
    expect(suRect).not.toContain("testo");
    expect(suTesto).toHaveLength(suRect.length + 1);
  });

  it("gli altri quattro gruppi valgono per ogni tipo", () => {
    for (const tipo of ["rect", "text", "trend", "grid", "pipe"]) {
      const ids = gruppiPerTipo(tipo).map((g) => g.id);
      for (const atteso of ["oggetto", "dato", "comportamento", "resa"]) {
        expect(ids, `${tipo} senza ${atteso}`).toContain(atteso);
      }
    }
  });

  it("passando da un testo a un rettangolo si torna a Oggetto", () => {
    // Senza questo il pannello resterebbe su una scheda che non esiste per
    // l'oggetto nuovo, cioè vuoto.
    expect(gruppoEffettivo("testo", "rect")).toBe("oggetto");
  });

  it("ma la scelta non si perde: tornando su un testo si ritrova il testo", () => {
    // Il ripiego è solo su ciò che si vede, non su ciò che è memorizzato.
    expect(gruppoEffettivo("testo", "text")).toBe("testo");
  });

  it("un gruppo che vale per tutti passa indenne", () => {
    expect(gruppoEffettivo("resa", "rect")).toBe("resa");
    expect(gruppoEffettivo("resa", undefined)).toBe("resa");
  });
});

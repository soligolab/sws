/** Le guardie del ridisegno mirato (piano «viewer leggero», 09-11-2026, passo 5).
 *
 *  `SvgObject` è memo: un oggetto si ridisegna solo quando cambia un tag che
 *  legge. Queste prove passano prima e dopo, e dicono cosa il memo non deve
 *  rompere: un comando che parte dal valore vero, lo stale, lo stile del
 *  progetto e la lingua che non passano dai tag, un legame che sceglie il tag,
 *  e il grigio dei dati in ritardo su ogni oggetto. Ogni caso ridisegna il
 *  canvas con le stesse prop, come fa la pagina quando cambia lo store. */
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/index";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { impostaStileProgetto } from "@/symbols/stileProgetto";
import { useAppStore } from "@/store";
import type { SynopticObject, TagState } from "@/types";

const T0 = 1_700_000_000_000;
const v = (value: TagState["value"], timestamp_ms = T0): TagState => ({ value, quality: "Good", timestamp_ms });

afterEach(() => {
  vi.useRealTimers();
  act(() => impostaStileProgetto(undefined));
});

describe("un oggetto memo legge i valori giusti", () => {
  it("l'incremento parte dal valore nuovo, dopo un tag non suo e poi il suo, e chiama l'ultima callback", () => {
    const oggetti = [
      { id: "piu", type: "button", x: 0, y: 0, width: 80, height: 30, label: "+1", tag: "a", button_mode: "increment", step: 1 },
      { id: "altro", type: "text", x: 0, y: 50, width: 80, height: 20, tag: "b" },
    ] as SynopticObject[];
    const vecchia = vi.fn();
    const nuova = vi.fn();
    const { rerender, getByText } = render(
      <SvgCanvas objects={oggetti} tagValues={{ a: v(5), b: v(1) }} onWriteTag={vecchia} />,
    );
    // Prima un tag non suo: il bottone non si ridisegna.
    rerender(<SvgCanvas objects={oggetti} tagValues={{ a: v(5), b: v(2) }} onWriteTag={(id, x) => nuova(id, x)} />);
    // Poi il suo.
    rerender(<SvgCanvas objects={oggetti} tagValues={{ a: v(10), b: v(2) }} onWriteTag={(id, x) => nuova(id, x)} />);
    fireEvent.click(getByText("+1"));
    expect(nuova).toHaveBeenCalledWith("a", 11);
    expect(vecchia).not.toHaveBeenCalled();
  });

  it("lo stale: col tempo che si rinfresca la ⌛ non compare, col tag fermo 6 s sì", () => {
    vi.useFakeTimers({ now: T0 });
    const oggetti = [{ id: "t", type: "text", x: 10, y: 20, width: 80, height: 20, tag: "a", stale_after_s: 5 }] as SynopticObject[];
    const { rerender, queryByText } = render(<SvgCanvas objects={oggetti} tagValues={{ a: v(7, Date.now()) }} />);
    // Lo stesso valore ritrasmesso ogni secondo, col tempo nuovo.
    for (let s = 0; s < 10; s++) {
      act(() => { vi.advanceTimersByTime(1000); });
      rerender(<SvgCanvas objects={oggetti} tagValues={{ a: v(7, Date.now()) }} />);
    }
    expect(queryByText("⌛")).toBeNull();
    // Poi il tag si ferma.
    act(() => { vi.advanceTimersByTime(6000); });
    expect(queryByText("⌛")).not.toBeNull();
  });

  it("una tabella con la colonna «time» segue il tempo anche a valore fermo", () => {
    // Il valore ritrasmesso uguale cambia solo il tempo: per chi lo mostra
    // (`conTempo`) conta.
    const oggetti = [{
      id: "tab", type: "table", x: 0, y: 0, width: 300, height: 120,
      table_rows: [{ tag: "a", label: "A" }], table_columns: ["label", "value", "time"],
    }] as SynopticObject[];
    const dopo = T0 + 3_600_000;
    const { rerender, container } = render(<SvgCanvas objects={oggetti} tagValues={{ a: v(7) }} />);
    expect(container.textContent).toContain(new Date(T0).toLocaleTimeString());
    rerender(<SvgCanvas objects={oggetti} tagValues={{ a: v(7, dopo) }} />);
    expect(container.textContent).toContain(new Date(dopo).toLocaleTimeString());
  });

  it("lo stile del progetto cambia il tubo, senza nessun cambio di tag", () => {
    const oggetti = [
      { id: "tubo", type: "pipe", x: 0, y: 0, pipe_style: "metallo", points: [{ x: 0, y: 10 }, { x: 200, y: 10 }] },
    ] as SynopticObject[];
    const valori = {};
    const { rerender, container } = render(<SvgCanvas objects={oggetti} tagValues={valori} />);
    expect(container.innerHTML).not.toContain("#ff0000");
    act(() => impostaStileProgetto({ outline_color: "#ff0000" }));
    rerender(<SvgCanvas objects={oggetti} tagValues={valori} />);
    expect(container.innerHTML).toContain("#ff0000");
  });

  it("il cambio di lingua aggiorna il bottone della lingua", () => {
    act(() => useAppStore.setState({
      project: { languages: { default: "it", langs: ["it", "en"] } } as never,
      projectLang: "it",
    }));
    const oggetti = [{ id: "en", type: "lang_button", x: 0, y: 0, width: 60, height: 30, target_lang: "en" }] as SynopticObject[];
    const valori = {};
    const { rerender, getByText } = render(<SvgCanvas objects={oggetti} tagValues={valori} />);
    const sfondo = () => getByText("EN").parentElement!.querySelector("rect")!.getAttribute("fill");
    expect(sfondo()).toBe("#334155");
    act(() => useAppStore.setState({ projectLang: "en" }));
    rerender(<SvgCanvas objects={oggetti} tagValues={valori} />);
    expect(sfondo()).toBe("var(--brand-primary, #3b82f6)");
  });

  it("un legame che sceglie il tag segue il valore del tag scelto", () => {
    // `bindings.tag`: quale tag leggere lo dice il valore di `scelta`. Le
    // dipendenze non si possono sapere prima: l'oggetto dichiara `tutti`.
    const oggetti = [{ id: "t", type: "text", x: 0, y: 20, width: 80, height: 20, bindings: { tag: "scelta" } }] as SynopticObject[];
    const { rerender, container } = render(
      <SvgCanvas objects={oggetti} tagValues={{ scelta: v("x1"), x1: v(10), x2: v(20) }} />,
    );
    expect(container.textContent).toContain("10");
    rerender(<SvgCanvas objects={oggetti} tagValues={{ scelta: v("x1"), x1: v(11), x2: v(20) }} />);
    expect(container.textContent).toContain("11");
    rerender(<SvgCanvas objects={oggetti} tagValues={{ scelta: v("x2"), x1: v(11), x2: v(20) }} />);
    expect(container.textContent).toContain("20");
  });

  it("i dati in ritardo ingrigiscono ogni oggetto, anche quelli senza tag cambiati", () => {
    const oggetti = [
      { id: "r", type: "rect", x: 0, y: 0, width: 40, height: 40 },
      { id: "t", type: "text", x: 0, y: 60, width: 80, height: 20, tag: "a" },
    ] as SynopticObject[];
    const valori = { a: v(1) };
    const { rerender, container } = render(<SvgCanvas objects={oggetti} tagValues={valori} />);
    const grigi = () => [...container.querySelectorAll("g")].filter((g) => g.style.filter.includes("grayscale")).length;
    expect(grigi()).toBe(0);
    rerender(<SvgCanvas objects={oggetti} tagValues={valori} nonAggiornato />);
    expect(grigi()).toBe(2);
    rerender(<SvgCanvas objects={oggetti} tagValues={valori} nonAggiornato={false} />);
    expect(grigi()).toBe(0);
  });
});

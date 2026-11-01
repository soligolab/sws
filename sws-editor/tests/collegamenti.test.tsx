/** La sezione «Collegamenti» (01-11-2026, piano
 *  docs/plans/2026-11-01-pannello-proprieta-per-frequenza.md, fase 2): tutti i
 *  tag dell'oggetto in un punto, solo quelli collegati più il principale. */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import i18n from "../src/i18n";
import { useAppStore } from "../src/store";
import { ObjectProps, PannelloDestro, gruppiPerTipo } from "../src/editor/EditorShell";
import { Collegamenti } from "../src/editor/proprieta/Collegamenti";
import { slotDi } from "../src/editor/proprieta/slotTag";
import type { SynopticObject } from "../src/types";

const oggetto = (type: string, extra: Partial<SynopticObject> = {}) =>
  ({ id: `o-${type}`, type, x: 0, y: 0, width: 100, height: 40, ...extra }) as SynopticObject;
const slotVisti = () => screen.queryAllByText((_, el) => !!el?.getAttribute("data-slot")).map((e) => e.getAttribute("data-slot"));
const voci = () => Array.from(screen.getByTestId("collega-slot").querySelectorAll("option")).slice(1).map((o) => o.getAttribute("value"));

describe("Collegamenti", () => {
  beforeEach(() => useAppStore.setState({ tagValues: {} }));

  it("il principale c'è sempre, anche vuoto; gli altri solo collegati", () => {
    render(<Collegamenti obj={oggetto("symbol")} onChange={() => {}} stileCampo={{}} />);
    expect(slotVisti()).toEqual(["state_tag"]);
    expect(voci()).toContain("alarm_tag");
    expect(voci()).toContain("visible_tag");
  });

  it("un tag collegato si vede, con la direzione divisa fra letti e scritti", () => {
    render(<Collegamenti obj={oggetto("symbol", { state_tag: "a", alarm_tag: "b", command_tag: "c" })} onChange={() => {}} stileCampo={{}} />);
    expect(slotVisti()).toEqual(["state_tag", "alarm_tag", "command_tag"]);
    expect(screen.getByText(i18n.t("props.slot.letti"))).toBeTruthy();
    expect(screen.getByText(i18n.t("props.slot.scritti"))).toBeTruthy();
    expect(voci()).not.toContain("alarm_tag");
  });

  it("«+ Collega…» mostra lo slot vuoto senza scrivere niente nel progetto", () => {
    const onChange = vi.fn();
    render(<Collegamenti obj={oggetto("gauge")} onChange={onChange} stileCampo={{}} />);
    fireEvent.change(screen.getByTestId("collega-slot"), { target: { value: "gauge_sp_tag" } });
    expect(slotVisti()).toContain("gauge_sp_tag");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("collegare accende la modalità che il tag aspetta, scollegare la spegne", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Collegamenti obj={oggetto("rect")} onChange={onChange} stileCampo={{}} />);
    fireEvent.change(screen.getByTestId("collega-slot"), { target: { value: "blink_tag" } });
    expect(onChange).toHaveBeenLastCalledWith({ blink_mode: "tag" });
    rerender(<Collegamenti obj={oggetto("rect", { blink_mode: "tag", blink_tag: "x" })} onChange={onChange} stileCampo={{}} />);
    fireEvent.click(screen.getByTestId("scollega-blink_tag"));
    expect(onChange).toHaveBeenLastCalledWith({ blink_tag: undefined, blink_mode: undefined });
  });

  it("il comando del simbolo vale anche vuoto, e scollegarlo toglie anche le assegnazioni", () => {
    const onChange = vi.fn();
    render(<Collegamenti obj={oggetto("symbol", { command_tag: "", assegnazioni: [{ tag: "t", valore: 1 }] })} onChange={onChange} stileCampo={{}} />);
    expect(slotVisti()).toContain("command_tag");
    fireEvent.click(screen.getByTestId("scollega-command_tag"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ command_tag: undefined, assegnazioni: undefined }));
  });

  it("ogni riga mostra il valore live, colorato dalla qualità", () => {
    useAppStore.setState({ tagValues: { "p.livello": { value: 42.123456, quality: "Good", timestamp_ms: 0 } } });
    render(<Collegamenti obj={oggetto("gauge", { tag: "p.livello" })} onChange={() => {}} stileCampo={{}} />);
    const live = screen.getByTestId("valore-live");
    expect(live.textContent).toBe("42.123");
    expect(live.getAttribute("title")).toBe("Good");
  });

  it("i tag in lista e i 🔗 dei campi hanno un riepilogo", () => {
    render(<Collegamenti obj={oggetto("trend", {
      trend_tags: [{ tag: "a" }, { tag: "b" }, { tag: "" }],
      bindings: { opacity: "c" },
    })} onChange={() => {}} stileCampo={{}} />);
    expect(screen.getByTestId("vai-trend_tags").textContent).toContain(i18n.t("props.slot.nTag", { count: 2 }));
    expect(screen.getByTestId("vai-opacity").textContent).toContain("c");
  });

  it("gli slot che il disegno non ha non si offrono", () => {
    render(<Collegamenti obj={oggetto("pie_chart")} onChange={() => {}} stileCampo={{}} />);
    expect(voci()).not.toContain("pie_center_tag");
    expect(slotDi(oggetto("pie_chart", { pie_mode: "donut" })).map((s) => s.campo)).toContain("pie_center_tag");
  });
});

describe("Collegamenti nel pannello", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });

  it("sta in testa al ramo della funzione, e la qualità solo con un tag", () => {
    const Guscio = ({ obj }: { obj: SynopticObject }) => (
      <PannelloDestro larghezza={280} onRidimensiona={() => {}} titolo="x" tipo={obj.type} gruppiVisibili={gruppiPerTipo(obj.type)}
        aSezioni chiaveOggetto={obj.id} bloccato={false}>
        <ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
      </PannelloDestro>
    );
    const { rerender } = render(<Guscio obj={oggetto("gauge")} />);
    expect(screen.getAllByTestId(/^sezione-/)[0].dataset.testid).toBe("sezione-collegamenti");
    expect(screen.queryByTestId("sezione-quality")).toBeNull();
    rerender(<Guscio obj={oggetto("gauge", { tag: "p.x" })} />);
    expect(screen.getByTestId("sezione-quality")).toBeTruthy();
  });

  it("un clic su un 🔗 apre il ramo del campo", () => {
    const obj = oggetto("rect", { bindings: { rotation: "p.angolo" } });
    render(
      <PannelloDestro larghezza={280} onRidimensiona={() => {}} titolo="x" tipo="rect" gruppiVisibili={gruppiPerTipo("rect")}
        aSezioni chiaveOggetto={obj.id} bloccato={false}>
        <ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
      </PannelloDestro>,
    );
    expect(screen.queryByTestId("sezione-transform")).toBeNull();
    fireEvent.click(within(screen.getByTestId("collegamenti")).getByTestId("vai-rotation"));
    expect(screen.getByTestId("sezione-transform")).toBeTruthy();
  });
});

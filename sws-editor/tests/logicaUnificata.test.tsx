/** La logica in un ramo solo (piano `docs/archive/2026-11-04-logica-unificata.md`,
 *  sessione L1, 08-11-2026): funzioni e script nello stesso editor al centro,
 *  la rinomina di una funzione che segue chi la chiama, il codice delle
 *  funzioni nella ricerca degli usi e nella rinomina dei tag, le cancellazioni
 *  che chiedono. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { conferma } = vi.hoisted(() => ({ conferma: vi.fn() }));
vi.mock("@/finestraAvviso/finestraAvviso", async () => {
  const actual = await vi.importActual<typeof import("@/finestraAvviso/finestraAvviso")>("@/finestraAvviso/finestraAvviso");
  return { ...actual, conferma };
});
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getProject: vi.fn().mockResolvedValue(null), listRecipes: vi.fn().mockResolvedValue([]),
    updateFunctions: vi.fn(async () => {}), saveGlobalScripts: vi.fn(async () => {}), checkScript: vi.fn(),
    updateCustomSymbols: vi.fn(async () => {}), saveSynoptic: vi.fn(async () => {}) } };
});

import i18n from "../src/i18n";
import { api } from "../src/api/client";
import { scriptCambiati, useAppStore } from "../src/store";
import { sostituisciFunzione } from "../src/logica/rinominaFunzione";
import { buildTagUsage } from "../src/search/tagUsage";
import { rinomina } from "../src/tag/rinominaTag";
import { LogicaEditor } from "../src/editor/LogicaEditor";
import { LeftPanel } from "../src/editor/LeftPanel";
import type { FunctionDef, GlobalScriptDef, ProjectInfo, SynopticPage } from "../src/types";
import type { Richiesta } from "../src/finestraAvviso/finestraAvviso";

beforeAll(async () => { await i18n.changeLanguage("it"); });

const FN: FunctionDef = { id: "f1", name: "accendi", code: "tags.write(\"luce\", True)\n", params: [] };
const SCRIPT: GlobalScriptDef = { id: "giornata", trigger: { kind: "interval", interval_s: 1 }, code: "print(tags.read('luce'))\n", enabled: true };
const PAGINA = {
  id: "p1", name: "Casa", objects: [
    { id: "b1", type: "button", x: 0, y: 0, on_press_fn: "accendi" },
    { id: "g1", type: "grid", x: 0, y: 0, grid_cells: [{ row: 0, col: 0, on_release_fn: "accendi",
      sub: { orientation: "rows", ratio: 0.5, a: { on_press_fn: "accendi" }, b: { on_press_fn: "altra" } } }] },
  ],
} as unknown as SynopticPage;

function progetto(): ProjectInfo {
  return { meta: { name: "Casa", version: "1" }, tags: [{ id: "luce", data_type: "bool" }], functions: [structuredClone(FN)],
    global_scripts: [structuredClone(SCRIPT)] } as unknown as ProjectInfo;
}

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* jsdom */ }
  useAppStore.setState({
    project: progetto(), savedGlobalScripts: JSON.stringify([SCRIPT]),
    pages: [structuredClone(PAGINA)], currentPageId: "p1", past: [], future: [], pagesRev: 0, savedPagesRev: 0,
    selectedFunctionId: null, selectedScriptId: null, authRole: "Admin", appMode: "edit", pendingSections: {},
  });
});

describe("rinominare una funzione", () => {
  it("cambia ogni chiamata, a qualunque profondità, e lascia le altre", () => {
    const r = sostituisciFunzione(PAGINA, "accendi", "luce_on");
    expect(r.n).toBe(3);
    expect(JSON.stringify(r.valore)).not.toContain("\"accendi\"");
    expect(JSON.stringify(r.valore)).toContain("\"altra\"");
    expect(sostituisciFunzione(PAGINA, "nessuna", "x").valore).toBe(PAGINA);
  });

  it("nello store porta con sé le pagine, in un passo di cronologia", () => {
    useAppStore.getState().renameFunction("f1", "luce_on");
    const st = useAppStore.getState();
    expect(st.project?.functions?.[0].name).toBe("luce_on");
    expect(JSON.stringify(st.pages)).toContain("\"luce_on\"");
    expect(st.past).toHaveLength(1);
    expect(st.pagesRev).toBe(1);
  });
});

describe("gli script nello store", () => {
  it("rinominare lo script aperto sposta anche la selezione, e lo segna da salvare", () => {
    const st = useAppStore.getState();
    st.selectScript("giornata");
    expect(scriptCambiati(useAppStore.getState())).toBe(false);
    st.updateScript("giornata", { id: "mattino" });
    expect(useAppStore.getState().selectedScriptId).toBe("mattino");
    expect(scriptCambiati(useAppStore.getState())).toBe(true);
  });

  it("uno script nuovo si apre nell'editor e non si scrive da solo", () => {
    const id = useAppStore.getState().addScript();
    expect(useAppStore.getState().selectedScriptId).toBe(id);
    expect(api.saveGlobalScripts).not.toHaveBeenCalled();
  });
});

describe("il codice delle funzioni conta", () => {
  it("nella ricerca degli usi", () => {
    const usi = buildTagUsage({ pages: [], functions: [FN] });
    expect(usi.get("luce")?.[0]).toMatchObject({ categoria: "funzione" });
  });

  it("nella rinomina dei tag", () => {
    const e = rinomina("luce", "lampada", { pages: [], faceplates: [], tags: [{ id: "luce", data_type: "bool" }] as never,
      sources: [], alarms: [], globalScripts: [], functions: [FN], recipes: [] });
    expect(e.funzioniCambiate).toBe(true);
    expect(e.functions[0].code).toContain("\"lampada\"");
    expect(e.punti.some((p) => p.tipo === "funzione")).toBe(true);
  });
});

describe("l'editor della logica", () => {
  it("uno script: il nome si applica uscendo dal campo, e «Controlla» mostra i rilievi", async () => {
    vi.mocked(api.checkScript).mockResolvedValue({ ok: false, sandbox_verificata: true, rilievi: [{ riga: 2, messaggio: "nome sconosciuto", vietato: false }] });
    useAppStore.getState().selectScript("giornata");
    const voce = () => ({ tipo: "script" as const, script: useAppStore.getState().project!.global_scripts!.find((g) => g.id === useAppStore.getState().selectedScriptId)! });
    const { rerender } = render(<LogicaEditor voce={voce()} onClose={() => {}} />);
    const nome = screen.getByTestId("logica-nome");
    fireEvent.change(nome, { target: { value: "mattino" } });
    expect(useAppStore.getState().project?.global_scripts?.[0].id).toBe("giornata");
    fireEvent.blur(nome);
    expect(useAppStore.getState().project?.global_scripts?.[0].id).toBe("mattino");
    rerender(<LogicaEditor voce={voce()} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("logica-controlla"));
    await waitFor(() => expect(screen.getByTestId("logica-rilievo").textContent).toContain("nome sconosciuto"));
    expect(api.checkScript).toHaveBeenCalledWith(SCRIPT.code);
  });

  it("una funzione non si rinomina col nome di un'altra", () => {
    useAppStore.setState({ project: { ...progetto(), functions: [structuredClone(FN), { ...FN, id: "f2", name: "spegni" }] } });
    render(<LogicaEditor voce={{ tipo: "funzione", fn: useAppStore.getState().project!.functions![0] }} onClose={() => {}} />);
    const nome = screen.getByTestId("logica-nome");
    fireEvent.change(nome, { target: { value: "spegni" } });
    fireEvent.blur(nome);
    expect(useAppStore.getState().project?.functions?.[0].name).toBe("accendi");
    expect(document.body.textContent).toContain(i18n.t("logica.nomeGiaUsato", { nome: "spegni" }) as string);
  });
});

describe("il ramo Logica del pannello sinistro", () => {
  const apri = () => {
    render(<LeftPanel />);
    fireEvent.click(screen.getByText(i18n.t("leftPanel.logica") as string));
  };

  it("mostra funzioni e script, e uno script si apre al clic", () => {
    apri();
    expect(screen.getByTestId("logica-funzione-accendi")).toBeTruthy();
    fireEvent.click(screen.getByTestId("logica-script-giornata"));
    expect(useAppStore.getState().selectedScriptId).toBe("giornata");
  });

  it("cancellare una funzione chiede, e col no non cancella", async () => {
    conferma.mockResolvedValue(false);
    apri();
    const riga = screen.getByTestId("logica-funzione-accendi");
    fireEvent.click(riga.querySelector(`[title="${i18n.t("editor.delete")}"]`)!);
    await waitFor(() => expect(conferma).toHaveBeenCalled());
    expect(useAppStore.getState().project?.functions).toHaveLength(1);
    expect(api.updateFunctions).not.toHaveBeenCalled();
  });
});

describe("il Salva unico e gli script", () => {
  it("li scrive solo se sono cambiati", async () => {
    await useAppStore.getState().saveAll();
    expect(api.saveGlobalScripts).not.toHaveBeenCalled();
    useAppStore.getState().updateScript("giornata", { enabled: false });
    await useAppStore.getState().saveAll();
    expect(api.saveGlobalScripts).toHaveBeenCalledOnce();
    expect(scriptCambiati(useAppStore.getState())).toBe(false);
  });
});

describe("Ctrl+Z dopo una rinomina", () => {
  it("riporta insieme il nome della funzione e i bottoni, e Ctrl+Y li rifà", () => {
    useAppStore.getState().renameFunction("f1", "luce_on");
    useAppStore.getState().undo();
    let st = useAppStore.getState();
    expect(st.project?.functions?.[0].name).toBe("accendi");
    expect(JSON.stringify(st.pages)).not.toContain("\"luce_on\"");
    useAppStore.getState().redo();
    st = useAppStore.getState();
    expect(st.project?.functions?.[0].name).toBe("luce_on");
    expect(JSON.stringify(st.pages)).toContain("\"luce_on\"");
  });
});

describe("Nuovo da modello (L3, 10-11-2026)", () => {
  it("si sceglie il modello, poi i tag; il codice nasce coi tag veri e la funzione si scrive", async () => {
    const { rispondi } = await import("../src/finestraAvviso/finestraAvviso");
    let corpo: ((fine: (v: unknown) => void) => React.ReactNode) | null = null;
    const auto = rispondi((r: Richiesta) => { if (r.tipo === "modulo") corpo = r.corpo as typeof corpo; return null; });
    render(<LeftPanel />);
    fireEvent.click(screen.getByText(i18n.t("leftPanel.logica") as string));
    fireEvent.click(screen.getByTestId("logica-nuovo-da-modello"));
    auto.ferma();
    await waitFor(() => expect(corpo).not.toBeNull());

    // Il modulo vero, disegnato a parte: la risposta la prende `fine`.
    const fine = vi.fn();
    render(<>{corpo!(fine)}</>);
    fireEvent.click(screen.getByTestId("modello-azzeramento_mezzanotte"));
    const crea = screen.getByTestId("modello-crea") as HTMLButtonElement;
    expect(crea.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("modello-tag-contatore").querySelector("input")!, { target: { value: "luce" } });
    fireEvent.click(crea);
    const nuovi = fine.mock.calls[0][0];
    expect(nuovi.funzioni[0].code).toContain('tags.write("luce", 0)');
    expect(nuovi.script[0].code).toContain(`functions.run("${nuovi.funzioni[0].name}")`);

    // E dal pannello: con la risposta, la funzione e lo script entrano nel progetto.
    const auto2 = rispondi(nuovi);
    fireEvent.click(screen.getAllByTestId("logica-nuovo-da-modello")[0]);
    auto2.ferma();
    await waitFor(() => expect(api.updateFunctions).toHaveBeenCalled());
    const st = useAppStore.getState();
    expect(st.project?.functions?.map((f) => f.name)).toContain(nuovi.funzioni[0].name);
    expect(st.project?.global_scripts?.map((g) => g.id)).toContain(nuovi.script[0].id);
    expect(st.selectedFunctionId).toBe(nuovi.funzioni[0].id);
  });
});

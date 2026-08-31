// La transazione dell'assistente: applicare, annullare, rifare.
//
// PERCHÉ QUESTO TEST ESISTE
//
// La history dell'editor nasce per le sole pagine (`pushHistory` fotografa
// `pages`, e un commento nello store lo dice: «undo only tracks page edits»).
// Tag, sorgenti e allarmi vivono in `project`, fuori dalla history, e
// ConfigView li scrive su disco subito col proprio Salva.
//
// Una proposta dell'assistente attraversa quella frattura: un bottone MQTT è
// una sorgente, un tag e un oggetto in pagina. Applicata a metà, e annullata a
// metà, è **peggio** di una non applicata — perché sembra funzionare.
//
// Qui si prova che è una cosa sola: un passo di annullamento, e niente su disco
// finché non si salva.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    getProjectFingerprint: vi.fn(async () => ({ sha256: "IMPRONTA", computed_at_ms: 0 })),
    updateTags: vi.fn(async () => {}),
    updateSources: vi.fn(async () => {}),
    updateAlarms: vi.fn(async () => {}),
    saveSynoptic: vi.fn(async () => {}),
    updateFunctions: vi.fn(async () => {}),
    updateCustomSymbols: vi.fn(async () => {}),
    deleteSynoptic: vi.fn(async () => {}),
  },
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));

import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { AiProposta } from "@/store";
import type { ProjectInfo, SynopticPage } from "@/types";

const PAGINA: SynopticPage = {
  id: "pg1",
  name: "Indicatori",
  objects: [{ id: "gauge1", type: "gauge", x: 10, y: 10 }],
};

const PROGETTO = {
  meta: { name: "prova", version: "1.0.0" },
  tags: [{ id: "esistente", data_type: "float", description: "" }],
  sources: [],
  alarms: [],
} as unknown as ProjectInfo;

/** La proposta del bersaglio di T-50: sorgente + tag + bottone, insieme. */
function proposta(): AiProposta {
  return {
    id: "p1",
    motivo: "bottone on/off per la luce del salotto via MQTT",
    impronta: "IMPRONTA",
    project: {
      ...PROGETTO,
      tags: [...PROGETTO.tags, { id: "luce.salotto", data_type: "bool", description: "Luce" }],
      sources: [{ kind: "mqtt", id: "broker-casa", host: "192.168.1.50", port: 1883,
                  topics: [{ tag: "luce.salotto", topic: "casa/salotto/luce/stato",
                             publish_topic: "casa/salotto/luce/set" }] }],
    } as unknown as ProjectInfo,
    pages: [{
      ...PAGINA,
      objects: [...PAGINA.objects,
                { id: "btn_luce", type: "button", x: 40, y: 40, tag: "luce.salotto",
                  button_mode: "toggle" }],
    }] as SynopticPage[],
  };
}

function reset() {
  useAppStore.setState({
    project: structuredClone(PROGETTO),
    pages: [structuredClone(PAGINA)],
    currentPageId: "pg1",
    past: [], future: [],
    pagesRev: 0, savedPagesRev: 0,
    persistedPageNames: ["Indicatori"],
    pendingSections: {},
    authRole: "Admin",
  });
}

describe("la transazione dell'assistente", () => {
  beforeEach(() => { reset(); vi.clearAllMocks(); });

  it("applica le due metà insieme", async () => {
    const esito = await useAppStore.getState().applyAiProposal(proposta());
    expect(esito.ok).toBe(true);

    const s = useAppStore.getState();
    expect(s.pages[0].objects.map((o) => o.id)).toContain("btn_luce");
    expect(s.project?.tags.map((t) => t.id)).toContain("luce.salotto");
    expect(s.project?.sources).toHaveLength(1);
  });

  it("non scrive niente su disco finché nessuno salva", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    expect(api.updateTags).not.toHaveBeenCalled();
    expect(api.updateSources).not.toHaveBeenCalled();
    expect(api.saveSynoptic).not.toHaveBeenCalled();
  });

  it("un solo Ctrl+Z riporta indietro tutto, non metà", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    useAppStore.getState().undo();

    const s = useAppStore.getState();
    expect(s.pages[0].objects.map((o) => o.id)).not.toContain("btn_luce");
    expect(s.project?.tags.map((t) => t.id)).not.toContain("luce.salotto");
    expect(s.project?.sources).toHaveLength(0);
  });

  it("e il redo le rimette insieme", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    useAppStore.getState().undo();
    useAppStore.getState().redo();

    const s = useAppStore.getState();
    expect(s.pages[0].objects.map((o) => o.id)).toContain("btn_luce");
    expect(s.project?.tags.map((t) => t.id)).toContain("luce.salotto");
    expect(s.project?.sources).toHaveLength(1);
  });

  it("Salva scrive tag e sorgenti, che saveAll da sola non toccherebbe", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    await useAppStore.getState().saveAll();

    expect(api.updateTags).toHaveBeenCalledTimes(1);
    expect(api.updateSources).toHaveBeenCalledTimes(1);
    // Gli allarmi non sono cambiati: non si scrivono. Riscrivere una sezione
    // intatta è il modo in cui una copia in memoria più povera del disco
    // cancella dati (audit del 2026-07-28).
    expect(api.updateAlarms).not.toHaveBeenCalled();
    expect(api.saveSynoptic).toHaveBeenCalled();
  });

  it("un secondo Salva non riscrive le stesse sezioni", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    await useAppStore.getState().saveAll();
    await useAppStore.getState().saveAll();
    expect(api.updateTags).toHaveBeenCalledTimes(1);
  });

  it("rifiuta la proposta se il progetto è cambiato nel frattempo", async () => {
    vi.mocked(api.getProjectFingerprint).mockResolvedValueOnce(
      { sha256: "UN'ALTRA", computed_at_ms: 0 } as never);

    const esito = await useAppStore.getState().applyAiProposal(proposta());
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toMatch(/cambiato/);

    // E soprattutto: non ha toccato niente.
    const s = useAppStore.getState();
    expect(s.pages[0].objects.map((o) => o.id)).not.toContain("btn_luce");
    expect(s.project?.sources).toHaveLength(0);
    expect(s.past).toHaveLength(0);
  });

  it("avvisa quando c'erano modifiche non salvate", async () => {
    // L'assistente legge dal disco: quello che c'era solo in memoria se ne va.
    // L'impronta non se ne accorge, perché il disco non è cambiato.
    useAppStore.setState({ pagesRev: 7, savedPagesRev: 0 });
    const esito = await useAppStore.getState().applyAiProposal(proposta());
    expect(esito.ok).toBe(true);
    expect(esito.avviso).toMatch(/non salvate/);
  });

  it("una proposta che tocca solo le pagine non registra sezioni", async () => {
    const p = proposta();
    p.project = null;
    await useAppStore.getState().applyAiProposal(p);
    expect(Object.keys(useAppStore.getState().pendingSections)).toHaveLength(0);
  });
});

describe("il diff non deve mentire", () => {
  beforeEach(() => { reset(); vi.clearAllMocks(); });

  it("un oggetto identico ma con le chiavi in altro ordine non è una modifica", async () => {
    // È il caso vero: l'API serve la pagina nell'ordine del file YAML, la
    // proposta passa dalla struct Rust. Misurato il 2026-08-31, su una
    // proposta che aggiungeva un bottone: 46 oggetti su 47 «modificati».
    const p = proposta();
    p.pages = [{
      ...PAGINA,
      objects: [
        // stesso gauge, chiavi rimescolate
        { y: 10, type: "gauge", id: "gauge1", x: 10 },
        { id: "btn_luce", type: "button", x: 40, y: 40, tag: "luce.salotto", button_mode: "toggle" },
      ],
    }] as SynopticPage[];

    const primaDelGauge = useAppStore.getState().pages[0].objects[0];
    await useAppStore.getState().applyAiProposal(p);
    const dopo = useAppStore.getState().pages[0];

    // L'istanza è la STESSA: non riscritta, quindi il salvataggio non
    // riordinerà le sue chiavi nel file YAML.
    expect(dopo.objects[0]).toBe(primaDelGauge);
    expect(dopo.objects.map((o) => o.id)).toEqual(["gauge1", "btn_luce"]);
  });

  it("ma un oggetto davvero cambiato viene sostituito", async () => {
    const p = proposta();
    p.pages = [{
      ...PAGINA,
      objects: [{ id: "gauge1", type: "gauge", x: 10, y: 999 }],
    }] as SynopticPage[];

    await useAppStore.getState().applyAiProposal(p);
    expect(useAppStore.getState().pages[0].objects[0].y).toBe(999);
  });
});

describe("dove porta l'applicazione", () => {
  beforeEach(() => { reset(); vi.clearAllMocks(); });

  it("va sulla pagina toccata, se non ci si è già", async () => {
    useAppStore.setState({
      pages: [structuredClone(PAGINA), { id: "pg2", name: "Altra", objects: [] }],
      currentPageId: "pg2",
      persistedPageNames: ["Indicatori", "Altra"],
    });
    await useAppStore.getState().applyAiProposal(proposta());
    expect(useAppStore.getState().currentPageId).toBe("pg1");
  });

  it("e non si sposta se la pagina toccata è già quella aperta", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    expect(useAppStore.getState().currentPageId).toBe("pg1");
  });
});

describe("le scritture su project.yaml non si pestano i piedi", () => {
  beforeEach(() => { reset(); vi.clearAllMocks(); });

  /**
   * `patch_project` lato server è un leggi-modifica-scrivi senza lock: due PUT
   * in volo insieme leggono lo stesso file e l'ultimo cancella l'altro, senza
   * dire niente. Misurato il 2026-08-31 nel browser: una proposta che creava
   * un tag *e* una sorgente ne salvava una sola.
   *
   * Non basta contare le chiamate: bisogna provare che la seconda parte solo
   * dopo che la prima è tornata.
   */
  it("tag e sorgenti si salvano una per volta", async () => {
    const ordine: string[] = [];
    let sbloccaTags: (() => void) | null = null;
    vi.mocked(api.updateTags).mockImplementation(async () => {
      ordine.push("tags:inizio");
      await new Promise<void>((r) => { sbloccaTags = r; });
      ordine.push("tags:fine");
    });
    vi.mocked(api.updateSources).mockImplementation(async () => {
      ordine.push("sources:inizio");
    });

    await useAppStore.getState().applyAiProposal(proposta());
    const salvataggio = useAppStore.getState().saveAll();

    await new Promise((r) => setTimeout(r, 10));
    // Con le scritture in parallelo, qui `sources:inizio` sarebbe già passato.
    expect(ordine).toEqual(["tags:inizio"]);

    sbloccaTags!();
    await salvataggio;
    expect(ordine).toEqual(["tags:inizio", "tags:fine", "sources:inizio"]);
  });
});

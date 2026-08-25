import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectIsDirty, useAppStore } from "../src/store";

// Il registro delle bozze pendenti, e la regressione che l'ha reso pericoloso.
//
// Il 2026-07-28 "Salva tutto" azzerò le variabili di un progetto: la tab
// Variabili si registrava in base a un confronto strutturale bozza-vs-store, e
// una bozza momentaneamente disallineata — vuota perché non ancora popolata —
// veniva scritta su disco sopra 16 variabili vere. L'audit lo registrò come
// `{"count": 0, "what": "tags"}`.
//
// La correzione non è stata smettere di registrarsi (quello fu il tampone del
// momento, che tolse Variabili e Allarmi da "Salva tutto" per un mese) ma
// cambiare il criterio: si registra chi ha ricevuto una modifica DALL'UTENTE,
// non chi differisce dallo store. Questi test difendono quel criterio dal lato
// dello store: che una sezione senza intenzione non venga mai eseguita, e che
// una con intenzione lo sia.

const dirty = () => selectIsDirty(useAppStore.getState());

describe("bozze pendenti", () => {
  beforeEach(() => {
    useAppStore.setState({ pendingSections: {} });
    useAppStore.getState().setPages([{ id: "p1", name: "Page 1", objects: [] }], "p1");
  });

  it("una sezione registrata rende il progetto modificato", () => {
    expect(dirty()).toBe(false);
    useAppStore.getState().registerPendingSection("tags", async () => {});
    expect(dirty()).toBe(true);
  });

  /// Il cuore della regressione: passare `null` deve TOGLIERE la sezione, non
  /// lasciarla registrata con una funzione inerte. Se restasse, "Salva tutto"
  /// la eseguirebbe — ed è così che una bozza non toccata finisce su disco.
  it("registrare null rimuove la sezione invece di disattivarla", () => {
    const s = useAppStore.getState();
    s.registerPendingSection("tags", async () => {});
    expect(Object.keys(useAppStore.getState().pendingSections)).toEqual(["tags"]);

    s.registerPendingSection("tags", null);
    expect(Object.keys(useAppStore.getState().pendingSections)).toEqual([]);
    expect(dirty()).toBe(false);
  });

  it("sezioni diverse non si sovrascrivono a vicenda", () => {
    const s = useAppStore.getState();
    s.registerPendingSection("tags", async () => {});
    s.registerPendingSection("alarms", async () => {});
    expect(Object.keys(useAppStore.getState().pendingSections).sort()).toEqual(["alarms", "tags"]);

    s.registerPendingSection("tags", null);
    expect(Object.keys(useAppStore.getState().pendingSections)).toEqual(["alarms"]);
  });

  /// "Salva tutto" esegue le sezioni registrate. Una sezione NON registrata —
  /// cioè una tab che l'utente non ha toccato — non deve essere eseguita: è
  /// esattamente la scrittura che nel 2026-07-28 cancellò le variabili.
  it("saveAll esegue solo le sezioni registrate", async () => {
    const toccata = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().registerPendingSection("tags", toccata);

    await useAppStore.getState().saveAll();

    expect(toccata).toHaveBeenCalledOnce();
  });

  it("saveAll con nessuna sezione registrata non scrive niente di sezione", async () => {
    const mai = vi.fn().mockResolvedValue(undefined);
    // registrata e subito tolta: è il ciclo di vita di una tab aperta, guardata
    // e chiusa senza modifiche.
    const s = useAppStore.getState();
    s.registerPendingSection("tags", mai);
    s.registerPendingSection("tags", null);

    await useAppStore.getState().saveAll();

    expect(mai).not.toHaveBeenCalled();
  });

  /// Un salvataggio riuscito azzera il registro: le bozze sono su disco, e
  /// lasciarle pendenti farebbe riscrivere le stesse cose al giro dopo.
  it("resetDirty svuota il registro", () => {
    useAppStore.getState().registerPendingSection("tags", async () => {});
    useAppStore.getState().resetDirty();
    expect(useAppStore.getState().pendingSections).toEqual({});
    expect(dirty()).toBe(false);
  });
});

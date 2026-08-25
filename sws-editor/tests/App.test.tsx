import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock di `@/api/client` — deve stare PRIMA dell'import di App, perché
// `vi.mock` è issato ma il modulo va sostituito prima che App lo risolva.
//
// Perché esiste: `App` ha un gate `bootstrapping` che rende `null` finché
// `getProject()` + `whoami()` non hanno risposto. In jsdom quelle chiamate non
// arrivano da nessuna parte, quindi senza mock il DOM resta vuoto e non c'è
// niente da interrogare. Il test precedente si limitava a "monta senza
// lanciare": passava sempre, anche con l'interfaccia completamente rotta.
//
// Si mocka SOLO ciò che serve al bootstrap. Il resto delle chiamate torna un
// rifiuto: un componente che ne fa una inattesa lo dice invece di ricevere
// silenziosamente `undefined`, che è il modo tipico in cui un test finto
// diventa verde.
const project = {
  meta: { name: "ProgettoDiProva", version: "1.0.0" },
  tags: [],
  sources: [],
  alarms: [],
  functions: [],
  custom_symbols: [],
  datastores: [],
  global_scripts: [],
};

const getProject = vi.fn();
const whoami = vi.fn();
const listSynoptics = vi.fn();

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: new Proxy(
      { getProject, whoami, listSynoptics },
      {
        get(target: Record<string, unknown>, prop: string) {
          if (prop in target) return target[prop];
          return vi.fn().mockRejectedValue(
            new Error(`chiamata API non prevista dal test: ${String(prop)}`),
          );
        },
      },
    ),
  };
});

// jsdom non implementa `scrollIntoView`: senza questo stub un effetto che
// scorre alla riga corrente lancia dentro il commit di React, e il test finisce
// con "2 errors" pur passando. Non è un difetto dell'applicazione — è una
// funzione del browser che jsdom non ha.
Element.prototype.scrollIntoView = vi.fn();

const { App } = await import("../src/App");

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProject.mockResolvedValue(project);
    whoami.mockResolvedValue({ username: "admin", role: "Admin", must_change_password: false });
    listSynoptics.mockResolvedValue([]);
  });

  it("monta senza lanciare", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  /// Il gate `bootstrapping` rende `null` finché le due chiamate non tornano:
  /// se questo non passa, l'app resta bianca all'avvio — che è il modo in cui
  /// un utente vede un guasto del bootstrap.
  it("supera il bootstrap e mostra il nome del progetto attivo", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/ProgettoDiProva/)).toBeTruthy();
    });
    expect(getProject).toHaveBeenCalled();
  });

  /// Senza progetto aperto il runtime risponde 503 e l'app deve portare alla
  /// schermata di scelta, non a quella di accesso: è la differenza fra "non hai
  /// un progetto" e "non sei autenticato", e confonderle manda l'utente a
  /// cercare credenziali che non c'entrano.
  it("senza progetto attivo mostra la schermata di scelta, non il login", async () => {
    const { NoProjectError } = await import("@/api/client");
    getProject.mockRejectedValue(new NoProjectError());
    render(<App />);
    await waitFor(() => {
      expect(document.body.textContent).not.toBe("");
    });
    expect(document.body.textContent).not.toMatch(/password/i);
  });
});

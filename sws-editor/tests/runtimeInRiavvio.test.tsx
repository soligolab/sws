// L'IDE attende il runtime che si riavvia e riprende (10-11-2026).
//
// Prima un runtime che non rispondeva al montaggio portava alla WelcomeScreen
// come «nessun progetto»: si doveva riaprire il progetto a mano. Ora una
// schermata lo dice, si riprova ogni 2 s e al ritorno si riapre il progetto.
// Un 503 vero (nessun progetto) porta ancora alla WelcomeScreen, un 401 al
// login. Nel cloud anche il 503 è «si sta riavviando»: il container è il
// progetto, e il gateway lo scrive mentre il container riparte.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const project = {
  meta: { name: "ProgettoDiProva", version: "1.0.0" },
  tags: [], sources: [], alarms: [], functions: [], custom_symbols: [],
  datastores: [], global_scripts: [],
};

const getProject = vi.fn();
const whoami = vi.fn();
const loadAllPages = vi.fn();

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: new Proxy(
      { getProject, whoami, loadAllPages },
      {
        get(target: Record<string, unknown>, prop: string) {
          if (prop in target) return target[prop];
          return vi.fn().mockRejectedValue(new Error(`non prevista: ${String(prop)}`));
        },
      },
    ),
  };
});

let nelCloud = false;
vi.mock("@/api/prefisso", async () => {
  const actual = await vi.importActual<typeof import("@/api/prefisso")>("@/api/prefisso");
  return { ...actual, prefissoGateway: () => (nelCloud ? "/p/-/ProgettoDiProva" : "") };
});

vi.mock("@/components/WelcomeScreen", () => ({ WelcomeScreen: () => <div data-testid="welcome" /> }));
vi.mock("@/components/LoginScreen", () => ({ LoginScreen: () => <div data-testid="login" /> }));

Element.prototype.scrollIntoView = vi.fn();

const { App } = await import("../src/App");
const { AuthError, NoProjectError, RuntimeUnavailableError } = await import("@/api/client");
const { useAppStore } = await import("@/store");
const { runtimeSiStaRiavviando } = await import("@/components/RuntimeInRiavvio");

const pagina = (id: string, name: string) => ({ id, name, objects: [] });

beforeEach(() => {
  vi.clearAllMocks();
  nelCloud = false;
  useAppStore.getState().setAuth("tok", "admin", "Admin");
  useAppStore.getState().setNoActiveProject(false);
  whoami.mockResolvedValue({ username: "admin", role: "Admin", must_change_password: false });
  loadAllPages.mockResolvedValue([pagina("p1", "Uno"), pagina("p2", "Due")]);
});
afterEach(() => { cleanup(); useAppStore.getState().clearAuth(); });

describe("l'IDE con il runtime che si riavvia", () => {
  it("non risponde → la schermata, poi un nuovo tentativo → il progetto", async () => {
    getProject
      .mockRejectedValueOnce(new RuntimeUnavailableError())
      .mockResolvedValue(project);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("runtime-in-riavvio")).toBeTruthy());
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(useAppStore.getState().noActiveProject).toBe(false);

    await waitFor(() => expect(screen.getByText(/ProgettoDiProva/)).toBeTruthy(), { timeout: 5_000 });
    expect(getProject.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("runtime-in-riavvio")).toBeNull();
  }, 20_000);

  it("un 503 vero → la WelcomeScreen, senza attese", async () => {
    getProject.mockRejectedValue(new NoProjectError());
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("welcome")).toBeTruthy());
    expect(screen.queryByTestId("runtime-in-riavvio")).toBeNull();
  }, 20_000);

  it("un 401 → il login, anche quando arriva dopo l'attesa", async () => {
    getProject
      .mockRejectedValueOnce(new RuntimeUnavailableError())
      .mockRejectedValue(new AuthError());
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("runtime-in-riavvio")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("login")).toBeTruthy(), { timeout: 5_000 });
    expect(useAppStore.getState().authToken).toBeNull();
  }, 20_000);

  it("le modifiche non salvate e la pagina restano", async () => {
    // Lo store ha già il progetto, sulla pagina p2, con una modifica non salvata.
    getProject.mockResolvedValue(project);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/ProgettoDiProva/)).toBeTruthy());
    await waitFor(() => expect(useAppStore.getState().pages.length).toBe(2));
    useAppStore.getState().setCurrentPage("p2");
    useAppStore.setState((s) => ({ pagesRev: s.pagesRev + 1 }));
    const pagine = useAppStore.getState().pages;

    // Sessione scaduta e nuovo accesso mentre il runtime è giù: il giro di
    // montaggio riparte col token nuovo.
    getProject
      .mockReset()
      .mockRejectedValueOnce(new RuntimeUnavailableError())
      .mockResolvedValue(project);
    loadAllPages.mockClear();
    useAppStore.getState().setAuth("tok2", "admin", "Admin");
    await waitFor(() => expect(screen.getByTestId("runtime-in-riavvio")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/ProgettoDiProva/)).toBeTruthy(), { timeout: 5_000 });

    expect(useAppStore.getState().pages).toBe(pagine);
    expect(useAppStore.getState().currentPageId).toBe("p2");
  }, 20_000);
});

describe("runtimeSiStaRiavviando", () => {
  it("in locale solo il runtime che non risponde; nel cloud anche il 503", () => {
    expect(runtimeSiStaRiavviando(new RuntimeUnavailableError(), false)).toBe(true);
    expect(runtimeSiStaRiavviando(new NoProjectError(), false)).toBe(false);
    expect(runtimeSiStaRiavviando(new NoProjectError(), true)).toBe(true);
    expect(runtimeSiStaRiavviando(new AuthError(), true)).toBe(false);
  });
});

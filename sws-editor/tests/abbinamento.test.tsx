/** Il pannello in attesa di abbinamento (11-10-2026): finché non ha utenti
 *  mostra il codice al posto di qualunque pagina, e da lì si crea il suo
 *  amministratore. Piano `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n/index";
import { CancelloAbbinamento } from "../src/components/AbbinamentoScreen";
import { useAppStore } from "../src/store";

function risposta(stato: number, corpo: unknown) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status: stato }));
}

describe("CancelloAbbinamento", () => {
  const fetchFinto = vi.fn();
  beforeEach(() => {
    fetchFinto.mockReset();
    vi.stubGlobal("fetch", fetchFinto);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("un pannello in attesa mostra il codice e non la pagina", async () => {
    fetchFinto.mockReturnValueOnce(risposta(200, { in_attesa: true, codice: "7KQ2-M9XD-3HWP-T4BZ", nome: "tc620" }));
    render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    expect((await screen.findByTestId("codice-abbinamento")).textContent).toBe("7KQ2-M9XD-3HWP-T4BZ");
    expect(screen.queryByText("pagina")).toBeNull();
  });

  it("un pannello abbinato, o un runtime vecchio, lascia passare", async () => {
    fetchFinto.mockReturnValueOnce(risposta(200, { in_attesa: false, codice: null, nome: "tc620" }));
    const { unmount } = render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    expect(await screen.findByText("pagina")).toBeTruthy();
    unmount();
    fetchFinto.mockReturnValueOnce(risposta(404, {}));
    render(<CancelloAbbinamento><div>pagina vecchia</div></CancelloAbbinamento>);
    expect(await screen.findByText("pagina vecchia")).toBeTruthy();
  });

  it("creare l'amministratore manda il codice e fa entrare", async () => {
    useAppStore.setState({ authToken: null } as never);
    fetchFinto
      .mockReturnValueOnce(risposta(200, { in_attesa: true, codice: "7KQ2-M9XD-3HWP-T4BZ", nome: "tc620" }))
      .mockReturnValueOnce(risposta(200, { token: "t-1", username: "admin", role: "Admin", must_change_password: false, expires_at_ms: 1 }));
    render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    await screen.findByTestId("codice-abbinamento");
    const pw = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pw[0], { target: { value: "lunga-abbastanza" } });
    fireEvent.change(pw[1], { target: { value: "lunga-abbastanza" } });
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("pagina")).toBeTruthy();
    const [url, init] = fetchFinto.mock.calls[1];
    expect(url).toBe("/api/abbinamento/rivendica");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      codice: "7KQ2-M9XD-3HWP-T4BZ", username: "admin", password: "lunga-abbastanza",
    });
    await waitFor(() => expect(useAppStore.getState().authToken).toBe("t-1"));
  });

  it("una password corta non parte", async () => {
    fetchFinto.mockReturnValueOnce(risposta(200, { in_attesa: true, codice: "7KQ2-M9XD-3HWP-T4BZ", nome: "tc620" }));
    render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    await screen.findByTestId("codice-abbinamento");
    const pw = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pw[0], { target: { value: "corta" } });
    fireEvent.change(pw[1], { target: { value: "corta" } });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("dopo l'abbinamento arrivato da fuori", () => {
  const fetchFinto = vi.fn();
  beforeEach(() => { fetchFinto.mockReset(); vi.stubGlobal("fetch", fetchFinto); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("il codice sparisce e compare l'avviso, poi si prosegue", async () => {
    fetchFinto
      .mockReturnValueOnce(risposta(200, { in_attesa: true, codice: "7KQ2-M9XD-3HWP-T4BZ", nome: "tc620" }))
      .mockReturnValue(risposta(200, { in_attesa: false, codice: null, nome: "tc620", cloud: "tc620-casa" }));
    render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    await screen.findByTestId("codice-abbinamento");
    await vi.advanceTimersByTimeAsync(5100);
    expect(await screen.findByTestId("avviso-abbinato")).toBeTruthy();
    expect(screen.queryByTestId("codice-abbinamento")).toBeNull();
    expect(screen.getByTestId("avviso-abbinato").textContent).toContain("tc620-casa");
    await vi.advanceTimersByTimeAsync(30100);
    expect(await screen.findByText("pagina")).toBeTruthy();
  });
});

describe("abbinato al cloud senza utenti (fetta E)", () => {
  const fetchFinto = vi.fn();
  beforeEach(() => { fetchFinto.mockReset(); vi.stubGlobal("fetch", fetchFinto); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("niente codice né modulo, e arrivato il progetto si prosegue", async () => {
    fetchFinto
      .mockReturnValueOnce(risposta(200, { in_attesa: true, codice: null, nome: "tc620", cloud: "tc620-casa", abbinato_cloud_senza_utenti: true }))
      .mockReturnValue(risposta(200, { in_attesa: false, codice: null, nome: "tc620", cloud: "tc620-casa" }));
    render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    const attesa = await screen.findByTestId("attesa-primo-progetto");
    expect(attesa.textContent).toContain("tc620-casa");
    expect(screen.queryByTestId("codice-abbinamento")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(5100);
    expect(await screen.findByTestId("avviso-abbinato")).toBeTruthy();
  });

  it("dal codice si passa all'attesa quando l'abbinamento arriva dal cloud", async () => {
    fetchFinto
      .mockReturnValueOnce(risposta(200, { in_attesa: true, codice: "7KQ2-M9XD-3HWP-T4BZ", nome: "tc620" }))
      .mockReturnValue(risposta(200, { in_attesa: true, codice: null, nome: "tc620", cloud: "tc620-casa", abbinato_cloud_senza_utenti: true }));
    render(<CancelloAbbinamento><div>pagina</div></CancelloAbbinamento>);
    await screen.findByTestId("codice-abbinamento");
    await vi.advanceTimersByTimeAsync(5100);
    expect(await screen.findByTestId("attesa-primo-progetto")).toBeTruthy();
    expect(screen.queryByTestId("codice-abbinamento")).toBeNull();
  });
});

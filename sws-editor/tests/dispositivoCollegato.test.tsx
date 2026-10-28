/** La pastiglia del pannello collegato, in barra accanto a Deploy.
 *
 *  Due cose da provare, e sono le due che il 28-10-2026 sono costate tempo:
 *  **a chi** si è collegati (un'ora persa a cercare un broker dell'ufficio dal
 *  pannello di casa), e **se quel collegamento vale ancora** — il pallino
 *  restava verde con la sessione morta, perché `autenticato` lo guardava solo
 *  la scheda Connessione.
 *
 *  Si guardano gli attributi e non il testo tradotto: nel catalogo di prova
 *  `t()` torna la chiave. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { DispositivoCollegato } from "@/components/DispositivoCollegato";
import { useAppStore } from "@/store";

describe("il dispositivo collegato in barra", () => {
  beforeEach(() => {
    useAppStore.setState({ remoteConnected: false, remoteUrl: null, remoteAutenticato: true });
  });

  it("senza pannello collegato non occupa spazio", () => {
    render(<DispositivoCollegato />);
    expect(screen.queryByTestId("dispositivo-collegato")).toBeNull();
  });

  it("col pannello collegato ne scrive il nome", () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://sws.soligo.net/dev/wp630-ufficio" });
    render(<DispositivoCollegato />);
    expect(screen.getByTestId("dispositivo-collegato").textContent).toContain("wp630-ufficio");
  });

  it("con la sessione scaduta cambia stato invece di restare verde", () => {
    useAppStore.setState({
      remoteConnected: true,
      remoteUrl: "https://sws.soligo.net/dev/wp630-ufficio",
      remoteAutenticato: false,
    });
    render(<DispositivoCollegato />);
    const p = screen.getByTestId("dispositivo-collegato");
    expect(p.getAttribute("data-autenticato")).toBe("0");
    // Il nome resta: dire «scaduta» senza dire con chi non serve a niente.
    expect(p.textContent).toContain("wp630-ufficio");
  });

  it("un collegamento nuovo nasce autenticato, anche dopo uno scaduto", () => {
    useAppStore.setState({ remoteAutenticato: false });
    useAppStore.getState().setRemoteConnected(true, "https://sws.soligo.net/dev/tc620-garage");
    expect(useAppStore.getState().remoteAutenticato).toBe(true);
    render(<DispositivoCollegato />);
    expect(screen.getByTestId("dispositivo-collegato").getAttribute("data-autenticato")).toBe("1");
  });
});

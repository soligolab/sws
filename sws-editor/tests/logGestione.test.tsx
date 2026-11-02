/** Il log della gestione del container, leggibile (02-11-2026). */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, afterEach } from "vitest";
import "../src/i18n";
import i18n from "../src/i18n";
import { ContainerTab, LogGestione } from "../src/config/schede/ContainerTab";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("il log della gestione", () => {
  it("sezioni con un nome, comandi mancanti detti a parole, e l'avviso senza podman", () => {
    render(<LogGestione righe={[
      "==> azione: status — su QUESTA macchina (nessun SSH)",
      "sh: 1: systemctl: not found",
      "== container ==",
      "sh: 1: podman: not found",
    ]} />);
    expect(screen.getByText(i18n.t("cfg.manageSezContainer"))).toBeTruthy();
    expect(screen.getByText(i18n.t("cfg.manageComandoAssente", { comando: "systemctl" }))).toBeTruthy();
    expect(screen.getByTestId("senza-podman")).toBeTruthy();
  });

  it("nel cloud la scheda spiega invece di dare comandi che non possono funzionare", () => {
    window.history.replaceState(null, "", "/p/-/prova/");
    render(<ContainerTab />);
    expect(screen.getByTestId("container-dal-cloud").textContent).toBe(i18n.t("cfg.manageDalCloud"));
    expect(screen.queryByText(i18n.t("cfg.manageStatus"))).toBeNull();
  });
});

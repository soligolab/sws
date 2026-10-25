import { describe, it, expect } from "vitest";
import { sulGateway, sullInsiemeDeiProgetti } from "@/api/client";

describe("quali rotte vanno al gateway invece che al container del progetto", () => {
  it("l'insieme dei progetti lo sa il gateway", () => {
    // Nel cloud il container ha montata solo la cartella del SUO progetto: la
    // sua radice è vuota e non ha registro. Chiedergli di rinominare o
    // duplicare vorrebbe dire chiedere a chi non sa niente dell'insieme.
    for (const p of [
      "/api/projects",
      "/api/projects/acme/impianto/rename",
      "/api/projects/acme/impianto/duplicate",
      "/api/projects/acme/impianto",
    ]) expect(sullInsiemeDeiProgetti(p)).toBe(true);
  });

  it("aprire e chiudere riguardano il progetto attivo, non l'insieme", () => {
    expect(sullInsiemeDeiProgetti("/api/projects/acme/impianto/open")).toBe(false);
    expect(sullInsiemeDeiProgetti("/api/projects/close")).toBe(false);
  });

  it("quello che sta DENTRO un progetto resta al container", () => {
    for (const p of [
      "/api/project",
      "/api/project/export",
      "/api/synoptics/pagina1",
      "/api/auth/whoami",
    ]) expect(sullInsiemeDeiProgetti(p)).toBe(false);
  });

  /** 25-10-2026: dopo un riavvio del gateway la finestra «Sessione scaduta»
   *  mandava la password al container, che nel cloud non ha utenti. */
  it("il login va al gateway, il resto dell'autenticazione no", () => {
    expect(sulGateway("/api/auth/login")).toBe(true);
    expect(sulGateway("/api/projects/acme/impianto/rename")).toBe(true);
    expect(sulGateway("/api/auth/whoami")).toBe(false);
    expect(sulGateway("/api/project")).toBe(false);
  });
});

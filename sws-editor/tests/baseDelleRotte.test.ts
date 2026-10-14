import { describe, it, expect } from "vitest";
import { sullInsiemeDeiProgetti } from "@/api/client";

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
});

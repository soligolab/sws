import { describe, it, expect } from "vitest";
import { targetDaSalvare, versoRischioso } from "../src/editor/targetProgetto";

/** Il motore di rendering di un progetto (T-58). */

describe("targetDaSalvare — «web» è l'assenza del campo", () => {
  it("web non si scrive", () => {
    // `wanted_engine` tratta `None` e `Web` allo stesso modo, ed è così che
    // stanno tutti i progetti creati prima che il campo esistesse: scriverlo
    // aggiungerebbe righe a project.yaml che non dicono niente di nuovo.
    expect(targetDaSalvare("web")).toBeNull();
  });

  it("gli altri sì", () => {
    expect(targetDaSalvare("lvgl_wayland")).toEqual({ kind: "lvgl_wayland" });
    expect(targetDaSalvare("lvgl_framebuffer")).toEqual({ kind: "lvgl_framebuffer" });
  });
});

describe("versoRischioso — quale conversione può far sparire qualcosa", () => {
  it("web → LVGL sì: il pannello disegna meno del browser", () => {
    expect(versoRischioso("web", "lvgl_wayland")).toBe(true);
    expect(versoRischioso("web", "lvgl_framebuffer")).toBe(true);
  });

  it("LVGL → web no: il browser non ha i limiti del pannello", () => {
    expect(versoRischioso("lvgl_wayland", "web")).toBe(false);
    expect(versoRischioso("lvgl_framebuffer", "web")).toBe(false);
  });

  it("fra i due LVGL no: cambia come si parla col display, non cosa si disegna", () => {
    expect(versoRischioso("lvgl_wayland", "lvgl_framebuffer")).toBe(false);
  });

  it("restare dov'è non è un verso", () => {
    expect(versoRischioso("web", "web")).toBe(false);
    expect(versoRischioso("lvgl_wayland", "lvgl_wayland")).toBe(false);
  });
});

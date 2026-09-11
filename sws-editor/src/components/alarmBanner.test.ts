import { describe, it, expect } from "vitest";
import { nellaBarra } from "./AlarmBanner";

/** Il gemello Rust è `nella_barra` in
 *  `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs`, con gli stessi
 *  quattro casi. Fino all'11-09-2026 i due motori rispondevano in modo diverso:
 *  questo file e i suoi test laggiù sono le due metà della stessa decisione. */
describe("alarm_banner — chi finisce nella barra", () => {
  it("mostra quelli da confermare, attivi o rientrati che siano", () => {
    expect(nellaBarra("active_unacked")).toBe(true);
    expect(nellaBarra("normal_unacked")).toBe(true);
  });

  it("tace su quelli confermati", () => {
    // Attivo ma confermato: qualcuno l'ha preso in carico, la barra si libera.
    // Resta contato da alarm_bell e alarm_viewer, che filtrano su `active`.
    expect(nellaBarra("active_acked")).toBe(false);
    expect(nellaBarra("normal")).toBe(false);
  });

  it("distingue normal da normal_unacked", () => {
    // I due booleani di compatibilità (active/acknowledged) valgono false per
    // entrambi: è la ragione per cui la decisione si prende su isa_state.
    expect(nellaBarra("normal_unacked")).not.toBe(nellaBarra("normal"));
  });
});

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n";
import { TestataSorgente } from "../src/config/sorgenti/card/TestataSorgente";

/** A source switched off without deleting it (plan 2026-11-21, branch 2). */
describe("the switch of a source", () => {
  afterEach(() => cleanup());

  const mount = (enabled: boolean, onEnabled: (on: boolean) => void) => render(
    <TestataSorgente tipo="HOST" colore="#fff" id="pc" aperta={false} onToggle={() => {}}
      senzaStato enabled={enabled} onEnabled={onEnabled} />,
  );

  it("switching it off is said in the header, closed card included", () => {
    const onEnabled = vi.fn();
    mount(true, onEnabled);
    expect(screen.queryByTestId("source-off-pc")).toBeNull();
    fireEvent.click(screen.getByTestId("source-enabled-pc"));
    expect(onEnabled).toHaveBeenCalledWith(false);
  });

  it("a switched-off source shows it, and switches back on", () => {
    const onEnabled = vi.fn();
    mount(false, onEnabled);
    expect(screen.getByTestId("source-off-pc").textContent).toMatch(/spenta|off/);
    expect((screen.getByTestId("source-enabled-pc") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("source-enabled-pc"));
    expect(onEnabled).toHaveBeenCalledWith(true);
  });
});

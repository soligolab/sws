/** The fixed header of the Configuration (25-11-2026, UI rule 4): the Save, the tabs with
 *  changes and the green bar. */
import { render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";
import { useAppStore } from "../src/store";
import { BarraEsito, BARRA_VERDE_MS, etichettaSezione, StatoSalvataggio } from "../src/config/testata";

beforeAll(async () => { await i18n.changeLanguage("en"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const t = (k: string) => i18n.t(k);

describe("the header of the Configuration", () => {
  it("names the tab of each pending section", () => {
    expect(etichettaSezione("tags", t)).toBe("Tags");
    expect(etichettaSezione("sources", t)).toBe("Protocols");
    expect(etichettaSezione("symbol_style", t)).toBe("Style");
    expect(etichettaSezione("users", t)).toBe("Users");
    expect(etichettaSezione("ai:tags", t)).toBe("Tags");
    expect(etichettaSezione("qualcosa", t)).toBe("qualcosa");
  });

  it("says which tabs are not saved, and the Save writes them all", async () => {
    const saveAll = vi.fn(async () => {});
    useAppStore.setState({
      saveAll, saveStatus: "idle",
      pendingSections: { tags: async () => {}, alarms: async () => {} },
    });
    render(<StatoSalvataggio />);
    expect(screen.getByTestId("testata-modificate").textContent).toBe("Not saved: Tags, Alarms");
    await act(async () => { screen.getByTestId("testata-salva").click(); });
    expect(saveAll).toHaveBeenCalledTimes(1);
    useAppStore.setState({ pendingSections: {} });
  });

  it("shows the green bar for about 3 s after a save, and keeps a failure until closed", () => {
    vi.useFakeTimers();
    useAppStore.setState({ saveStatus: "saving", saveError: null, ultimiTagCreati: [] });
    render(<BarraEsito />);
    expect(screen.queryByTestId("barra-salvato")).toBeNull();
    act(() => { useAppStore.setState({ saveStatus: "ok" }); });
    expect(screen.getByTestId("barra-salvato")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(BARRA_VERDE_MS + 10); });
    expect(screen.queryByTestId("barra-salvato")).toBeNull();

    act(() => { useAppStore.setState({ saveStatus: "saving" }); });
    act(() => { useAppStore.setState({ saveStatus: "error", saveError: "tags: 500" }); });
    expect(screen.getByTestId("barra-errore").textContent).toContain("tags: 500");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId("barra-errore")).toBeTruthy();
    act(() => { screen.getByRole("button").click(); });
    expect(screen.queryByTestId("barra-errore")).toBeNull();
  });
});

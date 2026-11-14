/** The sober IDE style (14-11-2026, plan docs/plans/2026-11-14-stile-sobrio.md):
 *  three colours per variant, chosen by the person, and colour only where
 *  something matters. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../src/i18n";
import { useAppStore } from "../src/store";
import {
  DEFAULT_SOBER, applyAppearance, getStoredSoberColors, getStoredStyle, soberContrasts, soberTheme,
  type SoberColors,
} from "../src/theme";
import { IdePreferencesTab } from "../src/config/schede/IdePreferencesTab";

function lum(h: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(1 + i, 3 + i), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const cr = (a: string, b: string) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const css = (name: string) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });
afterEach(() => {
  cleanup();
  useAppStore.setState({ ideStyle: "colorful", soberColors: DEFAULT_SOBER });
  try { localStorage.clear(); } catch { /* no storage */ }
  applyAppearance("dark");
});

describe("the sober palette", () => {
  for (const variant of ["dark", "light"] as const) {
    it(`the default ${variant} colours read: text ≥ 7, muted ≥ 4.5 on every surface, accent ≥ 3`, () => {
      const t = soberTheme(DEFAULT_SOBER[variant], variant);
      const n = t.neutrals;
      for (const s of [n.bg, n.surface, n.surface2]) {
        expect(cr(n.text, s)).toBeGreaterThanOrEqual(7);
        expect(cr(n.text2, s)).toBeGreaterThanOrEqual(7);
        expect(cr(n.textMuted, s)).toBeGreaterThanOrEqual(4.5);
      }
      expect(cr(t.primary, n.bg)).toBeGreaterThanOrEqual(3);
      for (const x of [n.bg, n.surface, n.surface2]) expect(cr(t.icons, x)).toBeGreaterThanOrEqual(3);
      // The status texts read on their own tinted backgrounds.
      expect(cr(t.status.dangerSoft, t.status.dangerBg)).toBeGreaterThanOrEqual(4.5);
      expect(cr(t.status.warningSoft, t.status.warningBg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("on any readable pair the muted text never drops below 4.5", () => {
    const backgrounds = ["#000000", "#111315", "#1c1f24", "#2a2420", "#f4f3f0", "#ffffff", "#e8eef5"];
    const inks = ["#ffffff", "#d6d3cd", "#c9ced4", "#2a2d33", "#000000", "#1e2a3a"];
    for (const background of backgrounds) for (const ink of inks) {
      if (cr(background, ink) < 7) continue;
      const c: SoberColors = { background, ink, accent: "#5b9bd5", icons: ink };
      const variant = lum(background) < 0.2 ? "dark" : "light";
      expect(soberContrasts(c, variant).muted, `${background} / ${ink}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("panels and borders are shades of the background, toward the ink", () => {
    const n = soberTheme(DEFAULT_SOBER.dark, "dark").neutrals;
    expect(lum(n.bg)).toBeLessThan(lum(n.surface));
    expect(lum(n.surface)).toBeLessThan(lum(n.surface2));
    expect(lum(n.surface2)).toBeLessThan(lum(n.border));
  });

  it("a broken saved colour falls back to its default, the others stay", () => {
    localStorage.setItem("sws.ide.soberColors", JSON.stringify({ dark: { background: "#123456", ink: "red", accent: 7 } }));
    const c = getStoredSoberColors();
    expect(c.dark).toEqual({ ...DEFAULT_SOBER.dark, background: "#123456" });
    expect(c.light).toEqual(DEFAULT_SOBER.light);
    localStorage.setItem("sws.ide.soberColors", "{not json");
    expect(getStoredSoberColors()).toEqual(DEFAULT_SOBER);
  });
});

describe("applying the style", () => {
  it("sober writes the three colours, the active accent and grey groups; colourful takes them back", () => {
    act(() => { useAppStore.getState().setIdeStyle("sober"); });
    applyAppearance("dark");
    expect(getStoredStyle()).toBe("sober");
    expect(document.documentElement.getAttribute("data-stile")).toBe("sober");
    expect(css("--brand-bg")).toBe(DEFAULT_SOBER.dark.background);
    expect(css("--brand-text")).toBe(DEFAULT_SOBER.dark.ink);
    expect(css("--brand-primary")).toBe(DEFAULT_SOBER.dark.accent);
    expect(css("--sws-att-attiva")).toBe(DEFAULT_SOBER.dark.accent);
    // Every activity item, and every tool icon, is the one icons colour.
    expect(css("--sws-att-tag")).toBe(DEFAULT_SOBER.dark.icons);
    expect(css("--sws-att-allarmi")).toBe(DEFAULT_SOBER.dark.icons);
    expect(css("--sws-icone")).toBe(DEFAULT_SOBER.dark.icons);
    expect(css("--sws-gruppo")).toBe(css("--brand-text-muted"));

    act(() => { useAppStore.getState().setIdeStyle("colorful"); });
    expect(document.documentElement.getAttribute("data-stile")).toBe("colorful");
    expect(css("--sws-att-attiva")).toBe("");
    expect(css("--sws-gruppo")).toBe("");
    expect(css("--sws-icone")).toBe("");
    expect(css("--sws-att-tag")).not.toBe(css("--sws-att-allarmi"));
  });
});

describe("Configuration → IDE", () => {
  it("choosing sober shows the colours of the variant on screen; a new colour applies at once", async () => {
    useAppStore.setState({ themeMode: "dark" });
    render(<IdePreferencesTab />);
    expect(screen.queryByTestId("sober-colors")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("ide-style-sober")); });
    expect(screen.getByTestId("sober-colors")).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId("sober-accent"), { target: { value: "#22b8cf" } }); });
    expect(useAppStore.getState().soberColors.dark.accent).toBe("#22b8cf");
    expect(useAppStore.getState().soberColors.light).toEqual(DEFAULT_SOBER.light);
    expect(css("--brand-primary")).toBe("#22b8cf");
    // One colour for all the icon lines: a hint of blue instead of the grey.
    await act(async () => { fireEvent.change(screen.getByTestId("sober-icons"), { target: { value: "#9fb8d8" } }); });
    expect(css("--sws-icone")).toBe("#9fb8d8");
    expect(css("--sws-att-tag")).toBe("#9fb8d8");
    await act(async () => { fireEvent.click(screen.getByTestId("sober-reset")); });
    expect(useAppStore.getState().soberColors.dark).toEqual(DEFAULT_SOBER.dark);
  });

  it("an ink too close to the background shows the contrast in red", async () => {
    useAppStore.setState({ themeMode: "dark", ideStyle: "sober", soberColors: { ...DEFAULT_SOBER, dark: { background: "#1c1f24", ink: "#3a3d42", accent: "#5b9bd5", icons: "#a7a5a1" } } });
    render(<IdePreferencesTab />);
    const text = screen.getByTestId("contrast-text").querySelector("b") as HTMLElement;
    expect(text.style.color).toContain("danger");
  });
});

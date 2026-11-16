/** The IDE icons that follow the style (plan docs/archive/2026-11-14-stile-sobrio.md,
 *  session 3): the emoji in the colourful style, a line icon in the sober one. */
import { act, render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { followAppearanceOfOtherWindows, useAppStore } from "../src/store";
import { DEFAULT_SOBER, applyAppearance } from "../src/theme";
import { Icona, iconSvg } from "../src/components/Icona";
import { EMOJI_ICON_NAMES, ICONE_IDE } from "../src/editor/iconeIde";
import { ICONE_ATTIVITA } from "../src/editor/iconeAttivita";
import { SCHEDE, SOTTORAMI, RAMI } from "../src/config/schede";

/** The first drawn shape of an SVG, as markup: the DOM writes `<path></path>`
 *  where the registry writes `<path/>`, so compare what is drawn, not the text. */
const firstShape = (markup: string) => {
  const div = document.createElement("div");
  div.innerHTML = `<svg>${markup}</svg>`;
  return div.querySelector("svg > *")!.outerHTML;
};

afterEach(() => {
  cleanup();
  useAppStore.setState({ ideStyle: "colorful", soberColors: DEFAULT_SOBER });
  try { localStorage.clear(); } catch { /* no storage */ }
  applyAppearance("dark");
});

describe("Icona", () => {
  it("colourful: the emoji, as always", () => {
    useAppStore.setState({ ideStyle: "colorful" });
    const { container } = render(<Icona emoji="🏷" />);
    expect(container.textContent).toBe("🏷");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("sober: the line icon from the registry, no emoji", () => {
    useAppStore.setState({ ideStyle: "sober" });
    const { container } = render(<Icona emoji="⚙" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg!.getAttribute("data-icon")).toBe("settings");
    expect(svg!.firstElementChild!.outerHTML).toBe(firstShape(ICONE_IDE.settings));
    expect(container.textContent).toBe("");
  });

  it("sober: an explicit name wins over the emoji, and reaches the activity icons", () => {
    useAppStore.setState({ ideStyle: "sober" });
    const { container } = render(<><Icona emoji="🔀" nome="git" /><Icona emoji="🎛" nome="funzione" /></>);
    const [git, fn] = Array.from(container.querySelectorAll("svg"));
    expect(git.firstElementChild!.outerHTML).toBe(firstShape(ICONE_IDE.git));
    expect(fn.firstElementChild!.outerHTML).toBe(firstShape(ICONE_ATTIVITA.funzione));
  });

  it("sober: an emoji with no icon falls back to the emoji", () => {
    useAppStore.setState({ ideStyle: "sober" });
    const { container } = render(<Icona emoji="🦄" />);
    expect(container.textContent).toBe("🦄");
    expect(container.querySelector("svg")).toBeNull();
    expect(iconSvg("no-such-icon", "🦄")).toBeUndefined();
  });

  it("sober: a name with no icon falls back to the emoji's own icon, then to the emoji", () => {
    useAppStore.setState({ ideStyle: "sober" });
    expect(iconSvg("no-such-icon", "⚙")).toBe(ICONE_IDE.settings);
    const { container } = render(<Icona emoji="⚙" nome="no-such-icon" />);
    expect(container.querySelector("svg")!.getAttribute("data-icon")).toBe("settings");
  });

  it("the variation selector does not hide an icon (☀️ is ☀)", () => {
    expect(iconSvg(undefined, "☀️")).toBe(ICONE_IDE.sun);
  });

  it("sober: the icons colour by default, the text colour when asked (filled buttons)", () => {
    useAppStore.setState({ ideStyle: "sober" });
    const { container } = render(<><Icona emoji="💾" /><Icona emoji="💾" color="currentColor" /></>);
    const [plain, filled] = Array.from(container.querySelectorAll("svg"));
    expect(plain.style.color).toBe("var(--sws-icone, currentColor)");
    expect(filled.style.color).toBe("currentcolor");
    expect(plain.getAttribute("stroke")).toBe("currentColor");
  });

  it("switching the style redraws the icon, both ways", () => {
    const { container } = render(<Icona emoji="🔔" />);
    expect(container.textContent).toBe("🔔");
    act(() => { useAppStore.setState({ ideStyle: "sober" }); });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
    act(() => { useAppStore.setState({ ideStyle: "colorful" }); });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("🔔");
  });
});

describe("the style chosen in another window", () => {
  /** What the browser does when another window of the IDE writes a key: the
   *  value is already in the storage, and this window gets the event. */
  const fromAnotherWindow = (key: string, value: string) => {
    localStorage.setItem(key, value);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key, newValue: value })); });
  };

  it("the icons follow, not only the colours — both ways", () => {
    // A second tab, or the detached chat, used to take the sober colours and
    // keep every emoji until reloaded: the store never heard of the change.
    applyAppearance("dark");
    const stop = followAppearanceOfOtherWindows();
    try {
      const { container } = render(<Icona emoji="🔔" />);
      expect(container.textContent).toBe("🔔");

      fromAnotherWindow("sws.ide.style", "sober");
      expect(document.documentElement.getAttribute("data-stile")).toBe("sober");
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.textContent).toBe("");

      fromAnotherWindow("sws.ide.style", "colorful");
      expect(document.documentElement.getAttribute("data-stile")).toBe("colorful");
      expect(container.querySelector("svg")).toBeNull();
      expect(container.textContent).toBe("🔔");
    } finally { stop(); }
  });

  it("the colours chosen there reach the store, so a change made here does not write the old ones back", () => {
    applyAppearance("dark");
    const stop = followAppearanceOfOtherWindows();
    try {
      const theirs = { ...DEFAULT_SOBER, dark: { ...DEFAULT_SOBER.dark, accent: "#ff8800" } };
      fromAnotherWindow("sws.ide.soberColors", JSON.stringify(theirs));
      expect(useAppStore.getState().soberColors).toEqual(theirs);
      // This window now switches the style: it saves the colours it knows.
      act(() => { useAppStore.getState().setIdeStyle("sober"); });
      expect(JSON.parse(localStorage.getItem("sws.ide.soberColors")!)).toEqual(theirs);
      expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe("#ff8800");
    } finally { stop(); }
  });

  it("after stopping, this window no longer follows", () => {
    followAppearanceOfOtherWindows()();
    fromAnotherWindow("sws.ide.style", "sober");
    expect(useAppStore.getState().ideStyle).toBe("colorful");
  });
});

describe("the registry", () => {
  it("every emoji points to an icon that exists", () => {
    for (const [emoji, name] of Object.entries(EMOJI_ICON_NAMES)) {
      expect(ICONE_IDE[name] ?? ICONE_ATTIVITA[name], `${emoji} → ${name}`).toBeTruthy();
    }
  });

  it("every leaf and branch of the Configuration tree has its icon in the sober style", () => {
    for (const s of SCHEDE) {
      const nome = "iconName" in s ? s.iconName : undefined;
      expect(iconSvg(nome, s.icona), s.id).toBeTruthy();
    }
    for (const r of [...SOTTORAMI, ...RAMI]) expect(iconSvg(undefined, r.icona), r.id).toBeTruthy();
  });

  it("every icon copied from Tabler says which one it is", () => {
    // The licence note (third-party/tabler.md) promises the upstream name on each line.
    const source = readFileSync(resolve(__dirname, "../src/editor/iconeIde.ts"), "utf8");
    const drawn = source.split("\n").filter((l) => /^  "?[a-z-]+"?: '/.test(l));
    expect(drawn.length).toBeGreaterThan(50);
    for (const l of drawn) expect(l, l.slice(0, 40)).toMatch(/', \/\/ tabler: [a-z0-9-]+$/);
  });

  it("icons are lines in currentColor: no hard-wired colours, no emoji, no scripts", () => {
    for (const [name, svg] of Object.entries(ICONE_IDE)) {
      expect(svg, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
      expect(svg, name).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(svg, name).not.toMatch(/<script|href|on[a-z]+=/i);
    }
  });
});

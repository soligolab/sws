/** Filled buttons in the sober style (plan docs/archive/2026-11-14-stile-sobrio.md,
 *  session 2, review of 16-11-2026): the text of a button must be the one made
 *  for the background it actually has. Four buttons paired the text computed
 *  for the full accent with a background that is not the accent (or the
 *  accent with the plain ink), and their labels dropped below 2:1.
 *
 *  Each test renders the real button, resolves its `var(--x, fallback)` colours
 *  against what the theme wrote on `:root`, and measures the contrast. The
 *  colourful style is checked too: there the fallbacks must give the colours
 *  of before, to the digit. */
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mieAziende, waitingPanel, changePassword, creaPrimoAmministratore } = vi.hoisted(() => ({
  mieAziende: vi.fn(),
  waitingPanel: vi.fn(),
  changePassword: vi.fn(),
  creaPrimoAmministratore: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, mieAziende, waitingPanel, changePassword, creaPrimoAmministratore } };
});

import "../src/i18n/index";
import { useAppStore } from "../src/store";
import { DEFAULT_SOBER, applyAppearance } from "../src/theme";
import { PairPanel } from "../src/components/PairPanel";
import { ChangePasswordScreen } from "../src/components/ChangePasswordScreen";
import { PrimoAmministratoreScreen } from "../src/components/PrimoAmministratoreScreen";
import { CellRangeMergeActions } from "../src/editor/EditorShell";

/** A `var(--name, fallback)` chain resolved the way the browser does, against
 *  the inline variables of `:root` (where `applyAppearance` writes them). */
function resolve(value: string): string {
  let v = value.trim();
  while (v.startsWith("var(")) {
    const inner = v.slice(4, -1);
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? "" : inner.slice(comma + 1).trim();
    v = document.documentElement.style.getPropertyValue(name).trim() || fallback;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  return (short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : v).toLowerCase();
}
function lum(h: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(1 + i, 3 + i), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** The text and background a button is painted with, resolved. */
const paint = (el: HTMLElement) => ({ text: resolve(el.style.color), background: resolve(el.style.background) });

function setStyle(style: "sober" | "colorful", variant: "dark" | "light") {
  act(() => {
    useAppStore.setState({ themeMode: variant });
    useAppStore.getState().setIdeStyle(style);
  });
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* no storage */ }
  for (const f of [mieAziende, waitingPanel, changePassword, creaPrimoAmministratore]) f.mockReset();
  mieAziende.mockResolvedValue([{ id: 1, nome: "Casa", implicita: true, ruolo: "sviluppatore", cartella: "-" }]);
  // A request that never answers: the button stays «in progress».
  changePassword.mockReturnValue(new Promise(() => {}));
  creaPrimoAmministratore.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  try { localStorage.clear(); } catch { /* no storage */ }
  useAppStore.setState({ ideStyle: "colorful", soberColors: DEFAULT_SOBER, themeMode: "dark" });
  applyAppearance("dark");
});

/** The four buttons, each brought to the state that was unreadable. */
const BUTTONS: { name: string; show: () => Promise<HTMLElement>; before: { text: string; background: string } }[] = [
  {
    name: "«Unisci celle» of a grid's cell range",
    show: async () => {
      render(<CellRangeMergeActions onMerge={() => {}} onCancel={() => {}} />);
      return screen.getAllByRole("button")[0];
    },
    before: { text: "#e2e8f0", background: "#0f766e" },
  },
  {
    name: "«Abbina» while it is off (nothing typed yet)",
    show: async () => {
      render(<PairPanel onClose={() => {}} />);
      const pair = screen.getByRole("button", { name: /Abbina$|Pair$/ }) as HTMLButtonElement;
      await waitFor(() => expect(mieAziende).toHaveBeenCalled());
      expect(pair.disabled).toBe(true);
      return pair;
    },
    before: { text: "#ffffff", background: "#334155" },
  },
  {
    name: "«Cambia password» while the request runs",
    show: async () => {
      const { container } = render(<ChangePasswordScreen />);
      const [oldPw, newPw, again] = Array.from(container.querySelectorAll("input"));
      fireEvent.change(oldPw, { target: { value: "old-password" } });
      fireEvent.change(newPw, { target: { value: "new-password" } });
      fireEvent.change(again, { target: { value: "new-password" } });
      const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      fireEvent.click(submit);
      await waitFor(() => expect(changePassword).toHaveBeenCalled());
      expect(submit.disabled).toBe(true);
      return submit;
    },
    before: { text: "#ffffff", background: "#1e3a8a" },
  },
  {
    name: "«Crea» the first administrator while the request runs",
    show: async () => {
      const { container } = render(<PrimoAmministratoreScreen onFatto={() => {}} />);
      const [code, email, , pw, again] = Array.from(container.querySelectorAll("input"));
      fireEvent.change(code, { target: { value: "ABCD-1234" } });
      fireEvent.change(email, { target: { value: "a@example.com" } });
      fireEvent.change(pw, { target: { value: "long-enough" } });
      fireEvent.change(again, { target: { value: "long-enough" } });
      const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      fireEvent.click(submit);
      await waitFor(() => expect(creaPrimoAmministratore).toHaveBeenCalled());
      expect(submit.disabled).toBe(true);
      return submit;
    },
    // `--brand-on-primary`, as before: the dark ink the theme computes for the SWS blue.
    before: { text: "#0f172a", background: "#1e3a8a" },
  },
];

describe("filled buttons: the text is the one made for the background", () => {
  for (const b of BUTTONS) {
    for (const variant of ["dark", "light"] as const) {
      it(`sober ${variant}: ${b.name} reads (≥ 4.5)`, async () => {
        setStyle("sober", variant);
        const { text, background } = paint(await b.show());
        expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`colourful: ${b.name} keeps the colours of before`, async () => {
      setStyle("colorful", "dark");
      expect(paint(await b.show())).toEqual(b.before);
    });
  }
});

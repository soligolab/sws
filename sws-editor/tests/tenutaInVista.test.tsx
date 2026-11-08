/** La scheda Prestazioni nascosta dietro l'editor non interroga più il
 *  pannello (08-11-2026): ogni lettura teneva accesa la misura per un minuto. */
import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, prestazioni: vi.fn(() => new Promise(() => {})) } };
});

import { api } from "../src/api/client";
import { Tenuta, useInVista } from "../src/components/Tenuta";
import { ColonnaPrestazioni } from "../src/config/schede/PrestazioniTab";

beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.prestazioni).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

function Spia({ su }: { su: (v: boolean) => void }) { su(useInVista()); return null; }

describe("Tenuta e useInVista", () => {
  it("annidate: nascosta quella di fuori, nascosto anche dentro", () => {
    let visto = true;
    const { rerender } = render(<Tenuta attiva><Tenuta attiva><Spia su={(v) => { visto = v; }} /></Tenuta></Tenuta>);
    expect(visto).toBe(true);
    rerender(<Tenuta attiva={false}><Tenuta attiva><Spia su={(v) => { visto = v; }} /></Tenuta></Tenuta>);
    expect(visto).toBe(false);
  });

  it("le Prestazioni nascoste smettono di leggere, e riprendono tornando in vista", () => {
    const { rerender } = render(<Tenuta attiva><ColonnaPrestazioni remoto titolo="x" /></Tenuta>);
    act(() => { vi.advanceTimersByTime(4100); });
    const inVista = vi.mocked(api.prestazioni).mock.calls.length;
    expect(inVista).toBeGreaterThanOrEqual(3);
    rerender(<Tenuta attiva={false}><ColonnaPrestazioni remoto titolo="x" /></Tenuta>);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(vi.mocked(api.prestazioni).mock.calls.length).toBe(inVista);
    rerender(<Tenuta attiva><ColonnaPrestazioni remoto titolo="x" /></Tenuta>);
    expect(vi.mocked(api.prestazioni).mock.calls.length).toBe(inVista + 1);
  });
});

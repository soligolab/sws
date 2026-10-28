/** La versione del runtime: una fetch sola, e **dopo** il login.
 *
 *  Richiesta del maintainer del 28-10-2026, con la sua scelta su dove
 *  mostrarla. La parte che vale la pena provare non è il disegno: è che la
 *  versione non si chieda a ripetizione — il 28-10 abbiamo appena tolto dai
 *  trend esattamente quel genere di traffico — e che un runtime muto non
 *  faccia scrivere una versione falsa. */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getSystemStatus } = vi.hoisted(() => ({ getSystemStatus: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getSystemStatus } };
});

import { VersioneRuntime } from "@/components/VersioneRuntime";
import { dimenticaVersione } from "@/versioneRuntime";

describe("la versione del runtime", () => {
  beforeEach(() => {
    dimenticaVersione();
    getSystemStatus.mockReset();
  });

  it("si scrive quando il runtime la dice", async () => {
    getSystemStatus.mockResolvedValue({ runtime_version: "2.23.5" });
    render(<VersioneRuntime />);
    await waitFor(() => expect(screen.getByTestId("versione-runtime")).toBeTruthy());
    expect(screen.getByTestId("versione-runtime").textContent).toBe("2.23.5");
  });

  it("si chiede UNA volta sola, anche con due componenti montati", async () => {
    getSystemStatus.mockResolvedValue({ runtime_version: "2.23.5" });
    render(<><VersioneRuntime /><VersioneRuntime /></>);
    await waitFor(() => expect(screen.getAllByTestId("versione-runtime")).toHaveLength(2));
    expect(getSystemStatus).toHaveBeenCalledTimes(1);
  });

  it("un runtime che non risponde non fa scrivere una versione falsa", async () => {
    getSystemStatus.mockRejectedValue(new Error("giù"));
    render(<VersioneRuntime />);
    await waitFor(() => expect(getSystemStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("versione-runtime")).toBeNull();
  });

  it("e una versione vuota non diventa uno spazio bianco", async () => {
    getSystemStatus.mockResolvedValue({ runtime_version: "" });
    render(<VersioneRuntime />);
    await waitFor(() => expect(getSystemStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("versione-runtime")).toBeNull();
  });
});

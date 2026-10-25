/** I campi privati del marchio (25-10-2026, ramo 2 dei residui): dal
 *  `brand.json` pubblico non escono più, e arrivano dopo l'accesso — anche
 *  nell'IDE locale, dove il token è il sentinella `"no-auth"` e i preset
 *  Pixsys di `start_editor.sh` non devono sparire senza un errore. */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { marchioMio, marchioPrivato } = vi.hoisted(() => ({
  marchioMio: vi.fn(),
  marchioPrivato: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, marchioMio, marchioPrivato } };
});

import { useMarchioDellAzienda } from "../src/branding/perAzienda";
import { applicaCampiPrivati, getBrand } from "../src/branding";
import { sulGateway } from "../src/api/client";

function Prova({ token }: { token: string | null }) {
  useMarchioDellAzienda(token);
  return null;
}

const PRESET = [{ id: "wp630", label: "WP630", width: 1280, height: 800 }];

describe("i campi privati del marchio", () => {
  beforeEach(() => {
    marchioMio.mockReset().mockResolvedValue({ marchio: null });
    marchioPrivato.mockReset().mockResolvedValue({ marchio: getBrand().id, campi: { device_presets: PRESET } });
  });

  it("nell'IDE locale (no-auth) arrivano lo stesso, dal marchio dell'installazione", async () => {
    render(<Prova token="no-auth" />);
    await waitFor(() => expect(getBrand().devicePresets).toEqual(PRESET));
    expect(marchioMio).not.toHaveBeenCalled();
    expect(marchioPrivato).toHaveBeenCalledTimes(1);
  });

  it("si innestano solo sul marchio caricato adesso", () => {
    const prima = getBrand().devicePresets;
    applicaCampiPrivati("un-altro-marchio", { device_presets: [] });
    expect(getBrand().devicePresets).toBe(prima);
  });

  it("nel cloud le chiede al gateway, che ha le identità", () => {
    expect(sulGateway("/api/identita/marchio")).toBe(true);
    expect(sulGateway("/api/identita/marchio/privato")).toBe(true);
    expect(sulGateway("/api/identita/utenti")).toBe(false);
  });
});

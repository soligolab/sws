import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, updatePannello: vi.fn().mockResolvedValue(undefined) } };
});

import { api } from "../src/api/client";
import { salvaPannello } from "../src/editor/salvaPannello";
import { useAppStore } from "../src/store";

/** `pannello` si salva tutto insieme (13-11-2026): cambiare un campo non deve
 *  cancellare gli altri. Fino a quel giorno il campo dei fotogrammi mandava
 *  `{ fps }` e basta. */
describe("salvaPannello", () => {
  const put = vi.mocked(api.updatePannello);
  beforeEach(() => {
    put.mockClear();
    useAppStore.setState({ project: { meta: { name: "p", version: "1" }, tags: [] } as never });
  });

  it("cambiando i fotogrammi tiene luce e beep", async () => {
    useAppStore.setState((s) => ({ project: { ...s.project!, pannello: {
      luminosita: 60, beep: { frequenza_hz: 1000, durata_ms: 30, volume: 100 } } } }));
    await salvaPannello({ fps: 15 });
    expect(put).toHaveBeenCalledWith({ luminosita: 60, beep: { frequenza_hz: 1000, durata_ms: 30, volume: 100 }, fps: 15 });
    expect(useAppStore.getState().project?.pannello?.luminosita).toBe(60);
  });

  it("un campo svuotato si toglie, e senza campi la sezione è null", async () => {
    useAppStore.setState((s) => ({ project: { ...s.project!, pannello: { fps: 15, spegni_dopo_min: 10 } } }));
    await salvaPannello({ fps: undefined });
    expect(put).toHaveBeenLastCalledWith({ spegni_dopo_min: 10 });
    await salvaPannello({ spegni_dopo_min: undefined });
    expect(put).toHaveBeenLastCalledWith(null);
    expect(useAppStore.getState().project?.pannello).toBeUndefined();
  });
});

/** La chiusura della finestra aperta da sola su un progetto appena creato
 *  (piano dell'impostazione iniziale, sessione I1, 08-11-2026): il formato
 *  scelto va sulle pagine nate col progetto, si salva, e il segnale si spegne. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../src/store";
import { api } from "../src/api/client";
import { chiudiImpostazioneIniziale } from "../src/editor/EditorShell";

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    project: {
      meta: { name: "Casa", version: "1" }, impostazione_iniziale: true,
      page_layout: { size_mode: "fixed", default_width: 1024, default_height: 600, default_background: "#112233" },
    } as never,
    pages: [
      { id: "p1", name: "Pagina 1", objects: [], background: "#0f172a" },
      { id: "b1", name: "Immagine di boot", kind: "boot", width: 1280, height: 800, background: "#0f172a", objects: [] },
    ] as never,
  });
});

describe("chiudere l'impostazione iniziale", () => {
  it("misura e sfondo vanno su «Pagina 1» e sul boot, si salva, e il segnale si spegne", async () => {
    const salva = vi.fn(async () => {});
    useAppStore.setState({ saveAll: salva } as never);
    const fine = vi.spyOn(api, "fineImpostazioneIniziale").mockResolvedValue(undefined);
    await chiudiImpostazioneIniziale();
    const [uno, boot] = useAppStore.getState().pages;
    expect([uno.width, uno.height, uno.background]).toEqual([1024, 600, "#112233"]);
    expect([boot.width, boot.height]).toEqual([1024, 600]);
    expect(salva).toHaveBeenCalledOnce();
    expect(fine).toHaveBeenCalledOnce();
    expect(useAppStore.getState().project?.impostazione_iniziale).toBeFalsy();
  });

  it("se il server non risponde il segnale resta: la finestra tornerà", async () => {
    useAppStore.setState({ saveAll: vi.fn(async () => {}) } as never);
    vi.spyOn(api, "fineImpostazioneIniziale").mockRejectedValue(new Error("giù"));
    await chiudiImpostazioneIniziale();
    expect(useAppStore.getState().project?.impostazione_iniziale).toBe(true);
  });
});

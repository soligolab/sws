// The update channel chosen from the IDE (25-11-2026, plan
// docs/plans/2026-11-25-cambio-di-canale-dal-cloud.md). The maintainer:
// «switch per saltare da devel a stable con opportuni warning». The panel
// decides: a higher version on the chosen channel → it switches now; otherwise
// the choice waits and the panel never goes down a version.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, type StatoAggiornamento } from "../src/api/client";
import { AggiornamentoRuntime } from "../src/boot/AggiornamentoRuntime";

const dialogs = vi.hoisted(() => ({ asked: [] as string[], answer: true }));
vi.mock("@/finestraAvviso/finestraAvviso", () => ({
  conferma: vi.fn(async ({ testo }: { testo: string }) => { dialogs.asked.push(testo); return dialogs.answer; }),
  chiedi: vi.fn(),
  avviso: vi.fn(),
}));

const onDev: StatoAggiornamento = {
  versione: "2.27.0-dev.4", immagine: "ghcr.io/soligolab/sws-runtime:dev-arm64", canale: "sviluppo",
  disponibile: null, errore: null, cambio_canale: true,
};

afterEach(() => { vi.restoreAllMocks(); dialogs.asked = []; dialogs.answer = true; });

describe("the update channel from the IDE", () => {
  it("dev → stable with nothing higher: the choice waits, and the text says the panel stays", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onDev);
    const change = vi.spyOn(api, "remoteCambiaCanale").mockResolvedValue({ ...onDev, canale_scelto: "stabile" });
    render(<AggiornamentoRuntime />);
    const select = await screen.findByTestId("update-channel-select") as HTMLSelectElement;
    expect(select.value).toBe("dev");
    fireEvent.change(select, { target: { value: "stable" } });
    fireEvent.click(screen.getByTestId("update-channel-apply"));
    await waitFor(() => expect(change).toHaveBeenCalledWith("stable"));
    // The warning before: never down a version.
    expect(dialogs.asked[0]).toContain(i18n.t("aggiornamento.canaleNome.stable"));
    expect(dialogs.asked[0]).toContain("2.27.0-dev.4");
    expect((await screen.findByTestId("update-channel-waiting")).textContent).toBe(
      i18n.t("aggiornamento.canaleInAttesa", { canale: i18n.t("aggiornamento.canaleNome.stable"), versione: "2.27.0-dev.4" }));
  });

  it("test → dev with a newer dev: the switch starts and the panel restarts", async () => {
    // The panel answers with `in_corso`: the snapshot is taken, the installer starts.
    const onTest: StatoAggiornamento = {
      versione: "2.27.0", immagine: "ghcr.io/soligolab/sws-runtime:rc-arm64", canale: "prova",
      disponibile: null, errore: null, cambio_canale: true,
    };
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onTest);
    vi.spyOn(api, "remoteCambiaCanale").mockResolvedValue({ ...onTest, canale_scelto: "sviluppo", disponibile: "2.28.0-dev.1", in_corso: true });
    render(<AggiornamentoRuntime />);
    fireEvent.change(await screen.findByTestId("update-channel-select"), { target: { value: "dev" } });
    // The development warning shows before the choice is sent…
    expect(screen.getByText(new RegExp(i18n.t("aggiornamento.canaleAvvisoSviluppo").slice(0, 30)))).toBeTruthy();
    fireEvent.click(screen.getByTestId("update-channel-apply"));
    // …and it is in the confirmation too.
    await screen.findByText(i18n.t("aggiornamento.canaleAvviato", { a: "2.28.0-dev.1" }));
    expect(dialogs.asked[0]).toContain(i18n.t("aggiornamento.canaleAvvisoSviluppo"));
    expect(screen.queryByTestId("update-channel")).toBeNull();
  });

  it("a «no» sends nothing", async () => {
    dialogs.answer = false;
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onDev);
    const change = vi.spyOn(api, "remoteCambiaCanale");
    render(<AggiornamentoRuntime />);
    fireEvent.change(await screen.findByTestId("update-channel-select"), { target: { value: "test" } });
    fireEvent.click(screen.getByTestId("update-channel-apply"));
    await waitFor(() => expect(dialogs.asked).toHaveLength(1));
    expect(change).not.toHaveBeenCalled();
  });

  it("a fixed panel can go back to its pinned image: the «none» choice", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({
      versione: "2.27.0-dev.3", immagine: "ghcr.io/soligolab/sws-runtime:2.27.0-dev.3-arm64", canale: "fissata",
      disponibile: null, errore: null, canale_scelto: "prova", cambio_canale: true,
    } as StatoAggiornamento);
    const change = vi.spyOn(api, "remoteCambiaCanale").mockResolvedValue({
      versione: "2.27.0-dev.3", immagine: "ghcr.io/soligolab/sws-runtime:2.27.0-dev.3-arm64", canale: "fissata",
      disponibile: null, errore: null, cambio_canale: true,
    } as StatoAggiornamento);
    render(<AggiornamentoRuntime />);
    // What runs is still said: «fixed version», not «test channel: up to date».
    expect(await screen.findByText(i18n.t("aggiornamento.canaleRiga", {
      versione: "2.27.0-dev.3", canale: i18n.t("aggiornamento.canale.fissata") }))).toBeTruthy();
    const select = screen.getByTestId("update-channel-select") as HTMLSelectElement;
    expect(select.value).toBe("test");
    fireEvent.change(select, { target: { value: "none" } });
    fireEvent.click(screen.getByTestId("update-channel-apply"));
    await waitFor(() => expect(change).toHaveBeenCalledWith("none"));
    expect(dialogs.asked[0]).toContain(i18n.t("aggiornamento.canaleNomeNessuno.fissata"));
    await waitFor(() => expect(screen.queryByTestId("update-channel-waiting")).toBeNull());
  });

  it("while a switch takes its snapshot, «Update now» is held and the wait is said", async () => {
    const onTest: StatoAggiornamento = {
      versione: "2.27.0", immagine: "ghcr.io/soligolab/sws-runtime:rc-arm64", canale: "prova",
      disponibile: "2.27.1-rc.1", errore: null, cambio_canale: true,
    };
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onTest);
    let finish: (s: StatoAggiornamento) => void = () => {};
    vi.spyOn(api, "remoteCambiaCanale").mockReturnValue(new Promise((r) => { finish = r; }));
    render(<AggiornamentoRuntime />);
    expect(await screen.findByText(i18n.t("aggiornamento.pulsante", { a: "2.27.1-rc.1" }))).toBeTruthy();
    fireEvent.change(screen.getByTestId("update-channel-select"), { target: { value: "dev" } });
    fireEvent.click(screen.getByTestId("update-channel-apply"));
    expect(await screen.findByText(i18n.t("aggiornamento.istantaneaInCorso"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("aggiornamento.pulsante", { a: "2.27.1-rc.1" }))).toBeNull();
    finish({ ...onTest, canale_scelto: "sviluppo", disponibile: "2.28.0-dev.1", in_corso: true });
    await screen.findByText(i18n.t("aggiornamento.canaleAvviato", { a: "2.28.0-dev.1" }));
  });

  it("a fixed panel can choose a channel: no «update from Install» once chosen", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({
      versione: "2.27.0-dev.3", immagine: "ghcr.io/soligolab/sws-runtime:2.27.0-dev.3-arm64", canale: "fissata",
      disponibile: "2.27.0-dev.4", errore: null, canale_scelto: "sviluppo", cambio_canale: true,
    } as StatoAggiornamento);
    render(<AggiornamentoRuntime />);
    expect(await screen.findByTestId("update-channel-waiting")).toBeTruthy();
    expect(screen.queryByTestId("apri-installazione")).toBeNull();
    // «Update now» is there: it makes the switch.
    expect(screen.getByText(i18n.t("aggiornamento.pulsante", { a: "2.27.0-dev.4" }))).toBeTruthy();
  });

  it("a panel older than 2.27.0 (no `cambio_canale`) gets no choice: its answer would be a 404", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({ ...onDev, cambio_canale: undefined });
    render(<AggiornamentoRuntime />);
    await screen.findByText(new RegExp("2.27.0-dev.4"));
    expect(screen.queryByTestId("update-channel")).toBeNull();
  });
});

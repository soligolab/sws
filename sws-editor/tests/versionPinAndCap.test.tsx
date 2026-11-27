// Fix a version and the version cap (26-11-2026, plan
// docs/plans/2026-11-26-versione-fissata-e-blocco.md). The IDE fixes a panel
// to a version («Fix a version…» in the channel menu, only for panels that
// answer `/api/update/versions`); the console sets a cap that never updates
// the panel.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, type StatoAggiornamento } from "../src/api/client";

const dialogs = vi.hoisted(() => ({
  asked: [] as string[],
  answer: true,
  choices: [] as { valore: unknown; etichetta: string }[][],
  pick: null as unknown,
}));
vi.mock("@/finestraAvviso/finestraAvviso", () => ({
  conferma: vi.fn(async (o: { testo: string } | string) => {
    dialogs.asked.push(typeof o === "string" ? o : o.testo);
    return dialogs.answer;
  }),
  scegli: vi.fn(async ({ testo, scelte }: { testo: string; scelte: { valore: unknown; etichetta: string }[] }) => {
    dialogs.asked.push(testo);
    dialogs.choices.push(scelte);
    return dialogs.pick;
  }),
  chiedi: vi.fn(),
  avviso: vi.fn(),
}));
// The drop-down of the versions (27-11-2026): its entries, newest first, as
// the old list of buttons, so the assertions below stay the same.
vi.mock("@/components/sceltaVersione", () => ({
  scegliVersione: vi.fn(async (o: { testo: string; versioni: string[]; nessuna?: string }) => {
    dialogs.asked.push(o.testo);
    dialogs.choices.push([
      ...(o.nessuna !== undefined ? [{ valore: "", etichetta: o.nessuna }] : []),
      ...[...o.versioni].reverse().map((v) => ({ valore: v, etichetta: v })),
    ]);
    return dialogs.pick;
  }),
}));

import { AggiornamentoRuntime } from "../src/boot/AggiornamentoRuntime";
import { Pannelli } from "../src/console/Pannelli";

const onStable: StatoAggiornamento = {
  versione: "2.27.0", immagine: "ghcr.io/soligolab/sws-runtime:latest-arm64", canale: "stabile",
  disponibile: null, errore: null, cambio_canale: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  dialogs.asked = []; dialogs.answer = true; dialogs.choices = []; dialogs.pick = null;
});

describe("IDE: fix a version", () => {
  it("an older panel does not answer the versions: no entry in the menu", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onStable);
    vi.spyOn(api, "remoteUpdateVersions").mockRejectedValue(new Error("404"));
    render(<AggiornamentoRuntime />);
    await screen.findByTestId("update-channel-select");
    await waitFor(() => expect(api.remoteUpdateVersions).toHaveBeenCalled());
    expect(screen.queryByTestId("update-pin-entry")).toBeNull();
  });

  it("the entry lists the versions, asks to confirm with the snapshot, and fixes the panel", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onStable);
    vi.spyOn(api, "remoteUpdateVersions").mockResolvedValue({
      running: "2.27.0", arch: "arm64", versions: ["2.27.0", "2.28.0", "2.31.0"], cap: null,
    });
    const fix = vi.spyOn(api, "remoteFixVersion").mockResolvedValue({
      ...onStable, disponibile: "2.31.0", in_corso: true,
    });
    dialogs.pick = "2.31.0";
    render(<AggiornamentoRuntime />);
    const entry = await screen.findByTestId("update-pin-entry");
    expect(entry.textContent).toBe(i18n.t("aggiornamento.fissaVoce"));
    fireEvent.change(screen.getByTestId("update-channel-select"), { target: { value: "pin" } });
    await waitFor(() => expect(fix).toHaveBeenCalledWith("2.31.0"));
    // The newest first.
    expect(dialogs.choices[0].map((c) => c.valore)).toEqual(["2.31.0", "2.28.0", "2.27.0"]);
    expect(dialogs.asked[1]).toBe(i18n.t("aggiornamento.fissaConferma", { a: "2.31.0" }));
    expect(await screen.findByText(i18n.t("aggiornamento.fissaAvviata", { a: "2.31.0" }))).toBeTruthy();
  });

  it("a «no» to the confirmation sends nothing", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue(onStable);
    vi.spyOn(api, "remoteUpdateVersions").mockResolvedValue({
      running: "2.27.0", arch: "arm64", versions: ["2.28.0"], cap: null,
    });
    const fix = vi.spyOn(api, "remoteFixVersion");
    dialogs.pick = "2.28.0";
    dialogs.answer = false;
    render(<AggiornamentoRuntime />);
    await screen.findByTestId("update-pin-entry");
    fireEvent.change(screen.getByTestId("update-channel-select"), { target: { value: "pin" } });
    await waitFor(() => expect(dialogs.asked).toHaveLength(2));
    expect(fix).not.toHaveBeenCalled();
  });

  it("the status line says the cap, and why a higher version is not offered", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({ ...onStable, cap: "2.28.0", above_cap: "2.31.0" });
    vi.spyOn(api, "remoteUpdateVersions").mockRejectedValue(new Error("404"));
    render(<AggiornamentoRuntime />);
    const line = await screen.findByTestId("update-cap");
    expect(line.textContent).toContain(i18n.t("aggiornamento.bloccoRiga", { max: "2.28.0" }));
    expect(line.textContent).toContain(i18n.t("aggiornamento.bloccoOltre", { versione: "2.31.0" }));
  });
});

describe("Console: version cap", () => {
  const row = { azienda: "-", stato: "attivo", abbinato_ms: 1, ultimo_ms: 1, collegato: true };
  const panels = () => ({
    abbinati: [
      { ...row, nome: "wp630", hw: "h1", blocco_versione: "2.28.0" },
      { ...row, nome: "plx800", hw: "h2" },
    ],
    dichiarati: [],
    in_attesa: 0,
  });

  it("the column shows the cap, and the action sets one from the published versions", async () => {
    vi.spyOn(api, "pannelliAmministrazione").mockResolvedValue(panels());
    vi.spyOn(api, "amministrazioneRisorse").mockResolvedValue({ aziende: [] } as never);
    vi.spyOn(api, "publishedVersions").mockResolvedValue({ versions: ["2.27.0", "2.28.0", "2.31.0"] });
    const set = vi.spyOn(api, "versionCapPanel").mockResolvedValue({ sent: true });
    dialogs.pick = "2.31.0";
    render(<Pannelli />);
    expect((await screen.findByTestId("blocco-wp630")).textContent).toBe("2.28.0");
    expect(screen.getByTestId("blocco-plx800").textContent).toBe(i18n.t("console.pannelli.bloccoNessuno"));
    expect(screen.getByText(i18n.t("console.pannelli.blocco"))).toBeTruthy();
    fireEvent.click(screen.getByTestId("blocco-azione-plx800"));
    await waitFor(() => expect(set).toHaveBeenCalledWith("plx800", "2.31.0"));
    // The explanation: the cap does not update the panel.
    expect(dialogs.asked[0]).toBe(i18n.t("console.pannelli.bloccoTesto"));
    // «No cap» first, then the newest version first.
    expect(dialogs.choices[0].map((c) => c.valore)).toEqual(["", "2.31.0", "2.28.0", "2.27.0"]);
  });

  it("«No cap» removes it", async () => {
    vi.spyOn(api, "pannelliAmministrazione").mockResolvedValue(panels());
    vi.spyOn(api, "amministrazioneRisorse").mockResolvedValue({ aziende: [] } as never);
    vi.spyOn(api, "publishedVersions").mockResolvedValue({ versions: ["2.28.0"] });
    const set = vi.spyOn(api, "versionCapPanel").mockResolvedValue({ sent: false, detail: "offline" });
    dialogs.pick = "";
    render(<Pannelli />);
    fireEvent.click(await screen.findByTestId("blocco-azione-wp630"));
    await waitFor(() => expect(set).toHaveBeenCalledWith("wp630", null));
  });
});

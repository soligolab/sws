// Quali WebSocket vanno al dispositivo, e quale resta locale (Q31).
//
// # Perché questo test esiste
//
// Con un runtime remoto collegato, `buildWsUrl` dirottava **ogni** canale sul
// relay locale, che ammette solo `tags`, `alarms` e `logs`: `/ws/remote/ai`
// rispondeva 404 e il pannello della chat riprovava all'infinito. Nessuno se
// n'era accorto perché la chat si prova con un progetto locale, senza «Connetti».
//
// La cura non è aggiungere `ai` alla whitelist del relay, ed è la parte che
// questo test difende: con un remoto collegato il progetto che si modifica resta
// **quello locale** (il deploy esporta il locale e lo carica sul device), quindi
// l'assistente deve leggere il locale. Dirottarlo sul dispositivo gli farebbe
// proporre modifiche a una copia che nessuno sta editando: un difetto peggiore
// del 404, perché sembrerebbe funzionare.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  getAuthToken: () => "TOK",
  getRuntimeBaseUrl: () => null,
}));

import { buildWsUrl } from "@/ws/wsUrl";
import { useAppStore } from "@/store";

describe("buildWsUrl con un runtime remoto collegato", () => {
  beforeEach(() => {
    useAppStore.setState({ remoteConnected: true });
  });

  it("manda al dispositivo i tre canali del suo stato", () => {
    for (const sub of ["tags", "alarms", "logs"]) {
      expect(buildWsUrl(`/ws/${sub}`)).toContain(`/ws/remote/${sub}`);
    }
  });

  it("ma la chat resta locale: è il progetto locale che si sta modificando", () => {
    const url = buildWsUrl("/ws/ai");
    // Il verso rotto è precisamente questo: prima l'URL diventava
    // `/ws/remote/ai`, il relay rispondeva 404 e la chat non agganciava mai.
    expect(url).not.toContain("/ws/remote/");
    expect(url).toContain("/ws/ai");
    expect(url).toContain("token=TOK");
  });

  it("e un canale sconosciuto non viene dirottato per errore", () => {
    // Difesa contro il futuro: un canale nuovo non deve finire nel relay solo
    // perché esiste. Al relay ci va chi è dichiarato, non chi capita.
    expect(buildWsUrl("/ws/qualcosa-di-nuovo")).not.toContain("/ws/remote/");
  });

  it("senza runtime remoto, niente va nel relay", () => {
    useAppStore.setState({ remoteConnected: false });
    for (const sub of ["tags", "alarms", "logs", "ai"]) {
      expect(buildWsUrl(`/ws/${sub}`)).not.toContain("/ws/remote/");
    }
  });
});

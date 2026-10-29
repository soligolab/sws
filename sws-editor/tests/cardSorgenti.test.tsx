/** Le card delle sorgenti ridisegnate (29-10-2026, piano
 *  `docs/plans/2026-10-29-card-delle-sorgenti.md`): lo stato in testata con
 *  l'ora, le sezioni che si aprono, Sparkplug B come modo della mappatura, e
 *  la disponibilità **dentro** la card invece che in una riga sotto. */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { statoSorgenti } = vi.hoisted(() => ({
  statoSorgenti: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoSorgenti } };
});

import { oraDello, PastigliaStato } from "../src/config/sorgenti/card/PastigliaStato";
import { SezioneSorgente } from "../src/config/sorgenti/card/SezioneSorgente";
import { MqttSourceCard } from "../src/config/sorgenti/MqttSourceCard";
import { ProtocolsTab } from "../src/config/schede/ProtocolsTab";
import { useAppStore } from "../src/store";
import type { MqttSource } from "../src/types";

beforeAll(async () => { await i18n.changeLanguage("it"); });

const mqtt = { kind: "mqtt", id: "mqtt-garage", host: "broker.casa", port: 1883, client_id: "sws", topics: [] } as unknown as MqttSource;

describe("l'ora dello stato", () => {
  it("oggi solo l'ora, un altro giorno anche la data", () => {
    const adesso = new Date(2026, 9, 29, 18, 0).getTime();
    expect(oraDello(new Date(2026, 9, 29, 14, 9).getTime(), adesso)).toBe("14:09");
    expect(oraDello(new Date(2026, 9, 27, 14, 9).getTime(), adesso)).toBe("27/10 14:09");
  });
});

describe("la pastiglia dello stato", () => {
  it("risponde", () => {
    render(<PastigliaStato id="x" stato={{ stato: "ok", da_ms: 0 }} />);
    expect(screen.getByTestId("stato-x").textContent).toBe("risponde");
  });

  it("non risponde, con l'ora e il motivo nel suggerimento", () => {
    const da = Date.now();
    render(<PastigliaStato id="x" stato={{ stato: "non_risponde", errore: "«zigbee2mqtt/bridge/state» dice offline", da_ms: da }} />);
    const p = screen.getByTestId("stato-x");
    expect(p.getAttribute("data-stato")).toBe("errore");
    expect(p.textContent).toBe(`non risponde dalle ${oraDello(da, Date.now(), "it")}`);
    expect(p.getAttribute("title")).toContain("dice offline");
  });

  it("senza stato dal runtime, non attiva", () => {
    render(<PastigliaStato id="x" />);
    expect(screen.getByTestId("stato-x").textContent).toBe("non attiva");
  });
});

describe("la sezione", () => {
  it("chiusa di partenza mostra il riepilogo, e si apre col titolo", () => {
    render(
      <SezioneSorgente titolo="Avanzate" apribile chiusaDiPartenza riepilogo="connessione · TLS" testid="s">
        <span>dentro</span>
      </SezioneSorgente>,
    );
    expect(screen.queryByText("dentro")).toBeNull();
    expect(screen.getByText("connessione · TLS")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("dentro")).toBeTruthy();
    expect(screen.queryByText("connessione · TLS")).toBeNull();
  });
});

describe("la card MQTT", () => {
  it("Sparkplug B è un modo della mappatura: lo crea e lo toglie", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MqttSourceCard source={mqtt} onChange={onChange} onDelete={() => {}} onCreateTag={() => {}} />);
    fireEvent.click(screen.getByTestId("modo-sparkplug"));
    const conSparkplug = onChange.mock.calls[0][0] as MqttSource;
    expect(conSparkplug.sparkplug).toEqual({ group_id: "", host_id: "SWS-SCADA", metrics: [] });

    // Senza metriche si torna ai topic senza chiedere.
    rerender(<MqttSourceCard source={conSparkplug} onChange={onChange} onDelete={() => {}} onCreateTag={() => {}} />);
    fireEvent.click(screen.getByTestId("modo-topic"));
    expect((onChange.mock.calls[1][0] as MqttSource).sparkplug).toBeUndefined();
  });

  it("con delle metriche, tornare ai topic chiede, e un no non tocca niente", () => {
    const onChange = vi.fn();
    const conMetriche = { ...mqtt, sparkplug: { group_id: "g", host_id: "h", metrics: [{ name: "m", tag: "t" }] } } as unknown as MqttSource;
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MqttSourceCard source={conMetriche} onChange={onChange} onDelete={() => {}} onCreateTag={() => {}} />);
    fireEvent.click(screen.getByTestId("modo-topic"));
    expect(conferma).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    conferma.mockRestore();
  });

  it("con Sparkplug B la disponibilità non c'è", () => {
    const conSparkplug = { ...mqtt, sparkplug: { group_id: "", host_id: "SWS-SCADA", metrics: [] } } as unknown as MqttSource;
    render(<MqttSourceCard source={conSparkplug} onChange={() => {}} onDelete={() => {}} onCreateTag={() => {}} />);
    expect(screen.queryByTestId("disponibilita-mqtt-garage")).toBeNull();
  });

  it("una riga dice cosa vuol dire il modo scelto", () => {
    const { rerender } = render(<MqttSourceCard source={mqtt} onChange={() => {}} onDelete={() => {}} onCreateTag={() => {}} />);
    expect(screen.getByTestId("modo-descrizione").textContent).toContain("Ogni topic MQTT");
    const conSparkplug = { ...mqtt, sparkplug: { group_id: "", host_id: "SWS-SCADA", metrics: [] } } as unknown as MqttSource;
    rerender(<MqttSourceCard source={conSparkplug} onChange={() => {}} onDelete={() => {}} onCreateTag={() => {}} />);
    expect(screen.getByTestId("modo-descrizione").textContent).toContain("Uno standard industriale");
  });

  it("le avanzate partono chiuse", () => {
    render(<MqttSourceCard source={mqtt} onChange={() => {}} onDelete={() => {}} onCreateTag={() => {}} />);
    const avanzate = screen.getByTestId("mqtt-avanzate-mqtt-garage");
    expect(within(avanzate).getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Protocolli", () => {
  it("la disponibilità sta dentro la card, una volta sola, e lo stato in testata", async () => {
    statoSorgenti.mockResolvedValue({ "mqtt-garage": { stato: "non_risponde", errore: "broker giù", da_ms: Date.now() } });
    useAppStore.setState({
      project: { meta: { name: "p", version: "1" }, tags: [], types: [], sources: [mqtt], alarms: [], functions: [] } as never,
      configTab: "protocols", configFocus: null, elenchiConfig: {}, remoteConnected: false,
    } as never);
    render(<ProtocolsTab />);
    const sezioni = screen.getAllByTestId("disponibilita-mqtt-garage");
    expect(sezioni).toHaveLength(1);
    // Stessa card: la testata e la sezione hanno lo stesso contenitore.
    const card = screen.getByTestId("testata-mqtt-garage").parentElement!;
    expect(card.contains(sezioni[0])).toBe(true);
    await waitFor(() => expect(within(screen.getByTestId("testata-mqtt-garage")).getByTestId("stato-mqtt-garage").getAttribute("data-stato")).toBe("errore"));
  });
});

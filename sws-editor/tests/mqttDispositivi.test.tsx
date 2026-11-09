/** I dispositivi dentro una sorgente MQTT (08-11-2026, piano
 *  `docs/archive/2026-11-08-mqtt-dispositivi.md`): le impostazioni pronte col
 *  nome del dispositivo, il raggruppamento delle righe dai topic, la sezione
 *  della card col pallino di ciascuno, e la sorgente «con errori» quando un
 *  dispositivo tace. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { statoSorgenti } = vi.hoisted(() => ({
  statoSorgenti: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoSorgenti } };
});

import {
  disponibilitaDaPreset, dispositivoDelTopic, presetDelDispositivo, raggruppaDaiTopic,
} from "../src/config/sorgenti/dispositiviMqtt";
import { allarmeDisponibilitaDispositivo, tagDisponibilitaDispositivo } from "../src/config/sorgenti/disponibilita";
import { coloreStato, statoComplessivo } from "../src/config/sorgenti/statoSorgenti";
import { MqttSourceCard } from "../src/config/sorgenti/MqttSourceCard";
import { useAppStore } from "../src/store";
import type { MqttSource, TopicMapping } from "../src/types";

beforeAll(async () => { await i18n.changeLanguage("it"); });

const riga = (tag: string, topic: string, dispositivo?: string): TopicMapping => ({ tag, topic, dispositivo });

describe("i nomi", () => {
  it("il tag di un dispositivo ha un segmento solo, come in Rust", () => {
    expect(tagDisponibilitaDispositivo("mqtt-casa", "presa.sandokan")).toBe("mqtt-casa.presa_sandokan.disponibile");
    expect(tagDisponibilitaDispositivo("mqtt-casa", "Tapparella.PianoTerra.Bagno"))
      .toBe("mqtt-casa.tapparella_pianoterra_bagno.disponibile");
    const a = allarmeDisponibilitaDispositivo("mqtt-casa", "presa.sandokan", "giù");
    expect(a.id).toBe("disponibilita-mqtt-casa-presa_sandokan");
    expect(a.tag).toBe("mqtt-casa.presa_sandokan.disponibile");
    expect(a.levels?.[0].condition.kind).toBe("bool_false");
  });

  it("le impostazioni pronte mettono il nome del dispositivo", () => {
    expect(disponibilitaDaPreset("zigbee2mqtt", "presa.sandokan"))
      .toEqual({ topic: "zigbee2mqtt/presa.sandokan/availability", json_path: "state", vivo: "online" });
    expect(disponibilitaDaPreset("modbus", "contatore").topic).toBe("modbus/status");
    expect(presetDelDispositivo({ id: "x", disponibilita: disponibilitaDaPreset("tuya", "x") })).toBe("tuya");
    expect(presetDelDispositivo({ id: "x", disponibilita: { topic: "altro", vivo: "1" } })).toBe("personalizzato");
  });
});

describe("raggruppare dai topic", () => {
  it("riconosce le famiglie della mappa di casa", () => {
    expect(dispositivoDelTopic("zigbee2mqtt/presa.sandokan")).toEqual({ id: "presa.sandokan", preset: "zigbee2mqtt" });
    expect(dispositivoDelTopic("zigbee2mqtt/bridge/state")).toBeNull();
    expect(dispositivoDelTopic("tuya/termostato-camera/state")?.preset).toBe("tuya");
    expect(dispositivoDelTopic("tele/P_SonOffPowR2_01/SENSOR")).toEqual({ id: "P_SonOffPowR2_01", preset: "tasmota" });
    expect(dispositivoDelTopic("modbus/temperature-casa/state")?.preset).toBe("modbus");
    expect(dispositivoDelTopic("frigate/Cancelletto/person")?.id).toBe("Cancelletto");
    expect(dispositivoDelTopic("frigate/events")).toBeNull();
    expect(dispositivoDelTopic("casa/meteo")).toBeNull();
  });

  it("assegna le righe senza dispositivo e riusa quelli che ci sono", () => {
    const r = raggruppaDaiTopic(
      [
        riga("sandokan.power", "zigbee2mqtt/presa.sandokan"),
        riga("sandokan.state", "zigbee2mqtt/presa.sandokan"),
        riga("tv.power", "zigbee2mqtt/presa.tv"),
        riga("meteo", "casa/meteo"),
        riga("luce", "zigbee2mqtt/luce", "altro"),
      ],
      [{ id: "presa.tv", disponibilita: { topic: "x", vivo: "1" } }],
    );
    expect(r.assegnate).toBe(3);
    expect(r.nuovi.map((d) => d.id)).toEqual(["presa.sandokan"]);
    expect(r.righe.map((x) => x.dispositivo)).toEqual(["presa.sandokan", "presa.sandokan", "presa.tv", undefined, "altro"]);
  });
});

describe("lo stato", () => {
  it("un dispositivo che tace rende la sorgente «con errori», col suo nome", () => {
    const s = statoComplessivo({
      stato: "ok", da_ms: 1,
      dispositivi: { "presa.sandokan": { stato: "non_risponde", da_ms: 2 }, frigo: { stato: "ok", da_ms: 2 } },
    });
    expect(coloreStato(s)).toBe("parziale");
    expect(s?.errore).toBe("presa.sandokan");
    expect(coloreStato(statoComplessivo({ stato: "ok", da_ms: 1, dispositivi: { a: { stato: "ok", da_ms: 1 } } }))).toBe("ok");
    expect(coloreStato(statoComplessivo({ stato: "non_risponde", da_ms: 1 }))).toBe("errore");
  });
});

describe("la card", () => {
  const sorgente = {
    kind: "mqtt", id: "mqtt-casa", host: "broker.casa", port: 1883, client_id: "sws",
    topics: [riga("sandokan.power", "zigbee2mqtt/presa.sandokan"), riga("meteo", "casa/meteo")],
  } as unknown as MqttSource;

  it("senza dispositivi: niente colonna, e il pulsante che raggruppa dichiara il tag", () => {
    useAppStore.setState({ project: { alarms: [] } as never, remoteConnected: false } as never);
    const onChange = vi.fn();
    const onCreateTag = vi.fn();
    render(<MqttSourceCard source={sorgente} onChange={onChange} onDelete={() => {}} onCreateTag={onCreateTag} />);
    expect(screen.queryByTestId("riga-dispositivo-0")).toBeNull();
    fireEvent.click(screen.getByTestId("mqtt-raggruppa"));
    const nuova = onChange.mock.calls[0][0] as MqttSource;
    expect(nuova.dispositivi?.[0].disponibilita.topic).toBe("zigbee2mqtt/presa.sandokan/availability");
    expect(nuova.topics[0].dispositivo).toBe("presa.sandokan");
    expect(onCreateTag.mock.calls[0][0].id).toBe("mqtt-casa.presa_sandokan.disponibile");
  });

  it("con dispositivi: la colonna, il pallino di ciascuno, e la testata «con errori»", async () => {
    statoSorgenti.mockResolvedValue({
      "mqtt-casa": { stato: "ok", da_ms: 1, dispositivi: { "presa.sandokan": { stato: "non_risponde", errore: "offline", da_ms: 2 } } },
    });
    useAppStore.setState({ project: { alarms: [] } as never, remoteConnected: false } as never);
    const con = {
      ...sorgente,
      topics: [riga("sandokan.power", "zigbee2mqtt/presa.sandokan", "presa.sandokan"), riga("meteo", "casa/meteo")],
      dispositivi: [{ id: "presa.sandokan", disponibilita: disponibilitaDaPreset("zigbee2mqtt", "presa.sandokan") }],
    } as MqttSource;
    const onChange = vi.fn();
    render(<MqttSourceCard source={con} onChange={onChange} onDelete={() => {}} onCreateTag={() => {}} />);
    expect((screen.getByTestId("riga-dispositivo-0") as HTMLSelectElement).value).toBe("presa.sandokan");
    expect((screen.getByTestId("riga-dispositivo-1") as HTMLSelectElement).value).toBe("");
    await waitFor(() => expect(screen.getByTestId("mqtt-dispositivo-stato-presa.sandokan").getAttribute("data-stato")).toBe("errore"));
    expect(screen.getByTestId("stato-mqtt-casa").getAttribute("data-stato")).toBe("parziale");
    // Rinominare il dispositivo si porta dietro le righe.
    fireEvent.change(screen.getByTestId("mqtt-dispositivo-id-0"), { target: { value: "sandokan" } });
    const nuova = onChange.mock.calls[0][0] as MqttSource;
    expect(nuova.topics[0].dispositivo).toBe("sandokan");
  });
});

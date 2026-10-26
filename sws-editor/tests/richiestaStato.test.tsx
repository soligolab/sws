import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n";
import { compilaRichiesteZigbee2mqtt, pubblicabile, richiestaZigbee2mqtt } from "../src/config/sorgenti/richiestaStato";
import { MqttSourceCard } from "../src/config/sorgenti/MqttSourceCard";
import type { MqttSource } from "../src/types";

/** Lo stato iniziale dei tag MQTT (25-10-2026): dopo un riavvio del pannello i
 *  led dello switch del garage restavano bianchi finché non si premeva un
 *  pulsante, perché Zigbee2MQTT non pubblica con `retain`. La riga può chiedere
 *  lo stato; per Zigbee2MQTT la richiesta si compila da sola. */
const garage = (n: number) => ({ tag: `garage.l${n}`, topic: "zigbee2mqtt/garage", json_path: `state_l${n}` });

describe("richiesta di stato", () => {
  it("segue la convenzione di Zigbee2MQTT", () => {
    expect(richiestaZigbee2mqtt(garage(1))).toEqual({ topic: "zigbee2mqtt/garage/get", payload: '{"state_l1":""}' });
    // senza json_path si chiede `state`; un percorso annidato chiede il primo livello
    expect(richiestaZigbee2mqtt({ tag: "x", topic: "zigbee2mqtt/presa/" }).payload).toBe('{"state":""}');
    expect(richiestaZigbee2mqtt({ tag: "x", topic: "zigbee2mqtt/t", json_path: "update.state" }).payload).toBe('{"update":""}');
  });

  it("compila solo le righe di Zigbee2MQTT che non l'hanno", () => {
    const righe = [garage(1), { ...garage(2), richiesta_stato: { topic: "a/get", payload: "x" } }, { tag: "y", topic: "casa/luce" }];
    const { righe: nuove, toccate } = compilaRichiesteZigbee2mqtt(righe);
    expect(toccate).toBe(1);
    expect(nuove[0].richiesta_stato?.topic).toBe("zigbee2mqtt/garage/get");
    expect(nuove[1].richiesta_stato?.topic).toBe("a/get");
    expect(nuove[2].richiesta_stato).toBeUndefined();
  });

  it("un topic con caratteri jolly non è pubblicabile", () => {
    expect(pubblicabile("zigbee2mqtt/+/get")).toBe(false);
    expect(pubblicabile(" ")).toBe(false);
    expect(pubblicabile("zigbee2mqtt/garage/get")).toBe(true);
  });

  it("nella scheda: ⟳ aggiunge la richiesta, il pulsante sotto compila tutte le righe", () => {
    const sorgente: MqttSource = { kind: "mqtt", id: "z2m", host: "h", port: 1883, client_id: "sws", topics: [garage(1), garage(2), garage(3)] } as MqttSource;
    const onChange = vi.fn();
    render(<MqttSourceCard source={sorgente} onChange={onChange} onDelete={() => {}} onCreateTag={() => {}} />);
    fireEvent.click(screen.getByTestId("richiesta-stato-1"));
    expect(onChange.mock.calls[0][0].topics[1].richiesta_stato).toEqual({ topic: "zigbee2mqtt/garage/get", payload: '{"state_l2":""}' });
    fireEvent.click(screen.getByTestId("compila-richieste-z2m"));
    const righe = onChange.mock.calls[1][0].topics;
    expect(righe.every((r: { richiesta_stato?: unknown }) => r.richiesta_stato)).toBe(true);
  });
});

/** La disponibilità delle sorgenti nell'IDE (28-10-2026, ramo 2 del piano
 *  `docs/plans/2026-10-28-chi-sta-dall-altra-parte.md`): il tag giusto, le
 *  impostazioni pronte, e l'allarme preparato che la scheda Allarmi accoglie
 *  nella sua bozza — senza farne un secondo se sul tag ce n'è già uno. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import {
  allarmeDisponibilita, haDisponibilita, presetDi, tagDisponibilita, PRESET_DISPONIBILITA,
} from "../src/config/sorgenti/disponibilita";
import { DisponibilitaSorgente } from "../src/config/sorgenti/DisponibilitaSorgente";
import { AlarmsTab } from "../src/config/schede/AlarmsTab";
import { useAppStore } from "../src/store";
import type { SourceDef } from "../src/types";

const mqtt = { kind: "mqtt", id: "mqtt-garage", host: "h", port: 1883, client_id: "c", topics: [] } as unknown as SourceDef;

describe("le funzioni pure", () => {
  it("il nome del tag è lo stesso del runtime", () => {
    expect(tagDisponibilita("mqtt-garage")).toBe("mqtt-garage.disponibile");
  });

  it("solo le sorgenti con un altro capo", () => {
    expect(haDisponibilita(mqtt)).toBe(true);
    expect(haDisponibilita({ ...mqtt, sparkplug: {} } as unknown as SourceDef)).toBe(false);
    expect(haDisponibilita({ kind: "host", id: "h" } as unknown as SourceDef)).toBe(false);
    expect(haDisponibilita({ kind: "opcua_server", id: "s" } as unknown as SourceDef)).toBe(false);
    expect(haDisponibilita({ kind: "s7", id: "plc" } as unknown as SourceDef)).toBe(true);
  });

  it("le impostazioni pronte si riconoscono, anche col nome già messo", () => {
    expect(presetDi(PRESET_DISPONIBILITA.zigbee2mqtt)).toBe("zigbee2mqtt");
    expect(presetDi({ topic: "tele/presa_cucina/LWT", vivo: "Online" })).toBe("tasmota");
    expect(presetDi({ topic: "casa/qualcosa", vivo: "su" })).toBe("personalizzato");
    expect(presetDi(undefined)).toBeNull();
  });

  it("l'allarme preparato è a livelli, falso per un minuto", () => {
    const a = allarmeDisponibilita("mqtt-garage", "giù");
    expect(a.tag).toBe("mqtt-garage.disponibile");
    expect(a.levels?.[0].condition).toEqual({ kind: "bool_false" });
    expect(a.on_delay_s).toBe(60);
    expect(a.condition).toBeUndefined();
  });
});

describe("dal pulsante alla scheda Allarmi", () => {
  beforeEach(() => {
    // jsdom non sa scorrere: la riga scelta della scheda Allarmi lo chiede.
    Element.prototype.scrollIntoView = () => {};
    useAppStore.setState({
      tagInAttesa: [], allarmeInAttesa: null, configTab: "protocols", configFocus: null,
      tagValues: { "mqtt-garage.disponibile": { value: false, quality: "Good", timestamp_ms: 1 } },
      project: { meta: { name: "p", version: "1" }, tags: [], sources: [mqtt], alarms: [], functions: [] },
    } as never);
  });

  it("il pulsante dichiara il tag e prepara l'allarme, e porta alla scheda", () => {
    render(<DisponibilitaSorgente src={mqtt} />);
    expect(screen.getByTestId("disponibilita-adesso-mqtt-garage").textContent).toMatch(/non risponde|not responding/);
    fireEvent.click(screen.getByTestId("disponibilita-crea-mqtt-garage"));
    const s = useAppStore.getState();
    expect(s.tagInAttesa.map((t) => t.id)).toEqual(["mqtt-garage.disponibile"]);
    expect(s.tagInAttesa[0].data_type).toBe("bool");
    expect(s.allarmeInAttesa?.tag).toBe("mqtt-garage.disponibile");
    expect(s.configTab).toBe("alarms");
    expect(s.configFocus).toBe("disponibilita-mqtt-garage");
  });

  it("la scheda Allarmi lo prende nella sua bozza, una volta", async () => {
    useAppStore.setState({ allarmeInAttesa: allarmeDisponibilita("mqtt-garage", "giù"), configTab: "alarms" } as never);
    render(<AlarmsTab />);
    await waitFor(() => expect(useAppStore.getState().allarmeInAttesa).toBeNull());
    // La bozza è sporca e il salvataggio è registrato: si salva come ogni altro.
    expect(useAppStore.getState().pendingSections["alarms"]).toBeTruthy();
  });

  it("se sul tag c'è già un allarme, non se ne fa un secondo", async () => {
    const esistente = { ...allarmeDisponibilita("mqtt-garage", "già c'è"), id: "vecchio" };
    useAppStore.setState({
      project: { meta: { name: "p", version: "1" }, tags: [], sources: [mqtt], alarms: [esistente], functions: [] },
      allarmeInAttesa: allarmeDisponibilita("mqtt-garage", "giù"), configTab: "alarms",
    } as never);
    render(<AlarmsTab />);
    await waitFor(() => expect(useAppStore.getState().allarmeInAttesa).toBeNull());
    expect(useAppStore.getState().configFocus).toBe("vecchio");
    expect(useAppStore.getState().pendingSections["alarms"], "niente da salvare").toBeFalsy();
  });
});

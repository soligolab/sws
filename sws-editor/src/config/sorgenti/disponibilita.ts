// La disponibilità delle sorgenti nell'IDE (28-10-2026, ramo 2 del piano
// `docs/archive/2026-10-28-chi-sta-dall-altra-parte.md`).
//
// Il runtime scrive `<sorgente>.disponibile` (vero/falso) per ogni sorgente che
// sa dire se ha qualcuno dall'altra parte. Qui: quali sorgenti lo fanno, il tag
// da dichiarare perché il selettore e la validazione lo vedano, l'allarme da
// preparare, e le impostazioni pronte del topic di disponibilità MQTT.

import type { AlarmDef, DisponibilitaMqtt, SourceDef, TagDef } from "@/types";

/** Gemello di `sws_core::tag_disponibilita`: il nome si compone in un punto solo. */
export function tagDisponibilita(sorgente: string): string {
  // Il suffisso è un nome, non una scritta: non si traduce.
  return [sorgente, "disponibile"].join(".");
}

/** Le sorgenti che scrivono lo stato del collegamento. Il server OPC-UA è SWS
 *  stesso, e la sorgente host non ha un altro capo; Sparkplug B ancora no. */
export function haDisponibilita(src: SourceDef): boolean {
  switch (src.kind) {
    case "modbus_tcp":
    case "modbus_rtu":
    case "opcua_client":
    case "homeassistant":
    case "s7":
    case "enip":
      return true;
    case "mqtt":
      return !src.sparkplug;
    default:
      return false;
  }
}

export function tagDefDisponibilita(sorgente: string, descrizione: string): TagDef {
  return { id: tagDisponibilita(sorgente), description: descrizione, data_type: "bool" };
}

/** L'allarme preparato: scatta quando la sorgente resta senza nessuno
 *  dall'altra parte per un minuto. Un minuto e non zero: una riconnessione
 *  del broker o il riavvio di un dispositivo non devono svegliare nessuno. */
export function allarmeDisponibilita(sorgente: string, messaggio: string): AlarmDef {
  return {
    id: `disponibilita-${sorgente}`,
    tag: tagDisponibilita(sorgente),
    // A livelli, come `emptyAlarm` della scheda Allarmi: la forma a condizione
    // singola lì è «vecchia» e chiede di essere convertita.
    levels: [{ condition: { kind: "bool_false" }, severity: "Warning", message: messaggio }],
    on_delay_s: 60,
  };
}

/** Le impostazioni pronte del topic di disponibilità. `{nome}` si sostituisce
 *  col nome del dispositivo (Tasmota, Shelly, ESPHome); Zigbee2MQTT ha un
 *  topic solo per tutto il bridge. */
export const PRESET_DISPONIBILITA = {
  zigbee2mqtt: { topic: "zigbee2mqtt/bridge/state", json_path: "state", vivo: "online" },
  tasmota: { topic: "tele/{nome}/LWT", vivo: "online" },
  shelly: { topic: "{nome}/online", vivo: "true" },
  esphome: { topic: "{nome}/status", vivo: "online" },
} as const satisfies Record<string, DisponibilitaMqtt>;

export type PresetDisponibilita = keyof typeof PRESET_DISPONIBILITA;

/** Quale impostazione pronta corrisponde a questa configurazione, se una. */
export function presetDi(d: DisponibilitaMqtt | undefined): PresetDisponibilita | "personalizzato" | null {
  if (!d) return null;
  for (const [k, p] of Object.entries(PRESET_DISPONIBILITA) as [PresetDisponibilita, DisponibilitaMqtt][]) {
    const forma = new RegExp("^" + p.topic.split("{nome}").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/#+]+") + "$");
    if (forma.test(d.topic) && (d.json_path ?? "") === (p.json_path ?? "") && d.vivo.trim().toLowerCase() === p.vivo) return k;
  }
  return "personalizzato";
}

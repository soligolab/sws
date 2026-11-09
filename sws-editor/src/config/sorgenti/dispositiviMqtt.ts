// I dispositivi dentro una sorgente MQTT (08-11-2026, piano
// `docs/archive/2026-11-08-mqtt-dispositivi.md`).
//
// Una sorgente sola per tutta casa, e per ogni dispositivo il topic che dice
// se è vivo: quando una presa sparisce diventano Bad solo le sue righe. Qui le
// impostazioni pronte per dispositivo e il raggruppamento delle righe già
// mappate: dal topic di una riga si capisce di chi è, quando segue una delle
// convenzioni note.

import type { DisponibilitaMqtt, DispositivoMqtt, TopicMapping } from "@/types";

/** Le impostazioni pronte per un dispositivo: `{nome}` è il suo id. Diverse da
 *  quelle della sorgente per Zigbee2MQTT (lì c'è il bridge, qui il singolo
 *  dispositivo, con la disponibilità accesa in Zigbee2MQTT); Modbus e Frigate
 *  hanno un topic solo per tutti i loro dispositivi. */
export const PRESET_DISPOSITIVO = {
  zigbee2mqtt: { topic: "zigbee2mqtt/{nome}/availability", json_path: "state", vivo: "online" },
  tuya: { topic: "tuya/{nome}/availability", vivo: "online" },
  tasmota: { topic: "tele/{nome}/LWT", vivo: "online" },
  shelly: { topic: "{nome}/online", vivo: "true" },
  esphome: { topic: "{nome}/status", vivo: "online" },
  modbus: { topic: "modbus/status", vivo: "online" },
  frigate: { topic: "frigate/available", vivo: "online" },
} as const satisfies Record<string, DisponibilitaMqtt>;

export type PresetDispositivo = keyof typeof PRESET_DISPOSITIVO;

export function disponibilitaDaPreset(k: PresetDispositivo, nome: string): DisponibilitaMqtt {
  const p: DisponibilitaMqtt = PRESET_DISPOSITIVO[k];
  return { ...p, topic: p.topic.replace("{nome}", nome) };
}

/** Quale impostazione pronta corrisponde al dispositivo, se una. */
export function presetDelDispositivo(d: DispositivoMqtt): PresetDispositivo | "personalizzato" {
  for (const k of Object.keys(PRESET_DISPOSITIVO) as PresetDispositivo[]) {
    const p = disponibilitaDaPreset(k, d.id);
    const a = d.disponibilita;
    if (a.topic === p.topic && (a.json_path ?? "") === (p.json_path ?? "") && a.vivo.trim().toLowerCase() === p.vivo) return k;
  }
  return "personalizzato";
}

/** Di quale dispositivo è un topic, secondo le convenzioni della mappa di
 *  casa: `zigbee2mqtt/<n>`, `tuya/<t>/…`, `stat|tele|cmnd/<t>/…` (Tasmota),
 *  `modbus/<d>/…`, `frigate/<cam>/…`. Il bridge e i topic di servizio no. */
export function dispositivoDelTopic(topic: string): { id: string; preset: PresetDispositivo } | null {
  const p = topic.split("/");
  if (p.length < 2 || !p[1]) return null;
  switch (p[0]) {
    case "zigbee2mqtt":
      return p[1] === "bridge" ? null : { id: p[1], preset: "zigbee2mqtt" };
    case "tuya":
      return p.length >= 3 && p[1] !== "status" ? { id: p[1], preset: "tuya" } : null;
    case "stat":
    case "tele":
    case "cmnd":
      return p.length >= 3 ? { id: p[1], preset: "tasmota" } : null;
    case "modbus":
      return p.length >= 3 ? { id: p[1], preset: "modbus" } : null;
    case "frigate":
      return p.length >= 3 ? { id: p[1], preset: "frigate" } : null;
    default:
      return null;
  }
}

/** Le righe senza dispositivo che si sanno assegnare, e i dispositivi nuovi
 *  che servono. Le righe che hanno già un dispositivo non si toccano; un
 *  dispositivo che c'è già si riusa. */
export function raggruppaDaiTopic(
  righe: TopicMapping[],
  esistenti: DispositivoMqtt[],
): { righe: TopicMapping[]; nuovi: DispositivoMqtt[]; assegnate: number } {
  const ids = new Set(esistenti.map((d) => d.id));
  const nuovi: DispositivoMqtt[] = [];
  let assegnate = 0;
  const fuori = righe.map((r) => {
    if (r.dispositivo) return r;
    const d = dispositivoDelTopic(r.topic);
    if (!d) return r;
    if (!ids.has(d.id)) {
      ids.add(d.id);
      nuovi.push({ id: d.id, disponibilita: disponibilitaDaPreset(d.preset, d.id) });
    }
    assegnate++;
    return { ...r, dispositivo: d.id };
  });
  return { righe: fuori, nuovi, assegnate };
}

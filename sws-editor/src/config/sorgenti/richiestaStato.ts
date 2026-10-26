// La richiesta di stato di una riga MQTT (25-10-2026, piano
// `docs/plans/2026-10-25-stato-iniziale-mqtt.md`).
//
// Un broker che non conserva l'ultimo valore (`retain` spento: Zigbee2MQTT di
// default) non ha niente da consegnare alla sottoscrizione, e dopo un riavvio il
// tag resta senza valore finché lo stato non cambia. Il runtime allora chiede:
// pubblica `payload` su `topic`, e il dispositivo risponde sul topic di stato.
import type { RichiestaStato, TopicMapping } from "@/types";

/** Il prefisso dei topic di Zigbee2MQTT (`base_topic` di default). */
export const BASE_ZIGBEE2MQTT = "zigbee2mqtt/";

/** La richiesta secondo la convenzione di Zigbee2MQTT: `<topic>/get` con il
 *  campo da rileggere (`{"state_l1":""}`), o `state` se la riga legge il payload
 *  intero. Un `json_path` annidato (`a.b`) chiede il campo di primo livello: è
 *  quello che Zigbee2MQTT sa rileggere. */
export function richiestaZigbee2mqtt(riga: TopicMapping): RichiestaStato {
  const campo = (riga.json_path ?? "").split(".")[0].trim() || "state";
  return { topic: `${riga.topic.trim().replace(/\/+$/, "")}/get`, payload: JSON.stringify({ [campo]: "" }) };
}

/** Compila la richiesta sulle righe di Zigbee2MQTT che non l'hanno; le altre
 *  restano come sono. Restituisce le righe nuove e quante ne ha toccate. */
export function compilaRichiesteZigbee2mqtt(righe: TopicMapping[]): { righe: TopicMapping[]; toccate: number } {
  let toccate = 0;
  const nuove = righe.map((r) => {
    if (r.richiesta_stato || !r.topic.trim().startsWith(BASE_ZIGBEE2MQTT)) return r;
    toccate++;
    return { ...r, richiesta_stato: richiestaZigbee2mqtt(r) };
  });
  return { righe: nuove, toccate };
}

/** Un topic su cui si può pubblicare: non vuoto e senza caratteri jolly. Gemello
 *  di `sws_plugin_mqtt::pubblicabile`. */
export function pubblicabile(topic: string): boolean {
  return topic.trim() !== "" && !/[+#]/.test(topic);
}

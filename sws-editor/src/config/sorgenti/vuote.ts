import { genId } from "@/id";
import type { EntityMapping, HomeAssistantSource, ModbusTcpSource, ModbusRtuSource, OpcUaServerNodeMapping, OpcUaServerSource, MqttSource, OpcUaNodeMapping, OpcUaSource, RegisterMapping, S7Source, S7TagMapping, SourceDef, TopicMapping } from "@/types";

// ── PROTOCOL / SOURCE forms ───────────────────────────────────────────────────

export function emptyModbus(): ModbusTcpSource {
  return {
    kind: "modbus_tcp",
    id: `plc-${genId()}`,
    host: "192.168.1.10",
    port: 502,
    unit_id: 1,
    poll_interval_ms: 1000,
    registers: [],
  };
}

export function emptyModbusRtu(): ModbusRtuSource {
  return {
    kind: "modbus_rtu",
    id: `rtu-${genId()}`,
    device: "/dev/ttyUSB0",
    baud_rate: 9600,
    parity: "N",
    data_bits: 8,
    stop_bits: 1,
    unit_id: 1,
    poll_interval_ms: 1000,
    registers: [],
  };
}

export function emptyRegister(): RegisterMapping {
  return { tag: "", address: 0, scale: 1 };
}

/** Le righe MQTT senza topic non si salvano.
 *
 *  Sandokan, 2026-09-07: una riga lasciata vuota dallo sfoglia-broker faceva
 *  mandare al broker una sottoscrizione con un filtro a lunghezza zero — errore
 *  di protocollo — e mosquitto chiudeva la connessione 2 ms dopo, uccidendo
 *  **tutti** gli altri 27 topic della sorgente. Nei log si leggeva solo
 *  «broken pipe», che manda a cercare la rete o il broker.
 *
 *  Il server fa la stessa potatura (`PUT /api/project/sources`), perché passano
 *  di lì anche l'assistente IA e le chiamate dirette all'API. Qui serve perché
 *  il salvataggio non rilegge dal server: senza, la tabella continuerebbe a
 *  mostrare una riga che sul disco non c'è più. */
export function sorgentiSenzaRigheVuote(sources: SourceDef[]): SourceDef[] {
  let potato = false;
  const out = sources.map((s) => {
    if (s.kind === "mqtt" && s.topics?.some((t) => !(t.topic ?? "").trim())) {
      potato = true;
      return { ...s, topics: s.topics.filter((t) => (t.topic ?? "").trim()) };
    }
    return s;
  });
  // Stessa referenza quando non c'è niente da togliere: il chiamante la usa
  // per non ridisegnare la tabella a ogni salvataggio.
  return potato ? out : sources;
}

export function emptyMqtt(): MqttSource {
  return {
    kind: "mqtt",
    id: `mqtt-${genId()}`,
    host: "broker.local",
    port: 1883,
    client_id: `sws-${genId()}`,
    topics: [],
    // Nuove sorgenti nascono con Random attivo di default: il client_id
    // letterale collide silenziosamente se lo stesso progetto viene aperto
    // dall'IDE e/o deployato su più device verso lo stesso broker.
    random_client_id: { enabled: true, position: "suffix" },
  };
}

export function emptyTopic(): TopicMapping {
  return { tag: "", topic: "", json_path: undefined };
}

export function emptyOpcUa(): OpcUaSource {
  return {
    kind: "opcua_client",
    id: `opcua-${genId()}`,
    endpoint_url: "opc.tcp://localhost:4840",
    security_policy: "None",
    auth: { kind: "anonymous" },
    subscription_interval_ms: 500,
    nodes: [],
  };
}

export function emptyOpcUaNode(): OpcUaNodeMapping {
  return { tag: "", node_id: "" };
}

export function emptyOpcUaServer(): OpcUaServerSource {
  return {
    kind: "opcua_server",
    id: `opcua-srv-${genId()}`,
    port: 4840,
    namespace_uri: "urn:soligolab:sws",
    nodes: [],
  };
}

export function emptyOpcUaServerNode(): OpcUaServerNodeMapping {
  return { tag: "" };
}

export function emptyHomeAssistant(): HomeAssistantSource {
  return {
    kind: "homeassistant",
    id: `ha-${genId()}`,
    url: "http://homeassistant.local:8123",
    token: "",
    entities: [],
  };
}

export function emptyEntityMapping(): EntityMapping {
  return { tag: "", entity_id: "" };
}

export function emptyS7(): S7Source {
  return {
    kind: "s7",
    id: `s7-${genId()}`,
    ip: "192.168.1.5",
    rack: 0,
    slot: 1,
    poll_interval_ms: 500,
    tags: [],
  };
}

export function emptyS7Tag(): S7TagMapping {
  return {
    tag: "",
    area: "db",
    db_num: 1,
    byte_offset: 0,
    bit_offset: 0,
    data_type: "real",
    writable: false,
  };
}

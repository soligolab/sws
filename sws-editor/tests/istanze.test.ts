import { describe, expect, it } from "vitest";
import { motivoNomeIstanza, nomeIstanzaProposto } from "../src/tag/istanze";

describe("istanza di un tipo dalla scheda Tipi", () => {
  it("propone l'id del tipo in minuscolo, unico", () => {
    expect(nomeIstanzaProposto("Hosts", [])).toBe("hosts");
    expect(nomeIstanzaProposto("host", ["host", "host2"])).toBe("host3");
    expect(nomeIstanzaProposto("Motore PID", [])).toBe("motore_pid");
  });
  it("rifiuta vuoto, spazi, punti e parentesi, e un nome già usato", () => {
    expect(motivoNomeIstanza("", [])).toBe("tipiTab.nomeVuoto");
    expect(motivoNomeIstanza("a b", [])).toBe("tipiTab.nomeCaratteri");
    expect(motivoNomeIstanza("sistema.cpu", [])).toBe("tipiTab.nomeCaratteri");
    expect(motivoNomeIstanza("v[1]", [])).toBe("tipiTab.nomeCaratteri");
    expect(motivoNomeIstanza("tc620", ["tc620"])).toBe("tipiTab.nomeEsiste");
    expect(motivoNomeIstanza("tc620", [])).toBeNull();
  });
});

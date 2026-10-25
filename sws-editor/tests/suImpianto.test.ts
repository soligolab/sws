/** Le chiamate sull'impianto le fa il pannello collegato (25-10-2026, piano
 *  2026-10-25-impianto-dal-dispositivo): dal cloud lo sfoglia del broker di
 *  casa trovava 0 topic, perché partiva dal VPS. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";

const chiamate: string[] = [];

beforeEach(() => {
  chiamate.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    chiamate.push(String(url));
    return new Response(JSON.stringify({ topics: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({ remoteConnected: false, remoteUrl: null });
  window.history.replaceState({}, "", "/");
});

const sfoglia = () => api.browseMqttTopics({ host: "192.168.1.6", port: 1883, client_id: "x" } as never);

describe("dove gira una scoperta", () => {
  it("in locale senza pannello: su questa macchina, com'era", async () => {
    await sfoglia();
    expect(chiamate).toEqual(["/api/sources/mqtt/browse"]);
  });

  it("con un pannello collegato: sul pannello, che vede l'impianto", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://sws/dev/tc620-garage" });
    await sfoglia();
    await api.testDatastore("storico");
    await api.listOpcUaCerts("pressa");
    expect(chiamate).toEqual([
      "/api/remote/sources/mqtt/browse",
      "/api/remote/datastores/storico/test",
      "/api/remote/sources/pressa/opcua/certs",
    ]);
  });

  it("nel cloud senza pannello: dice cosa fare, e dal VPS non parte niente", async () => {
    window.history.replaceState({}, "", "/p/-/CasaDomotica/");
    await expect(sfoglia()).rejects.toThrow(/panel/i);
    expect(chiamate).toEqual([]);
  });
});

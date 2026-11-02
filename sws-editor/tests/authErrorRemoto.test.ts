/** Un 401 che viene da un **altro** runtime porta il suo motivo (02-11-2026):
 *  «Abbina un pannello» dal cloud riceveva `credenziali_admin` dal pannello e
 *  mostrava solo «unauthorized», senza mai chiedere utente e password. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, AuthError } from "../src/api/client";

afterEach(() => { vi.unstubAllGlobals(); });

function risponde401(corpo: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(corpo, { status: 401 })));
}

describe("401 da un altro runtime", () => {
  it("tiene il motivo, e resta un AuthError", async () => {
    risponde401('{"errore":"credenziali_admin","detail":"servono utente e password"}');
    const e = await api.abbinaPannelloCloud("RYA2-AKEJ-4YSF-1NTH").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthError);
    expect((e as Error).message).toContain("credenziali_admin");
  });

  it("senza motivo resta «unauthorized»", async () => {
    risponde401("");
    const e = await api.abbinaPannelloCloud("RYA2-AKEJ-4YSF-1NTH").catch((x: unknown) => x);
    expect((e as Error).message).toBe("unauthorized");
  });
});

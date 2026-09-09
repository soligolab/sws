import { describe, expect, it, beforeEach } from "vitest";
import { dimenticaPasswordLegacy } from "./passwordNelBrowser";

describe("dimenticaPasswordLegacy", () => {
  beforeEach(() => localStorage.clear());

  it("toglie la password del runtime e lascia URL e utente", () => {
    localStorage.setItem("sws.runtime.targetUrl", "https://wp630:8444");
    localStorage.setItem("sws.runtime.targetUser", "user");
    localStorage.setItem("sws.runtime.targetPass", "123456");
    expect(dimenticaPasswordLegacy()).toBe(1);
    expect(localStorage.getItem("sws.runtime.targetPass")).toBeNull();
    expect(localStorage.getItem("sws.runtime.targetUrl")).toBe("https://wp630:8444");
    expect(localStorage.getItem("sws.runtime.targetUser")).toBe("user");
  });

  it("dai dispositivi registrati toglie solo il campo pass", () => {
    localStorage.setItem("sws.saved-devices", JSON.stringify([
      { label: "PLC-01", url: "https://a:8444", user: "admin", pass: "segreta" },
      { label: "PLC-02", url: "https://b:8444", user: "admin" },
    ]));
    expect(dimenticaPasswordLegacy()).toBe(1);
    expect(JSON.parse(localStorage.getItem("sws.saved-devices")!)).toEqual([
      { label: "PLC-01", url: "https://a:8444", user: "admin" },
      { label: "PLC-02", url: "https://b:8444", user: "admin" },
    ]);
  });

  it("toglie tutte le chiavi sws.deploy.<host>, anche se sono più di una", () => {
    localStorage.setItem("sws.deploy.wp630.local", JSON.stringify({ user: "root", password: "x" }));
    localStorage.setItem("sws.deploy.plx800.local", JSON.stringify({ user: "root", password: "y" }));
    localStorage.setItem("sws.deploy.terzo", "z");
    localStorage.setItem("sws.altro", "resta");
    expect(dimenticaPasswordLegacy()).toBe(3);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("sws.altro")).toBe("resta");
  });

  it("è idempotente e non tocca ciò che non è JSON", () => {
    localStorage.setItem("sws.saved-devices", "non-json");
    expect(dimenticaPasswordLegacy()).toBe(0);
    expect(dimenticaPasswordLegacy()).toBe(0);
    expect(localStorage.getItem("sws.saved-devices")).toBe("non-json");
  });
});

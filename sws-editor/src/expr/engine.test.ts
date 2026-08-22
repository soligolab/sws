import { describe, expect, it } from "vitest";
import { evalExpr, extractDeps, validateExpr } from "./engine";
import type { TagState } from "@/types";

const tags: Record<string, TagState> = {
  "tank.level": { value: 50, quality: "Good", timestamp_ms: 0 },
  "tank.cap":   { value: 200, quality: "Good", timestamp_ms: 0 },
  "temp":       { value: 85.5, quality: "Good", timestamp_ms: 0 },
  "run":        { value: true, quality: "Good", timestamp_ms: 0 },
  "mode":       { value: "auto", quality: "Good", timestamp_ms: 0 },
};

describe("expr engine", () => {
  it("aritmetica e riferimenti tag", () => {
    expect(evalExpr("{tank.level} * 100 / {tank.cap}", tags)).toBe(25);
    expect(evalExpr("2 + 3 * 4", tags)).toBe(14);
    expect(evalExpr("(2 + 3) * 4", tags)).toBe(20);
    expect(evalExpr("-{tank.level} + 10", tags)).toBe(-40);
    expect(evalExpr("7 % 4", tags)).toBe(3);
  });

  it("confronti, logica, ternario", () => {
    expect(evalExpr("{temp} > 80", tags)).toBe(true);
    expect(evalExpr("{temp} > 80 ? '#ef4444' : '#22c55e'", tags)).toBe("#ef4444");
    expect(evalExpr("{run} && {temp} > 80", tags)).toBe(true);
    expect(evalExpr("!{run}", tags)).toBe(false);
    expect(evalExpr("{mode} == 'auto'", tags)).toBe(true);
    expect(evalExpr("{tank.level} >= 50 && {tank.level} <= 60", tags)).toBe(true);
  });

  it("funzioni", () => {
    expect(evalExpr("min({tank.level}, 30)", tags)).toBe(30);
    expect(evalExpr("max(1, 2, 3)", tags)).toBe(3);
    expect(evalExpr("clamp(150, 0, 100)", tags)).toBe(100);
    expect(evalExpr("round(1.567, 2)", tags)).toBe(1.57);
    expect(evalExpr("abs(-4)", tags)).toBe(4);
    expect(evalExpr("if({run}, 'ON', 'OFF')", tags)).toBe("ON");
    expect(evalExpr("pow(2, 10)", tags)).toBe(1024);
  });

  it("tag mancante → null (il rendering tiene lo statico)", () => {
    expect(evalExpr("{non.esiste}", tags)).toBe(null);
  });

  it("extractDeps trova tutti i tag, una volta sola", () => {
    expect(extractDeps("{a} + {b} * {a}").sort()).toEqual(["a", "b"]);
    expect(extractDeps("clamp({x.y}, 0, {z})").sort()).toEqual(["x.y", "z"]);
    expect(extractDeps("sintassi ((( rotta")).toEqual([]);
  });

  it("validateExpr segnala gli errori con un messaggio", () => {
    expect(validateExpr("{a} + {b}")).toBe(null);
    expect(validateExpr("{a} +")).toMatch(/incompleta/);
    expect(validateExpr("{nonchiuso")).toMatch(/non chiuso/);
    expect(validateExpr("foo + 1")).toMatch(/sconosciuto/);
    expect(validateExpr("1 2")).toMatch(/eccesso/);
  });

  it("concatenazione stringhe con +", () => {
    expect(evalExpr("'val: ' + {tank.level}", tags)).toBe("val: 50");
  });
});

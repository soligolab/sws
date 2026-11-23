/** The `plx800_io` source (plan `docs/plans/2026-11-23-plx800-sws-e-modulo-io.md`):
 *  the point catalogue mirrors the Rust enum, «Add all points» declares each
 *  tag with its type and unit, and the card says whether the module is there
 *  on the connected device. */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { plx800Status, remotePlx800Status, statoSorgenti } = vi.hoisted(() => ({
  plx800Status: vi.fn(),
  remotePlx800Status: vi.fn(),
  statoSorgenti: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, plx800Status, remotePlx800Status, statoSorgenti } };
});

import { PLX800_POINTS, missingPoints, tagDefFor, writableWithoutWrites, emptyPlx800Io } from "../src/config/sourcePlx800";
import { Plx800IoSourceCard } from "../src/config/sorgenti/Plx800IoSourceCard";
import { deduciTipo } from "../src/tag/riconciliaTag";
import { sourceTagIds } from "../src/tagCatalog";
import { haDisponibilita } from "../src/config/sorgenti/disponibilita";
import { useAppStore } from "../src/store";
import type { Plx800IoSource, ProjectInfo, TagDef } from "../src/types";

beforeAll(async () => { await i18n.changeLanguage("it"); });
afterEach(() => { cleanup(); vi.clearAllMocks(); useAppStore.setState({ remoteConnected: false, remoteUrl: null } as never); });

const ok = { present: true, valid: true, cycle_us: 1000, fresh: true, last_ok: true, update_count: 5, fail_count: 0, writer_lock_busy: false };

describe("the point catalogue", () => {
  it("has the 61 points of the Rust enum, each once, with a label in both languages", () => {
    expect(PLX800_POINTS).toHaveLength(61);
    expect(new Set(PLX800_POINTS.map((p) => p.point)).size).toBe(61);
    for (const p of PLX800_POINTS) {
      for (const lng of ["it", "en"]) {
        expect(i18n.exists(`plx800.point.${p.point}`, { lng }), `${lng}: ${p.point}`).toBe(true);
      }
    }
  });

  it("only outputs, controllable LEDs, PoE, RUN LED mode and PWM are commandable", () => {
    const w = PLX800_POINTS.filter((p) => p.writable).map((p) => p.point);
    expect(w).toHaveLength(28);
    expect(w).toContain("out7");
    expect(w).toContain("poe_en");
    expect(w).not.toContain("in0");
    expect(w).not.toContain("led_operative_state");
    expect(w).not.toContain("board_temp_c");
  });

  it("«add all» maps the missing points on <source>.<point> with type and unit", () => {
    const s: Plx800IoSource = { ...emptyPlx800Io(), id: "io", points: [{ tag: "my.out0", point: "out0" }] };
    const m = missingPoints(s);
    expect(m).toHaveLength(60);
    expect(m.find((x) => x.point === "out0")).toBeUndefined();
    expect(m.find((x) => x.point === "vcap_mv")?.tag).toBe("io.vcap_mv");
    expect(tagDefFor("io.vcap_mv", "vcap_mv")).toMatchObject({ data_type: "u16", unit: "mV" });
    expect(tagDefFor("io.t", "board_temp_c")).toMatchObject({ data_type: "f64", unit: "°C" });
    expect(tagDefFor("io.in0", "in0").data_type).toBe("bool");
  });

  it("counts commandable points that a read-only source will never command", () => {
    const s: Plx800IoSource = { ...emptyPlx800Io(), points: [{ tag: "a", point: "out0" }, { tag: "b", point: "in0" }] };
    expect(writableWithoutWrites(s)).toBe(1);
    expect(writableWithoutWrites({ ...s, writes: true })).toBe(0);
  });

  it("the mapped tags are known to the catalogue, typed, and have availability", () => {
    const s: Plx800IoSource = { ...emptyPlx800Io(), id: "io", points: [{ tag: "io.t", point: "board_temp_c" }, { tag: "io.i3", point: "in3" }] };
    const project = { sources: [s] } as unknown as ProjectInfo;
    expect([...sourceTagIds(project).keys()]).toEqual(["io.t", "io.i3"]);
    expect(deduciTipo("io.i3", project, [])).toBe("bool");
    expect(deduciTipo("io.t", project, [])).toBe("f64");
    expect(haDisponibilita(s)).toBe(true);
  });
});

describe("the card", () => {
  const mount = (source: Plx800IoSource, onChange = vi.fn(), onCreateTag = vi.fn()) =>
    render(<Plx800IoSourceCard source={source} onChange={onChange} onDelete={() => {}} onCreateTag={onCreateTag} />);

  it("asks the connected device, not this machine", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://plx800.local:7444" } as never);
    remotePlx800Status.mockResolvedValue(ok);
    mount(emptyPlx800Io());
    await waitFor(() => expect(screen.getByTestId("plx800-status").textContent).toContain("plx800.local"));
    expect(screen.getByTestId("plx800-status").textContent).toContain("1000 µs");
    expect(plx800Status).not.toHaveBeenCalled();
  });

  it("a busy writer lock is a warning next to the green status", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://plx800.local:7444" } as never);
    remotePlx800Status.mockResolvedValue({ ...ok, writer_lock_busy: true });
    mount(emptyPlx800Io());
    const busy = await screen.findByTestId("plx800-lock-busy");
    expect(busy.style.color).toContain("--brand-warning-soft");
    expect(screen.getByTestId("plx800-status").style.color).toContain("--brand-success-soft");
  });

  it("says when the device has no module", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://wp630.local:7444" } as never);
    remotePlx800Status.mockResolvedValue({ ...ok, present: false, valid: false });
    mount(emptyPlx800Io());
    await waitFor(() => expect(screen.getByTestId("plx800-status").textContent).toMatch(/Nessun modulo I\/O PLX800 su https:\/\/wp630/));
  });

  it("says when the device runtime is too old to answer", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://tc620.local:7444" } as never);
    remotePlx800Status.mockRejectedValue(new Error("404"));
    plx800Status.mockResolvedValue({ ...ok, present: false });
    mount(emptyPlx800Io());
    await waitFor(() => expect(screen.getByTestId("plx800-status").textContent).toMatch(/anteriore al 23-11-2026/));
  });

  it("«add all» declares the tags and appends the mappings", async () => {
    plx800Status.mockResolvedValue(ok);
    const onChange = vi.fn();
    const onCreateTag = vi.fn();
    mount({ ...emptyPlx800Io(), id: "io" }, onChange, onCreateTag);
    fireEvent.click(screen.getByTestId("plx800-add-all"));
    expect(onCreateTag).toHaveBeenCalledTimes(61);
    const temp = onCreateTag.mock.calls.map((c) => c[0] as TagDef).find((d) => d.id === "io.board_temp_c");
    expect(temp).toMatchObject({ data_type: "f64", unit: "°C", description: "Temperatura della scheda" });
    expect(onChange.mock.calls[0][0].points).toHaveLength(61);
  });

  it("writes are off by default, and the note says which points stay read only", async () => {
    plx800Status.mockResolvedValue(ok);
    const onChange = vi.fn();
    mount({ ...emptyPlx800Io(), points: [{ tag: "io.out0", point: "out0" }] }, onChange);
    expect((screen.getByTestId("plx800-writes") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("plx800-read-only-note").textContent).toMatch(/1 punto comandabile resterà/);
    fireEvent.click(screen.getByTestId("plx800-writes"));
    expect(onChange.mock.calls[0][0].writes).toBe(true);
  });
});

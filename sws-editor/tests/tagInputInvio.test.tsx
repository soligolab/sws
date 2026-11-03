/** Il campo tag col testo già esatto (03-11-2026, tutorial T08): `livello` + Tab
 *  non deve diventare `livello_opcua`, il primo suggerimento. E i tag che il
 *  runtime scrive da sé per una sorgente non sono «nuovi». */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useState } from "react";
import "../src/i18n/index";
import { useAppStore } from "../src/store";
import { TagInput, eTagImplicito, statoTag } from "../src/components/TagInput";
import type { ProjectInfo } from "../src/types";

function Campo({ iniziale }: { iniziale: string }) {
  const [v, setV] = useState(iniziale);
  return <><TagInput value={v} onChange={setV} /><output data-testid="valore">{v}</output></>;
}

beforeEach(() => {
  useAppStore.setState({
    project: {
      tags: [
        { id: "livello", description: "", data_type: "i16" },
        { id: "livello_opcua", description: "", data_type: "i16" },
        { id: "livello_s7", description: "", data_type: "i16" },
      ],
      types: [], sources: [{ kind: "modbus_tcp", id: "openplc" }],
    } as unknown as ProjectInfo,
  });
});

describe("il campo tag col testo già esatto", () => {
  it("Tab e Invio tengono l'id scritto", () => {
    const { container, getByTestId } = render(<Campo iniziale="" />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "livello" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(getByTestId("valore").textContent).toBe("livello");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(getByTestId("valore").textContent).toBe("livello");
  });

  it("con la freccia giù si sceglie un suggerimento, come prima", () => {
    const { container, getByTestId } = render(<Campo iniziale="" />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "livello" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(getByTestId("valore").textContent).toBe("livello_opcua");
  });

  it("un prefisso che non è un tag prende ancora il primo suggerimento", () => {
    const { container, getByTestId } = render(<Campo iniziale="" />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "livello_s" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(getByTestId("valore").textContent).toBe("livello_s7");
  });
});

describe("i tag impliciti di una sorgente", () => {
  it("disponibile e diagnostica esistono senza essere dichiarati", () => {
    expect(eTagImplicito("openplc.disponibile", ["openplc"])).toBe(true);
    expect(eTagImplicito("openplc.diagnostics.timeouts", ["openplc"])).toBe(true);
    expect(eTagImplicito("openplc.altro", ["openplc"])).toBe(false);
    expect(statoTag("openplc.disponibile", new Set(), new Set(), [], ["openplc"])).toBe("dichiarato");
    expect(statoTag("openplc.disponibile", new Set(), new Set(), [], [])).toBe("nuovo");
  });
});

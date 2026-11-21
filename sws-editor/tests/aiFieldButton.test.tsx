import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n";
import { api } from "../src/api/client";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { svuotaCoda } from "../src/finestraAvviso/finestraAvviso";
import { AiFieldButton } from "../src/components/AiFieldButton";

/** The AI on one field (plan 2026-11-20-ia-sui-campi). */
describe("the AI on a field", () => {
  afterEach(() => { cleanup(); act(() => svuotaCoda()); vi.restoreAllMocks(); });

  const mount = (onApply: (c: Record<string, string>) => void) => render(<>
    <AiFieldButton kind="tag_expression" field="expression" label="λ" value="" entity={{ id: "ram_mb" }}
      liveValue={55044.44921875} tags={["host.ram"]}
      neighbours={[{ field: "unit", label: "Unit", value: "" }, { field: "decimals", label: "Decimals", value: "" }]}
      onApply={onApply} />
    <FinestraAvviso />
  </>);

  it("a question, its answer, then the proposal applied to every field", async () => {
    const ai = vi.spyOn(api, "aiField")
      .mockResolvedValueOnce({ ok: true, kind: "question", question: "kB o KiB?", choices: ["kB", "KiB"] })
      .mockResolvedValueOnce({ ok: true, kind: "proposal", note: "÷1000", changes: [
        { field: "expression", value: 'tags["host.ram"] / 1000' }, { field: "unit", value: "MB" }, { field: "decimals", value: "2" }] });
    const onApply = vi.fn();
    mount(onApply);
    fireEvent.click(screen.getByTestId("ai-field-expression"));
    fireEvent.change(await screen.findByTestId("ai-field-request"), { target: { value: "RAM in MB" } });
    await act(async () => { fireEvent.click(screen.getByTestId("ai-field-ask")); });
    expect(ai.mock.calls[0][0]).toMatchObject({
      kind: "tag_expression", allowed: ["expression", "unit", "decimals"], live_value: 55044.44921875, rounds: [] });
    await act(async () => { fireEvent.click(await screen.findByText("kB")); });
    expect(ai.mock.calls[1][0].rounds).toEqual([{ question: "kB o KiB?", answer: "kB" }]);
    expect(await screen.findByText("÷1000")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("ai-field-apply")); });
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ expression: 'tags["host.ram"] / 1000', unit: "MB", decimals: "2" }));
  });

  it("an error is said in the window, and nothing is applied", async () => {
    vi.spyOn(api, "aiField").mockResolvedValue({ ok: false, code: "no_model", message: "x" });
    const onApply = vi.fn();
    mount(onApply);
    fireEvent.click(screen.getByTestId("ai-field-expression"));
    fireEvent.change(await screen.findByTestId("ai-field-request"), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByTestId("ai-field-ask")); });
    expect(screen.getByTestId("ai-field-dialog").textContent).toMatch(/Configura/);
    expect(onApply).not.toHaveBeenCalled();
  });
});

/** Il selettore colore che scrive con calma (31-10-2026): trascinare il pallino
 *  manda un evento per pixel, e ognuno ridisegnava l'editor. Lo swatch segue
 *  subito, il progetto riceve l'ultimo colore al massimo ogni 100 ms. */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n";
import { CampoColore, SelettoreColore } from "../src/editor/CampoColore";

afterEach(() => vi.useRealTimers());

describe("CampoColore durante il trascinamento", () => {
  it("dieci eventi di fila: una scrittura sola, con l'ultimo colore", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = render(
      <CampoColore valore="#000000" regola={{ hex: "#808080" }} sfondo="#0f172a" onChange={onChange} />,
    );
    const selettore = container.querySelector('input[type="color"]') as HTMLInputElement;
    for (let i = 0; i < 10; i++) fireEvent.input(selettore, { target: { value: `#0000${(10 + i).toString(16).padStart(2, "0")}` } });
    expect(onChange).not.toHaveBeenCalled();
    expect(selettore.value).toBe("#000013");
    act(() => { vi.advanceTimersByTime(100); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("#000013");
  });

  it("smontato a metà, l'ultimo colore arriva lo stesso", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container, unmount } = render(
      <CampoColore valore="#000000" regola={{ hex: "#808080" }} sfondo="#0f172a" onChange={onChange} />,
    );
    fireEvent.input(container.querySelector('input[type="color"]')!, { target: { value: "#602a2a" } });
    unmount();
    expect(onChange).toHaveBeenCalledWith("#602a2a");
  });

  it("il selettore nudo delle righe di elenco ha lo stesso freno", () => {
    vi.useFakeTimers();
    const onColore = vi.fn();
    const { container } = render(<SelettoreColore value="#000000" onColore={onColore} title="zona" />);
    const selettore = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(selettore.title).toBe("zona");
    fireEvent.input(selettore, { target: { value: "#111111" } });
    fireEvent.input(selettore, { target: { value: "#222222" } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(onColore.mock.calls).toEqual([["#222222"]]);
  });
});

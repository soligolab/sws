import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Tenuta } from "../src/components/Tenuta";

/** Una scheda nascosta tiene il suo stato: prima, cambiare scheda smontava la
 *  bozza (una sorgente aggiunta e non salvata spariva). */
function Contatore() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>conta {n}</button>;
}

describe("Tenuta", () => {
  it("non monta finché non è attiva, poi nasconde senza smontare", () => {
    const { rerender } = render(<Tenuta attiva={false}><Contatore /></Tenuta>);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<Tenuta attiva={true}><Contatore /></Tenuta>);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("conta 2");

    rerender(<Tenuta attiva={false}><Contatore /></Tenuta>);
    const nascosto = screen.getByRole("button", { hidden: true });
    expect(nascosto.textContent).toBe("conta 2");
    expect((nascosto.parentElement as HTMLElement).style.display).toBe("none");

    rerender(<Tenuta attiva={true}><Contatore /></Tenuta>);
    expect(screen.getByRole("button").textContent).toBe("conta 2");
    expect((screen.getByRole("button").parentElement as HTMLElement).style.display).toBe("contents");
  });
});

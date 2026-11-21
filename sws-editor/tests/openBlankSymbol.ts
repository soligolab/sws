// «+ New symbol» asks the name and the size first (21-11-2026): the tests answer
// it and get the editor open on the empty symbol, as before.
import { act } from "@testing-library/react";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";
import { openNewSymbol } from "../src/symbols/editor/open";

export async function openBlankSymbol(name = "New symbol", w = 100, h = 100): Promise<void> {
  const auto = rispondi({ name, w, h });
  try {
    await act(async () => { await openNewSymbol(); });
  } finally {
    auto.ferma();
  }
}

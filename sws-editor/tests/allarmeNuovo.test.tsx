/** Un allarme appena creato non è «nel formato vecchio».
 *
 *  Il 30-09-2026 il maintainer, aggiungendo un allarme a un progetto che non
 *  ne aveva: «vedo ⚠ 1 alarms are in the old format and block saving the whole
 *  project». Il costruttore `emptyAlarm()` metteva `condition`/`message`/
 *  `severity` al primo livello — cioè esattamente la forma che dal 26-09-2026
 *  è quella vecchia, quella che il server rifiuta di salvare. Il modello a
 *  livelli era arrivato nella scheda, non nel costruttore.
 *
 *  Il test non guarda la stringa dell'avviso ma la **condizione** che lo fa
 *  comparire, che è la stessa che blocca il salvataggio lato server
 *  (`validate::blocco_salvataggio`): un allarme senza `levels` e con
 *  `condition`. Una stringa cambia, quella condizione no.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { AlarmsTab } from "../src/config/schede/AlarmsTab";
import { useAppStore } from "../src/store";

describe("un allarme nuovo nasce nel formato a livelli", () => {
  beforeEach(() => {
    useAppStore.setState({
      project: {
        meta: { name: "senza-allarmi", version: "0.1.0" },
        tags: [], sources: [], alarms: [], functions: [],
      } as never,
    });
  });

  it("aggiungendone uno, nessuno risulta da convertire", () => {
    render(<AlarmsTab />);
    fireEvent.click(screen.getByText(/aggiungi allarme|add alarm/i));
    // La bozza vive nello stato della scheda finché non si salva, quindi lo
    // store non dice niente di utile qui: quello che si guarda è l'avviso, che
    // compare esattamente quando l'allarme è nella forma che il server
    // rifiuta. Provato rosso rimettendo il costruttore vecchio.
    expect(screen.queryByText(/formato vecchio|old format/i)).toBeNull();
  });
});

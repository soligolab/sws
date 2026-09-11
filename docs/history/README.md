# docs/history — quello che è stato, spostato intero

Qui finiscono le parti **storiche** dei documenti vivi, quando la loro mole comincia a nascondere
quello che è ancora attuale. Niente viene riassunto né cancellato: si sposta il testo intero, e nel
documento d'origine resta un indice o una riga di rimando.

| File | Da dove viene | Quando |
|---|---|---|
| `OPEN_QUESTIONS-chiuse.md` | `docs/OPEN_QUESTIONS.md` — le schede decise, realizzate e **verificate sul codice** il giorno dell'archiviazione | 2026-09-06 |
| `STATUS-2026-07_08.md` | `STATUS.md` — le sessioni di luglio e agosto 2026, mergiate e verificate | 2026-09-06 |

`check_documenti.sh` verifica che lo spostamento non abbia perso niente: numeri delle schede senza
buchi né doppioni fra vivo e archivio, rimandi che risolvono, timbri di verifica presenti.

**Non è [`docs/archive/`](../archive/README.md)**: lì stanno documenti **interi** che hanno
finito il loro lavoro — i piani conclusi o superati, spostati da `docs/plans/` l'11-09-2026, più
l'indice della vecchia linea git dell'ufficio. Qui stanno **pezzi** asportati dai documenti
canonici vivi, e ogni pezzo ha un rimando che `check_documenti.sh` verifica. E non è `docs/adr/`: una decisione che merita di essere
citata per anni si promuove ad ADR, come fu per Q4 → `adr/0001-state-management.md`.

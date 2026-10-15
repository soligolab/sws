# Ruolo di questo template

**Banco di prova di una feature** — i comandi: le modalità del bottone, i simboli che comandano e le
assegnazioni.

- **Tipo di risorsa**: il quadro di comando di una pompa (marcia, prova, velocità, valvola di mandata).
- **Caso d'uso**: la pompa del pozzo di casa, comandata dal pannello accanto al quadro.

## Cosa mostra

- **Bottoni, una modalità ciascuno**: commuta (marcia/arresto), momentaneo (prova: scrive alla
  pressione e al rilascio), incremento e decremento con passo e limiti (velocità), reset (velocità
  a zero).
- **Simboli che comandano** (`command_tag`): l'interruttore e la valvola commutano, la pulsantiera è
  momentanea. Il disegno è il pulsante, e la leva segue la variabile che comanda. La pompa accanto
  **non** comanda: mostra solo lo stato, ed è il caso di sempre.
- **Assegnazioni**: «Spento», «Manuale» e «Automatico» scrivono più variabili con un tocco; il faro
  ferma tutto, dopo una conferma.

Tutte le variabili sono **interne**: il template si prova senza nessun impianto. Per usarlo davvero
si legano a un dispositivo — `pompa.marcia` e `pompa.prova` alle uscite del PLC o del relè,
`pompa.velocita` all'inverter.

## Il metro con cui giudicarlo

Il punto è **il comando**, non l'impianto: una pagina, poche variabili, ogni modo di scrivere una
volta sola e con il suo nome sotto. Non va giudicato col metro dell'inventario né con quello di
un'applicazione realistica.

_Nato il 14-10-2026 col piano `docs/plans/2026-10-14-strumenti-simboli-comandi.md` (ramo 2)._

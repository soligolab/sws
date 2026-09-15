# Ruolo di questo template

**Banco di prova di una feature** — non un protocollo (nessuna sorgente esterna, tutto
pilotato da tag in-memory) e non un'applicazione realistica: mostra a fondo una sola capacità
del motore, il grid layout S-23.

## Il metro con cui giudicarlo

Il punto è **la profondità della feature**, non l'ampiezza della copertura tipi né il realismo
dello scenario: deve esercitare a fondo il grid layout — merge (rowspan/colspan), sub-celle
annidate fino al livello che il motore ammette, un mix di tipi diversi come figli di cella,
righelli/gruppi/lock dell'editor. L'assenza di sorgenti dati esterne è corretta così, non un
difetto da colmare.

Non giudicarlo con il metro di un banco di prova di protocollo (qui non c'è un protocollo da
dimostrare) né con quello di un'applicazione realistica (non deve somigliare a un impianto
vero): il metro è "quanto a fondo mette alla prova il grid layout", non altro.

_Revisione template, 2026-09-15 (`docs/plans/2026-09-14-revisione-template.md`, passo 2)._

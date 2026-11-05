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

## Cosa c'è dentro

- **Griglia 4×4** — la griglia con le celle unite (il trend su due colonne), le sotto-celle
  annidate fino al quarto livello e tipi diversi come figli di cella. I bottoni della griglia usano
  i modi del bottone: `increment`/`decrement` sul contatore (passo 1, entro 0–100) e `toggle`
  sulla pompa. A destra, una barra fuori dalla griglia che segue il cursore di opacità della
  cella in basso a destra, e l'allarme del contatore sopra 80.
- **Controlli** — cinque bottoni che scrivono il colore del riquadro in cella (1,3), due preset
  del contatore per accendere e spegnere l'allarme, e due suggerimenti per provare l'editor.

Le due pagine stanno in una cornice (`cornici/cornice.yaml`): nome della pagina, lingua e
data/ora in testata, il navigatore delle pagine nel piede. Ogni comando si usa col ruolo
Viewer, senza accedere, e funziona uguale sul pannello LVGL.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._

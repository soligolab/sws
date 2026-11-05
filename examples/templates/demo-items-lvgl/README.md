# Ruolo di questo template

**Inventario.** Gemello di [`demo-items-web`](../demo-items-web/README.md): stesse pagine,
stessi id, stesse coordinate — un oggetto per ciascuno dei tipi che il motore LVGL disegna, che dal
27-08-2026 sono tutti quelli della palette.

## Il metro con cui giudicarlo

Deve contenere **tutti** i tipi che LVGL sa disegnare, non i più rappresentativi.

Ogni differenza rispetto al gemello web è un difetto di **parità fra motori**, non una scelta
di design di questo template — `check_demo_templates.sh` verifica che i due restino
sincronizzati (stessi nomi pagina, stesse dimensioni, stesse coordinate oggetto per oggetto).

Non giudicarlo per realismo o eleganza: non deve somigliare a un impianto vero, deve mostrare
ogni pezzo della palette LVGL in un posto verificabile, confrontabile a colpo d'occhio col
motore web sulla stessa pagina.

## Cornice, comandi e faceplate (04-11-2026, regole R6–R8)

- **Cornice** (`cornici/cornice.yaml`): la testata con il nome della pagina e la data con l'ora, il piede con un
  bottone per pagina, nell'ordine di `page_tree`. Prima ogni pagina si disegnava da sé la testata e quattro
  `navbutton`. Il contenuto sta fra le due fasce, da y 56 a 740; la finestra della pompa non ha cornice.
- **Comandi a Viewer**: i sei tag `demo.cmd.*` hanno `write_min_role: Viewer`, quindi bottone, checkbox, radio,
  setpoint e cursori si provano senza accedere. Restano a Operator, perché li tiene lì il runtime, la conferma di
  un allarme e l'applicazione di una ricetta.
- **`navbutton` e `page_navigator`** restano anche dentro una pagina, in fondo a «Grafici e tabelle»: la
  copertura dei tipi la legge `check_demo_templates.sh` dai sinottici, e quelli della cornice non contano.
- **Faceplate**: in «Allarmi e composizione» c'è `motor_basic`, di sistema, e accanto `riquadro_valore`, del
  progetto (`faceplates/`), con due istanze. La seconda non dà il colore e prende il predefinito: è la prova
  che i due motori sostituiscono i parametri in ogni campo e applicano i predefiniti.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._

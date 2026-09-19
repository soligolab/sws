# Gli screenshot del manuale sono anteriori a T-52

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **pronto** (lavoro noto, nessuna decisione).

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## Cosa c'è

`docs/manual/` è completo (15 capitoli + MAIN) ma `docs/manual/screenshots/` è anteriore a **T-52** (il limite
della pagina, il pannello proprietà a gruppi): le schermate mostrano un IDE che non è più quello. Il capitolo 04
guadagna con T-72 la sezione «Immagini di boot», senza nessuna schermata.

## Cosa serve

Rifare le schermate del capitolo 04 (elenco pagine con la sezione «Immagini di boot», pannello di una pagina di
boot con anteprima del PNG, palette ridotta) e, se si vuole, le altre. **Strumento già provato il 19-09-2026**:
Chromium headless con Playwright (`playwright-core` in `~/openplc-editor/node_modules`, browser
`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` passato
come `executablePath`) contro un'istanza IDE di scarto (`start_editor.sh --instance 13` con `SWS_PROJECTS_ROOT`
isolata, da fermare a fine prova). Le schermate vanno riprese a una risoluzione fissa e con un progetto pulito,
perché quelle esistenti vengano sostituite in blocco e non a pezzi.


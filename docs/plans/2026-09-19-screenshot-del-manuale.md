# Il manuale, testo e schermate, da rifare a progetto stabilizzato

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **rimandato** — il maintainer (20-09-2026): «credo serva rifare tutti gli screenshot e aggiornare anche il manuale, negli ultimi mesi il progetto è stato stravolto. Però farei questa attività in futuro a progetto stabilizzato».

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## Cosa c'è

`docs/manual/` è completo (15 capitoli + MAIN) ma `docs/manual/screenshots/` è anteriore a **T-52** (il limite
della pagina, il pannello proprietà a gruppi): le schermate mostrano un IDE che non è più quello. Il capitolo 04
guadagna con T-72 la sezione «Immagini di boot», senza nessuna schermata.

## Cosa è stato fatto il 20-09-2026 (un tampone, non il lavoro)

- Le dieci schermate di `docs/manual/screenshots/` sono state **rigenerate** con il generatore che già c'era
  (`./scripts/check_e2e.sh --screenshots`, che era rotto e ora funziona) contro un runtime di scarto con il template
  `demo-items-web`, e ne è stata aggiunta una, `11_immagine_di_boot.png`, citata nel capitolo 04. Mostrano l'IDE di
  oggi, ma sono **le stesse dieci inquadrature di giugno**: nessuna scelta di cosa mostrare è stata rifatta.
- Il **testo** del manuale non è stato riverificato: descrive un IDE che nel frattempo ha cambiato pannello
  proprietà (T-52 e il raggruppamento in schede), sezioni di Configurazione, multilingua di progetto (asse
  contenuti e asse interfaccia), immagini di boot, formato predefinito, assistente IA, il viewer LVGL a 35 tipi.
- Trovato guardando le schermate: il falso avviso «il progetto sul runtime è cambiato» dopo ogni accesso (corretto).

## Cosa serve, quando si riprende

1. **Aspettare che il progetto si sia stabilizzato**: rifare il manuale mentre cambia vuol dire rifarlo due volte.
2. **Rileggere ogni capitolo contro il codice**, non contro la memoria: `docs/manual/` ha 15 capitoli + MAIN, e
   `docs/CONTEXT.md` §3 dice già che una descrizione scritta a giugno era invecchiata a settembre.
3. **Decidere l'inquadratura di ogni schermata** prima di scattarla (oggi sono dieci, molte non citate dal testo:
   `04_runtime_mode`, `05_config_view`, `06_alarms_tab` e `07_viewer_8443` non sono referenziate da nessun capitolo).
4. Rifare le schermate.

## Lo strumento, già provato

Il generatore è `sws-editor/e2e/screenshots.spec.ts`, lanciato da `./scripts/check_e2e.sh --screenshots`: avvia da
solo un runtime di scarto (porte 8663/8664, progetto `e2e` dal template `demo-items-web`, utente admin/admin), gira
in circa un minuto e scrive in `docs/manual/screenshots/`. Serve prima `pnpm --dir sws-editor build` e
`cargo build -p sws-runtime`. Le viste che richiedono uno stato speciale si preparano dentro il test (l'esempio:
il test 11 scrive una pagina di boot dal server prima di scattare). Per riprese ad hoc fuori dalla suite: Chromium
headless con `playwright-core` (`~/openplc-editor/node_modules`) e il browser in
`~/.cache/ms-playwright/chromium_headless_shell-1243/…`, passato come `executablePath`.

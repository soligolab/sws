# Multilingua: rivedere le traduzioni inglesi e collaudare l'IDE in inglese

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **verifica**.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## Cosa c'è

Il 19-09-2026 (chiusura del piano `docs/archive/2026-09-18-multilingua-chiusura.md`, F6-F9) tutta l'interfaccia
dell'IDE è passata dal catalogo. Le circa **400 voci inglesi nuove le ha scritte Claude**, in fretta, per
decisione del maintainer («l'importante è che tutte le stringhe siano su file di lingua»): non sono state
riviste da nessuno. Le chiavi di `ConfigView` (`cfgUi.*`) sono state **generate dal testo inglese** da uno
strumento di riscrittura (non nel repo), quindi il loro nome dice l'inglese, non la funzione.

## Cosa non è stato verificato

- **Nessuno ha guardato l'IDE in inglese**: `ConfigView` e i paragrafi con `<Trans>` per primi (ventisei
  paragrafi con `<strong>`/`<em>`/`<code>` dentro, dove l'ordine delle frasi conta).
- **Il limite della guardia** `check_i18n_ui.sh`: è un'euristica, non vede il testo JSX attaccato a una
  `{espressione}` né le parole italiane sole senza accento o parola-chiave. Qualche scritta italiana può essere
  rimasta e `--elenca` non la mostra.
- Il collaudo complessivo che chiude il capitolo: UI in EN senza una parola italiana in nessuna scheda né
  dialogo; viewer con contenuti in `de` che mostra «Zeit»; traduzione automatica verso `de`; email in `de` e
  Telegram in `es`; la chiave Google che sopravvive al ricaricamento. I timbri di Q43 e Q57 li mette il
  maintainer.

## Nota

Il nome del CSV di storico esportato è cambiato da `<id>-storico.csv` a `<id>-history.csv`.


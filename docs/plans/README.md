# I piani vivi — indice e stato

> Qui stanno i piani **ancora in gioco**: non finiti, o finiti a metà, o che sono vincoli
> riusabili invece che lavoro da fare. Quelli conclusi o superati sono stati spostati in
> [`docs/archive/`](../archive/README.md) l'11-09-2026, che ne tiene l'indice e l'evidenza.
>
> Un piano finito non si cancella: resta come **referto** — dice perché le cose sono fatte come
> sono fatte. C'è un precedente di cancellazione (`CHANGELOG` §2026.7.0: piani di lavoro già
> implementato, «recuperabili da git history»): vale solo per i piani mai iniziati e ormai falsi.
>
> **Nota sui percorsi**: fino all'11-09-2026 la regola era «i file di questa cartella non si
> spostano», perché citati da altri documenti e dal codice. Lo spostamento in archivio ha
> riscritto tutti e 33 i riferimenti; un `git log --follow` continua a seguirli.

| Piano | Stato | Cosa resta |
|---|---|---|
| [2026-08-06-audit-widget-e-codice.md](2026-08-06-audit-widget-e-codice.md) | **MEZZO VIVO** | referto di audit, mai trasformato in lavoro. Delle quattro domande, due sono state risolte altrove (color picker per `slider`/`checkbox`/`radio`, `faceplate` nella palette) e **due sono ancora aperte, qui e in nessun altro posto**: il binding sui campi di `pipe` (verificato l'11-09-2026: zero `BindableInput`) e il disallineamento fra `alarm_banner` (mostra anche i `normal_unacked`) e `alarm_bell`/`alarm_viewer` (filtrano su `active`) |
| [2026-08-21-scada-widgets.md](2026-08-21-scada-widgets.md) | **PARZIALE** | F0-F8 in 2.1.0; aperti F5.3x (XY multi-coppia) e i residui di parità in STATUS «da fare» |
| [2026-08-31-chat-ai-nelleditor.md](2026-08-31-chat-ai-nelleditor.md) | **PARZIALE — vivo** | sostituito in parte dal piano T-50 (archiviato); i passi 3-6 e la chat staccata restano da fare |
| [2026-09-03-via-di-fuga-stop-pixsys.md](2026-09-03-via-di-fuga-stop-pixsys.md) | **NON È UN PIANO** | vincoli riusabili per un altro progetto; rimanda a TEST_SETUPS e Q25 |
| [2026-09-10-T56-pannelli-editor.md](2026-09-10-T56-pannelli-editor.md) | **DA FARE** | T-56, mai iniziato: i due pannelli dell'editor |
| [2026-09-11-utenti-nel-progetto.md](2026-09-11-utenti-nel-progetto.md) | **REALIZZATO, NON CHIUSO** | i sei passi sono fatti sul ramo `feat/utenti-nel-progetto`; mancano il collaudo del maintainer e il merge |

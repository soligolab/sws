# I piani — indice e stato

> I file di questa cartella **non si spostano e non si rinominano**: sono citati da altri
> documenti e da commenti nel codice (31 riferimenti contati il 2026-09-06). Un piano finito
> resta qui come **referto** — dice perché le cose sono fatte come sono fatte — con una riga
> di stato in testa.
>
> C'è un precedente di cancellazione (`CHANGELOG` §2026.7.0: piani di lavoro già implementato,
> «recuperabili da git history»): si applica solo ai piani mai iniziati e ormai falsi.

| Piano | Stato | Evidenza |
|---|---|---|
| [2026-07-30-ripresa-deploy-db-gestione-db-multiselect.md](2026-07-30-ripresa-deploy-db-gestione-db-multiselect.md) | **FATTO** | deploy-preserve, gestione database e multiselect drag tutti in CHANGELOG §2026.7-2.0; `check_multiselect_drag.sh` esiste |
| [2026-07-31-installa-da-registry.md](2026-07-31-installa-da-registry.md) | **FATTO** | sezione dedicata nello storico di STATUS (2026-07-31) |
| [2026-08-06-audit-widget-e-codice.md](2026-08-06-audit-widget-e-codice.md) | **MAI INIZIATO** | il referto fu scritto, le proposte dichiarate «non implementate» in STATUS |
| [2026-08-06-piano-allarmi-datatable-trend.md](2026-08-06-piano-allarmi-datatable-trend.md) | **FATTO** | T-41…T-48 chiusi (storico di STATUS, CHANGELOG 2.1.x) |
| [2026-08-07-lvgl-engine.md](2026-08-07-lvgl-engine.md) | **FATTO** | fasi 1-3 del motore LVGL nello storico di STATUS; CHANGELOG 2.0.0 |
| [2026-08-21-scada-widgets.md](2026-08-21-scada-widgets.md) | **PARZIALE** | F0-F8 in 2.1.0; aperti F5.3x (XY multi-coppia) e i residui di parità in STATUS «da fare» |
| [2026-08-23-editor-coerente.md](2026-08-23-editor-coerente.md) | **FATTO** | voce «Editor coerente» nella 2.1.0 |
| [2026-08-23-navigate-f7-f8.md](2026-08-23-navigate-f7-f8.md) | **FATTO** | lotti 0-4 dichiarati fatti nel piano stesso; residuo minore (ACK nell'AlarmEvent) in STATUS «da fare» §5 |
| [2026-08-24-template-demo-items.md](2026-08-24-template-demo-items.md) | **FATTO** | i gemelli demo-items-web/-lvgl esistono e sono guardati da check_demo_templates.sh |
| [2026-08-25-chiusura-domande-aperte.md](2026-08-25-chiusura-domande-aperte.md) | **FATTO (come processo)** | le sei decisioni furono prese e oggi sono tutte realizzate e archiviate (Q15-Q22 verificate il 2026-09-06); il piano lasciò le code «not yet» non aggiornate, difetto sanato dalla revisione |
| [2026-08-31-chat-ai-nelleditor.md](2026-08-31-chat-ai-nelleditor.md) | **PARZIALE — vivo** | sostituito in parte dal piano T-50; i passi 3-6 e la chat staccata restano da fare |
| [2026-08-31-T50-chat-ai-esecutivo.md](2026-08-31-T50-chat-ai-esecutivo.md) | **FATTO** | T-50 mergiato in main; resta la prova col modello vero e la finestra staccata |
| [2026-08-31-trasloco-frodo.md](2026-08-31-trasloco-frodo.md) | **FATTO** | è il referto del trasloco, citato dallo storico di STATUS |
| [2026-09-01-editor-runtime.md](2026-09-01-editor-runtime.md) | **FATTO** | mergiato (e98138b), release 2.4.0, ADR 0003; l'appendice sulla chat staccata resta il disegno di riferimento |
| [2026-09-02-session-start.md](2026-09-02-session-start.md) | **FATTO** | scripts/session_start.sh esiste, guardato da check_session_start.sh |
| [2026-09-03-via-di-fuga-stop-pixsys.md](2026-09-03-via-di-fuga-stop-pixsys.md) | **NON È UN PIANO** | vincoli riusabili per un altro progetto; rimanda a TEST_SETUPS e Q25 |
| [2026-09-04-limite-pagina-morbido.md](2026-09-04-limite-pagina-morbido.md) | **FATTO** | T-52 mergiato in main (27f19ac) il 2026-09-05 |
| [2026-09-05-T-52-sessioni-B-E.md](2026-09-05-T-52-sessioni-B-E.md) | **FATTO** | stesso merge; contiene le nove correzioni al piano del 04 |
| [2026-09-06-revisione-documenti.md](2026-09-06-revisione-documenti.md) | **IN CORSO** | questa revisione |
| [global-scripts-template-snippets.md](global-scripts-template-snippets.md) | **MAI INIZIATO — stantio** | senza data; il file bersaglio GlobalScriptsTab.tsx non esiste (gli script globali vivono in ConfigView) |

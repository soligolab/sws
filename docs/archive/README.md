# docs/archive — i piani conclusi, e gli appunti di sessione

Qui finiscono i piani **finiti o superati**, spostati da [`docs/plans/`](../plans/README.md)
l'11-09-2026 perché la cartella viva tornasse a dire solo ciò che è ancora in gioco. Nessuno è
stato riassunto o cancellato: il testo è integrale, e ognuno resta un **referto** — dice perché
le cose sono fatte come sono fatte. Tutti i riferimenti che li citavano (33, in CHANGELOG,
STATUS, `docs/`, e in `sws-runtime/.cargo/audit.toml`) sono stati riscritti nello stesso commit.

Un piano **superato** non è uguale a uno finito: il lavoro non è stato fatto, ma il documento non
descrive più il codice. Sta qui lo stesso, con l'errore dichiarato — è l'unico modo perché non
venga riletto come vero.

| Piano | Stato | Evidenza |
|---|---|---|
| [2026-07-30-ripresa-deploy-db-gestione-db-multiselect.md](2026-07-30-ripresa-deploy-db-gestione-db-multiselect.md) | **FATTO** | deploy-preserve, gestione database e multiselect drag in CHANGELOG §2026.7-2.0; `check_multiselect_drag.sh` esiste |
| [2026-07-31-installa-da-registry.md](2026-07-31-installa-da-registry.md) | **FATTO** | sezione dedicata nello storico di STATUS (2026-07-31) |
| [2026-08-06-audit-widget-e-codice.md](2026-08-06-audit-widget-e-codice.md) | **CHIUSO l'11-09-2026** | referto d'audit mai trasformato in lavoro: riverificato sezione per sezione, sei delle sette erano già chiuse dal lavoro ordinario, la settima (quali allarmi contano) è stata decisa dal maintainer e fatta. Vedi «Esito» in coda al file |
| [2026-08-06-piano-allarmi-datatable-trend.md](2026-08-06-piano-allarmi-datatable-trend.md) | **FATTO** | T-41…T-48 chiusi (storico di STATUS, CHANGELOG 2.1.x) |
| [2026-08-07-lvgl-engine.md](2026-08-07-lvgl-engine.md) | **FATTO** | fasi 1-3 del motore LVGL nello storico di STATUS; CHANGELOG 2.0.0; ADR 0002 |
| [2026-08-23-editor-coerente.md](2026-08-23-editor-coerente.md) | **FATTO** | voce «Editor coerente» nella 2.1.0 |
| [2026-08-23-navigate-f7-f8.md](2026-08-23-navigate-f7-f8.md) | **FATTO** | lotti 0-4 dichiarati fatti nel piano stesso; residuo minore (ACK nell'AlarmEvent) in STATUS «da fare» |
| [2026-08-24-template-demo-items.md](2026-08-24-template-demo-items.md) | **FATTO** | i gemelli demo-items-web/-lvgl esistono, guardati da `check_demo_templates.sh` |
| [2026-08-25-chiusura-domande-aperte.md](2026-08-25-chiusura-domande-aperte.md) | **FATTO (come processo)** | le sei decisioni furono prese e sono realizzate e archiviate (Q15-Q22 verificate il 2026-09-06) |
| [2026-08-31-T50-chat-ai-esecutivo.md](2026-08-31-T50-chat-ai-esecutivo.md) | **FATTO** | T-50 mergiato in main; i residui (prova col modello vero, finestra staccata) vivono nel piano `2026-08-31-chat-ai-nelleditor.md`, rimasto vivo |
| [2026-08-31-trasloco-frodo.md](2026-08-31-trasloco-frodo.md) | **FATTO** | è il referto del trasloco, citato da `docs/TEST_SETUPS.md` |
| [2026-09-01-editor-runtime.md](2026-09-01-editor-runtime.md) | **FATTO** | mergiato (`e98138b`), release 2.4.0, ADR 0003; l'appendice sulla chat staccata resta il disegno di riferimento |
| [2026-09-02-session-start.md](2026-09-02-session-start.md) | **FATTO** | `scripts/session_start.sh` esiste, guardato da `check_session_start.sh` |
| [2026-09-03-via-di-fuga-stop-pixsys.md](2026-09-03-via-di-fuga-stop-pixsys.md) | **CHIUSO l'11-09-2026** | vincoli riusabili per un secondo progetto, non lavoro da fare: tutti e undici erano già rispettati in SWS, mancava chi se ne accorgesse se smettessero. Ora li difendono `check_via_di_fuga.sh` (1-7, 11), quattro test in `display_target.rs` (8) e `check_systemd_units.sh` (9-10). Vedi «Esito» |
| [2026-09-04-limite-pagina-morbido.md](2026-09-04-limite-pagina-morbido.md) | **FATTO** | T-52 mergiato in main (`27f19ac`) il 2026-09-05 |
| [2026-09-05-T-52-sessioni-B-E.md](2026-09-05-T-52-sessioni-B-E.md) | **FATTO** | stesso merge; contiene le nove correzioni al piano del 04 |
| [2026-09-06-revisione-documenti.md](2026-09-06-revisione-documenti.md) | **FATTO** | tutti i file dichiarati esistono: `docs/history/` con i due estratti e il suo README, `check_documenti.sh`, i due indici |
| [2026-09-09-q51-q52-installa-guidata.md](2026-09-09-q51-q52-installa-guidata.md) | **FATTO** | Q51+Q52 mergiate e rilasciate nella 2.7.2 |
| [2026-09-09-revisione-pre-2.7.0.md](2026-09-09-revisione-pre-2.7.0.md) | **FATTO** | referto della revisione; le decisioni che lasciava aperte sono Q46-Q49; citato da `sws-runtime/.cargo/audit.toml` |
| [2026-09-11-tracce-howto.md](2026-09-11-tracce-howto.md) | **PARZIALE** | i capitoli dell'HOWTO diventano tracce (T-58…T-67, fatto) e T-58 è realizzato; **T-59 resta da fare**, e la decisione presa qui — chiedere il referto al motore vero — è la parte che serve a chi lo riprende |
| [2026-09-11-T53-waypoint-sul-canvas.md](2026-09-11-T53-waypoint-sul-canvas.md) | **FATTO** | T-53: i waypoint del percorso di movimento si trascinano sul canvas. Confermato dal maintainer l'11-09-2026; due difetti trovati al primo uso e corretti, uno dei quali più vecchio di T-53 |
| [2026-09-11-diagnosi-login-8444.md](2026-09-11-diagnosi-login-8444.md) | **SUPERATO — diagnosi sbagliata** | l'ipotesi «credenziali confuse» non reggeva: era un bug (`senza_utenti` sondava una rotta assente su `--no-admin`), corretto in T-57. Le due affermazioni su seed e deploy di `users.yaml` sono errate — vedi la sezione «Esito» in coda al file |
| [global-scripts-template-snippets.md](global-scripts-template-snippets.md) | **SUPERATO — mai iniziato** | senza data (giugno 2026); il file bersaglio `GlobalScriptsTab.tsx` non esiste: gli script globali vivono in `ConfigView` |

## Non solo piani

| File | Cos'è |
|---|---|
| [office-line-2026-05-21.md](office-line-2026-05-21.md) | l'indice leggibile della linea git dell'ufficio (2026-05-10 → 05-21), abbandonata quando si adottò la linea di casa come `main` |

**Non è `docs/history/`**: lì stanno i *pezzi* asportati dai documenti canonici vivi
(`OPEN_QUESTIONS`, `STATUS`), che `check_documenti.sh` verifica scheda per scheda. Qui stanno
documenti interi che hanno finito il loro lavoro.

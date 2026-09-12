# Q46 — Verificare dal vivo la restrizione di `browse-dirs`/`mkdir` alla radice progetti

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q46) il 2026-09-12, aperta il 2026-09-09, **decisa e
> realizzata lo stesso giorno**. Non un piano di codice: manca solo la conferma del maintainer
> prima di archiviare la scheda.

## Cosa è già fatto, dal testo della scheda

`--projects-root`/`SWS_PROJECTS_ROOT` (default `~/sws_projects`, fuori dal repo) limita
`browse-dirs`, `mkdir` e `parent_path` a non uscire dalla radice — confronto dopo
`canonicalize`, anche contro i link simbolici. `start_runtime.sh`/`start_editor.sh` onorano
`SWS_PROJECTS_ROOT` se impostata.

## Cosa manca

Solo la conferma del maintainer che il comportamento sia quello atteso, prima di spostare la
scheda nell'archivio delle chiuse. Non richiede altro lavoro di sviluppo.

## Come verificarlo, se serve una traccia concreta

1. Avviare un runtime con `SWS_PROJECTS_ROOT` puntato a una cartella di prova.
2. Dalla WelcomeScreen, provare a navigare (`browse-dirs`) fuori da quella radice — deve
   fermarsi alla radice, non mostrare il resto del disco.
3. Provare `POST /api/projects` con un `parent_path` che tenta di uscire (es. `../../etc`) —
   deve essere rifiutato.
4. Provare con un link simbolico che punta fuori dalla radice — deve essere rifiutato anche
   quello (`canonicalize` prima del confronto).

## Esito

Se la verifica conferma, spostare Q46 nell'archivio chiuse (`docs/history/OPEN_QUESTIONS-chiuse.md`)
— è il maintainer a farlo o a dare il via libera, non questa sessione (regola di `CLAUDE.md`:
non risolvere/chiudere domande da soli).

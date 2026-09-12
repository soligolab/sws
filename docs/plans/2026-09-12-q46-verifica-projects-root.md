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

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q46 — `/api/fs/browse-dirs` e `/api/fs/mkdir` rispondono senza autenticazione

*Aperta il 2026-09-09 dalla revisione pre-2.7.0 (`docs/archive/2026-09-09-revisione-pre-2.7.0.md`). Nessuna decisione presa.*

**Context.** Sul router completo (porta admin dello stack di sviluppo e dell'IDE) le due rotte
sono **pre-auth**: elencano le sottodirectory di **qualunque** percorso assoluto del server e
ne creano di nuove. Il codice lo dichiara e lo giustifica — la WelcomeScreen sceglie dove
salvare il primo progetto prima che esista una sessione, e `POST /api/projects` con
`parent_path` fa già `create_dir_all`. Sul dispositivo (`--no-admin`) non ci sono.
Resta che un runtime di sviluppo raggiungibile in rete espone la struttura del filesystem a
chiunque, e Q44 (hosting) lo renderebbe un problema vero.

**Options.**
1. Restringere a una **radice**: la home dell'utente del processo, o l'antenato di
   `projects_root`. La WelcomeScreen continua a funzionare; il resto del disco no.
2. Metterle dietro `optional_auth` con ruolo Admin quando esistono utenti: in modalità
   senza utenti non cambia niente, con utenti serve una sessione (e la WelcomeScreen
   dovrebbe fare login prima di creare il primo progetto).
3. Lasciare com'è, dichiarandolo nel modello di minaccia: «l'IDE gira su una macchina
   fidata».

**Default for PoC.** Com'è (3). Raccomandazione: (1), che chiude la lettura del disco senza
toccare il flusso della prima installazione.

**Decided:** 2026-09-09 dal maintainer — una chiave che dichiara la cartella dei progetti,
con default **fuori dal repo**. Realizzato lo stesso giorno (ramo `chore/revisione-pre-2.7.0`):
`--projects-root` / `SWS_PROJECTS_ROOT`, default `~/sws_projects`, creata all'avvio;
`browse-dirs`, `mkdir` e `parent_path` non escono dalla radice (confronto dopo
`canonicalize`, anche contro i link simbolici). Container e script passano il flag esplicito
come prima; `start_runtime.sh`/`start_editor.sh` onorano `SWS_PROJECTS_ROOT` se impostata.
Da verificare dal maintainer prima di archiviare.

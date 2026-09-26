# Un gestore minimale del repository del progetto, nella scheda Git

**Stato: piano — da approvare.** Richiesta del maintainer, 26-09-2026, subito dopo il primo progetto
(CasaDomotica) agganciato a GitHub dall'IDE: «vedere i commit, scegliere se provare a tornare a uno
precedente per dei test, fare il diff tra file e fare il fork di un progetto».

## Le scelte del maintainer (26-09-2026)

| Funzione | Scelta |
|---|---|
| Tornare a un commit | **Prova temporanea**: il progetto si carica com'era a quel commit, con un banner e il **salvataggio bloccato**; da lì «Torna all'ultima» oppure «**Riparti da qui**», che crea un commit **nuovo** con quella versione. La storia non si cancella mai |
| Diff | **Tutti e tre**: modifiche non committate; un commit contro il precedente; due commit qualsiasi (un file o tutto il progetto) |
| Fork | **Nuovo progetto da un commit**: una cartella nuova in `projects_root`, copiata da un commit scelto (anche vecchio), **con la sua storia git**, poi agganciabile a un altro repository. È «Duplica progetto», ma da una versione e con git |

## Cosa c'è già (misurato il 26-09-2026)

- `sws-web/src/git_deploy.rs` — `GitDeploy`: status, pull, rollback (`reset --hard HEAD~1`, **distruttivo**:
  vedi «Rollback» sotto), commit con le guardie, push con upstream, tag, chiave SSH, identità. Tutto via
  `std::process::Command`, niente libgit2.
- `router.rs` — `soft_reload_project(s, dir)`: ricarica tag, tipi, allarmi, funzioni, lingue e notifiche da
  disco senza riavviare le sorgenti né toccare lo storico. È quello che usano Deploy e Rollback.
- `projects.rs` — `duplicate_project`: `safe_project_name`, `copy_dir_all` sotto `project_write_lock`,
  registrazione in `known_projects`. `project_write_lock` è preso da **9** punti di scrittura
  (6 in `projects.rs`, 2 in `backups.rs`, 1 in `router.rs`, cioè `patch_project_se`).
- Editor: `GitTab.tsx` (la scheda), CodeMirror 6 già fra le dipendenze (**senza** `@codemirror/merge`).

## Fasi — una per sessione, un ramo alla volta

### Fase 1 — Elenco dei commit e diff (sola lettura, rischio basso)

Backend (`git_deploy.rs` + rotte in `router.rs`, stessa classe di accesso di `git-status`):
- `GET /api/project/git/log?limit=50&skip=0` → `[{sha, short, author, email, date, message, files: n}]`
  (`git log --format=… -z`, `--shortstat` per il numero di file).
- `GET /api/project/git/diff?from=<rev>&to=<rev>&path=<file>` → testo unificato di `git diff`:
  - senza `from`/`to` = **modifiche non committate** (`git diff HEAD`, più i file nuovi non tracciati,
    `--intent-to-add` o elenco a parte);
  - solo `to` = il commit contro il suo genitore (`<rev>^!`; il primo commit contro l'albero vuoto);
  - `from` e `to` = due commit qualsiasi;
  - `path` opzionale; senza, tutto il progetto con l'elenco dei file cambiati (`--stat`/`--name-status`).
- Revisioni **validate** come i tag (`ref_sicuro` + `rev-parse --verify`), percorso relativo senza `..`,
  e sempre dopo `--`. File binari (le PNG della pagina di boot) → «binario, N byte → M byte».

Editor (`GitTab.tsx`, sezione «Storia»):
- elenco dei commit (sha breve, autore, data, messaggio, n. file), paginato;
- clic su un commit → i file che ha cambiato → clic su un file → diff;
- due caselle per scegliere «da» e «a» → confronto fra due commit qualsiasi;
- «Modifiche non committate» in cima all'elenco quando l'albero non è pulito;
- diff unificato colorato (righe `+`/`-`/`@@`) in un componente semplice. La vista affiancata con
  `@codemirror/merge` è un'aggiunta successiva, solo se quella unificata non basta.

### Fase 2 — Prova temporanea e «Riparti da qui» (tocca il disco: rischio medio)

- **Entrare**: `POST /api/project/git/prova {sha}`. Rifiutato se l'albero non è pulito (il messaggio dice
  di fare prima Commit: niente stash automatici). Poi `git checkout --detach <sha>` e
  `soft_reload_project`. `secrets.yaml`, storico e backup sono fuori da git e **non cambiano**.
- **Stato**: `GitStatus` guadagna `prova: Option<{sha, date, message}>` (HEAD staccato = prova in corso).
  L'editor mostra un banner fisso «Stai provando la versione del <data> — <messaggio>» con
  **Torna all'ultima** e **Riparti da qui**, e ricarica pagine e progetto dal disco.
- **Salvataggio bloccato**: un solo punto — chi prende `project_write_lock` controlla prima «HEAD staccato»
  e risponde 409 con un testo chiaro. Da verificare nella sessione che **tutti** i salvataggi (sinottici,
  faceplate, ricette, boot, immagini) passino da lì; quelli che non ci passano sono il rischio vero di
  questa fase.
- **Torna all'ultima**: `git checkout <ramo>` (il ramo da cui si era partiti, ricordato in
  `.git/sws-prova` o ricavato da `@{-1}`) + `soft_reload_project`.
- **Riparti da qui**: tornare sul ramo, poi `git restore --source=<sha> --staged --worktree -- :/`
  (così anche i file **aggiunti dopo** spariscono), commit «Ripristinata la versione <short> del <data>».
  La storia resta tutta; il commit nuovo si pubblica con il Push di sempre.
- **Rollback**: il bottone attuale fa `reset --hard HEAD~1`, che su un commit già pubblicato riscrive la
  storia. Con «Riparti da qui» diventa ridondante: da decidere nella sessione se toglierlo o farlo
  diventare «Riparti dal commit precedente».
- Da chiarire nella sessione: cosa fa il **runtime** del dispositivo se riceve un Deploy mentre l'IDE è in
  prova; le sorgenti cambiate fra le due versioni (`soft_reload_project` non riavvia le sorgenti).

### Fase 3 — Fork: nuovo progetto da un commit

- `POST /api/project/git/fork {sha, new_name}`: `safe_project_name`, stessa collocazione di
  `duplicate_project` (interno a `projects_root`, oppure accanto se esterno), sotto `project_write_lock`.
- `git clone --no-hardlinks <progetto> <nuovo>` (la storia viaggia intera), poi nel nuovo
  `git switch -c main <sha>` se `sha` non è l'ultimo, `git remote remove origin` (il nuovo non deve poter
  pubblicare sul repository dell'originale) e le stesse righe di `.gitignore`.
- **Non** viaggiano con git e vanno decisi nella sessione: `secrets.yaml` (copiarlo? «Duplica» lo copia;
  un fork per un altro impianto forse no), `users.yaml`, lo storico (no), i backup (no), la chiave SSH e
  l'identità (`.git/config` locale: il clone non li porta).
- Registrazione in `known_projects` come fa `duplicate_project`; nell'editor, «Fork da qui» accanto a ogni
  commit dell'elenco, con il nome del nuovo progetto, e alla fine «Apri il nuovo progetto».

## Verifica, per ogni fase

- Test in `git_deploy.rs` su repository temporanei, come quelli di oggi (un remote nudo locale per ciò
  che parla col remote; niente rete).
- `cargo check`, `pnpm build`, `./scripts/check_static.sh`, poi la prova del maintainer **su
  CasaDomotica**, che ora ha un repository vero su GitHub.

**Prima di scrivere codice per una fase**: rileggere questa sezione contro il codice di quel giorno.
Le misure qui sopra valgono per il 26-09-2026.

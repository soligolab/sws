# «Salva come…» e il repository git: nuovo repository, nessuno, o un ramo con un nome — seme

> Nato il 10-11-2026 da `Appunti.txt` (un punto senza data, scritto fra gli appunti del 28-10-2026),
> quando il maintainer ha chiesto di trasformare gli appunti in semi e piani e di eliminare il file.
>
> **Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan
> approfondita e dedicata, per sviscerarne tutti i dettagli. Qui ci sono l'idea del maintainer e le
> misure sul codice del 10-11-2026, non un progetto.

## Cosa ha scritto il maintainer

Il punto è in prima persona. Lo riporto intero; ho corretto solo due refusi («ritorovo» → «ritrovo»,
«prepository» → «repository»).

> «Se faccio "Save as..." mi sembra che crei una copia del progetto ma a quel punto viene copiato
> anche il link al repository. Succede quindi che mi ritrovo due progetti diversi che fanno
> riferimento ad un unico repository.
>
> Durante il "Save as...", nel momento in cui il repository è inizializzato, dovrei avere l'opzione
> per usare un nuovo repository, per non usare nessun repository e, che è la mia scelta
> preferenziale, vorrei l'opzione per creare un branch con un nome specifico.
>
> Analizziamo le implicazioni, in particolare dell'ultima opzione, l'idea è che se da un progetto ne
> derivo delle varianti posso così rapidamente importare le differenze da un branch all'altro (di
> solito il "Save as..." lo uso per fare una copia di prova, test o per gestire impianti simili ad
> uno madre).»

In breve: tre scelte da offrire quando il progetto copiato è già un repository git. La preferita è la
terza, perché «Salva come…» serve a fare varianti di un impianto madre, e fra varianti si vogliono
portare le differenze avanti e indietro.

## Cosa c'è oggi, misurato il 10-11-2026

### L'impressione del maintainer è corretta: la copia porta con sé tutto `.git`

- «Salva come…» sta nel menu ☰ dell'editor: `handleSalvaCome` in
  `sws-editor/src/components/MainMenu.tsx` (commento dalla riga 113, funzione dalla riga 124). È entrato il 14-10-2026 (`1a3d6705`): il duplicato
  esisteva già nell'elenco dei progetti (pulsante ⧉), ma da dentro l'editor non c'era modo di dire
  «questo, con un altro nome». Testi in `sws-editor/src/i18n/it.json` (righe 176-179: `menu.salvaCome`,
  `salvaComeTitle`, `salvaComePrompt`, `salvaComeNonSalvato`). Si avvisa se ci sono modifiche non
  salvate: la copia prende il progetto com'è sul disco, non quello che si vede.
- Il menu chiama `api.duplicateProject(rif, nuovo)` (`sws-editor/src/api/client.ts`, riga 2165), cioè
  `POST /api/projects/:azienda/:nome/duplicate` → `crate::projects::duplicate_project`
  (`sws-runtime/crates/sws-web/src/router.rs`, righe 1348-1353;
  `sws-runtime/crates/sws-web/src/projects.rs`, riga 2679). Poi apre la copia e ricarica. Nel cloud la
  rotta va al **gateway** (`sullInsiemeDeiProgetti` in `client.ts`) e l'indirizzo del progetto lo dà
  l'URL `/p/<azienda>/<progetto>/`: il 16-10-2026 il container rispondeva 404 su
  `/api/projects/-/progetto/duplicate`, perché conosceva solo la cartella montata.
- `duplicate_project` copia la cartella con `copy_dir_all(&src_dir, &dst_dir, &[crate::archivio::SEGNO])`
  (`sws-runtime/crates/sws-web/src/templates.rs`, riga 89). È una copia ricorsiva che salta **solo** il
  segno dell'archivio (`.archiviato`, `archivio.rs` riga 26) al primo livello. **`.git` viene copiato
  intero**: il remote `origin`, il `.git/config` locale (identità `user.name`/`user.email`,
  `core.sshCommand`), la chiave SSH del progetto in `.git/sws-ssh/` (dal 15-10-2026), il ramo, la
  storia. Vengono copiati anche `secrets.yaml`, `users.yaml`, `history/`, `backups/`.
- Conseguenza: originale e copia puntano allo stesso `origin`, sullo stesso ramo, con la stessa
  chiave. Un «Push» dalla copia pubblica sul repository dell'originale. È esattamente quello che il
  maintainer ha visto.
- La copia nasce **accanto** all'originale, nella stessa azienda (`cartella_nuovo_progetto`,
  `projects.rs` riga 2637), sotto `project_write_lock`. Nel cloud `segui_duplicazione`
  (`sws-runtime/crates/sws-web/src/gateway/progetti.rs`, riga 834) copia le chiavi `*.key` della
  configurazione di progetto ma non il pannello ricordato: «una copia di prova non deve collegarsi da
  sola all'impianto vero». Per il repository non c'è nessuna regola equivalente.
- `projects.rs` riga 3666 lo dice in chiaro per un altro motivo: `.git` «it's not ours to rename».
  Nessuna parte del codice di duplicazione sa che quella cartella è un repository.
- Il manuale (`docs/manual/04_editor_guide.md`, righe 556-561) descrive «Salva come…» senza una
  parola sul repository. `docs/manual/13_api_reference.md` riga 241 elenca la rotta.

### C'è già una seconda porta, e fa il contrario

Il fork da un commit (Fase 3 del [gestore del repository](../../archive/2026-09-26-gestore-repository-progetto.md),
26-09-2026): `POST /api/project/git/fork` → `GitDeploy::fork_in`
(`sws-runtime/crates/sws-web/src/git_deploy.rs`, riga 919). Fa `git clone --no-hardlinks`, poi nel
nuovo `checkout -B main <sha>`, **`remote remove origin`** («il nuovo non deve poter pubblicare sul
repository dell'originale»), copia l'identità locale, **non** copia la chiave SSH (una deploy key vale
per un repository solo), copia `secrets.yaml` solo se richiesto, mai storico e backup. Nell'IDE è
«⑂ Fork da qui» accanto a ogni commit (`sws-editor/src/config/schede/GitStoria.tsx`, righe 66-105),
con la scelta sui segreti ricordata in `localStorage` (`sws.git.forkSegreti`). Usa la stessa
`cartella_nuovo_progetto` di «Salva come…».

Quindi oggi ci sono due modi di copiare un progetto, con due regole opposte sul repository:
«Salva come…» porta tutto, il fork stacca tutto. Nessuno dei due è la scelta preferita del
maintainer (un ramo).

### Rami: il runtime li legge, non li crea

- `GitStatus.branch` (`git_deploy.rs`, riga 161) si legge con `symbolic-ref` e l'IDE lo mostra
  (`sws-editor/src/config/schede/GitTab.tsx`, riga 266). Non c'è un selettore di ramo.
- Gli unici `checkout` in `git_deploy.rs` sono tre: `--detach` per la prova (riga 844), il ritorno al
  ramo (riga 861), `-B main <sha>` nel fork (riga 946). Nessuna funzione crea un ramo con un nome
  scelto, né cambia ramo.
- Non esiste `merge`, `cherry-pick` né `rebase` in `git_deploy.rs`: «importare le differenze da un
  branch all'altro» oggi si fa solo da riga di comando, fuori dall'IDE.
- La prova di un commit (Fase 2) scrive il ramo di ritorno in `.git/sws-prova` (riga 803): funziona
  per qualunque nome di ramo.
- Nel cloud git e ssh ci sono nell'immagine dal 15-10-2026
  ([git nel cloud](../../archive/2026-10-15-git-nel-cloud.md)), quindi tutto questo vale anche lì.

## Le tre opzioni del maintainer, e cosa comportano oggi

Il dialogo deve comparire solo quando `GitDeploy::is_git_repo()` è vero per l'originale
(`git_deploy.rs`, riga 119). Un progetto senza repository si copia come oggi.

1. **Nuovo repository.** Due letture possibili, da decidere nella sessione di plan: (a) copia come
   oggi, poi `rm -rf .git` e `git init -b main` — la copia riparte da zero, senza storia e senza
   `origin`, e si aggancia al suo repository dalla scheda Git; (b) come il fork: `git clone` senza
   `origin`, con la storia intera. La (b) esiste già (`fork_in` con `sha = HEAD`). Cosa succede alla
   chiave SSH del progetto in `.git/sws-ssh/`: nel fork non si copia, qui va deciso.
2. **Nessun repository.** Aggiungere `.git` alla lista `skip` di `copy_dir_all` (la lista vale solo al
   primo livello, che è dove sta `.git`). La copia resta un progetto normale, senza versionamento.
3. **Un ramo con un nome scelto** (la scelta preferita). Copia come oggi, `.git` compreso, poi nella
   copia `git checkout -b <nome>`. Originale e copia condividono `origin` e la chiave SSH (giusto,
   perché il repository è lo stesso), ognuno sul suo ramo. Implicazioni da analizzare, come chiede il
   maintainer:
   - **Due cartelle di lavoro sullo stesso remote.** Il «Push» della copia pubblica il ramo `<nome>`;
     `unpushed_count` (riga 405) conta rispetto al ramo tracciato, quindi va impostato l'upstream
     (`push -u`). Oggi `push` non lo fa.
   - **Portare le differenze fra rami** è il motivo dell'opzione, e manca del tutto: serve almeno una
     funzione `merge` (o `cherry-pick`) in `git_deploy.rs` e una voce nella scheda Git. Con due
     progetti che modificano lo stesso `project.yaml` i conflitti sono probabili: va deciso come
     mostrarli e risolverli senza terminale.
   - **Il dispositivo.** Il deploy del pannello fa `git pull` (`pull`, riga 196) sul ramo che ha in
     locale. Un pannello clonato su `main` non prende la variante: deve poter scegliere il ramo.
   - **I file che git non porta.** `secrets.yaml` è in `.gitignore` (passo 2e, riga 468), quindi la
     copia lo ha solo perché `copy_dir_all` lo copia: va chiesto come nel fork («copia i segreti?»).
     Lo stesso per `users.yaml`, `history/`, `backups/`.
   - **Il nome del ramo** deve passare `ref_sicuro` (riga 421).
   - **Le due persone sullo stesso progetto** sono un problema parente ma diverso: lì è una cartella
     con due editor ([seme](2026-10-21-due-editor-sullo-stesso-progetto.md)), qui due cartelle con un
     repository.

## Domande per la sessione di plan

- Il fork da un commit e «Salva come…» con «nuovo repository» fanno la stessa cosa? Se sì, una
  delle due porte si può togliere o rimandare all'altra.
- La scelta è per copia o per progetto? Un impianto madre con molte varianti potrebbe volere
  «sempre un ramo» senza che glielo si chieda ogni volta.
- Quanto git si vuole mostrare nell'IDE: solo «porta qui le modifiche di <ramo>», o anche la lista dei
  rami, il cambio ramo, i conflitti?
- Nel cloud la duplicazione la fa il gateway, ma il `git checkout -b` lo deve fare qualcuno dentro la
  cartella del progetto: il gateway (che ha git dal 15-10-2026) o il container della copia al primo
  avvio?

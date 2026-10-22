# Claude Code Instructions

> Auto-loaded when this repo is opened. Process and pointers only — never duplicated context.
> The maintainer writes in Italian; reply in Italian.

## Hard rules

1. **Never `git push`** without an explicit instruction in the current session. Confirming that a feature works is *not* approval to push.
2. **Never commit directly to `main`**, except meta commits (`STATUS.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/**`) and the squash merges described below.
3. **Never resolve an item in `docs/OPEN_QUESTIONS.md`**, and since 2026-09-18 **never add one either**: a new open question becomes a **short plan file** in `docs/plans/` (see «Plans»). The questions file is frozen — it keeps its numbers and its references, nothing more.
4. **Never ask permission for commands allowed in `.claude/settings.json`** (cargo, pnpm, git, ls/cat/grep, mkdir, podman…). Just run them. If a safe, recurring command is denied, propose a specific allow rule — never `Bash(*)`.
5. **Never SSH into a test device without asking** — addresses change every session.
6. **`docs/CONTEXT.md` beats `docs/SWS_Project_Specification.md`** wherever they conflict, until the PoC graduates to a product. The spec is the long-term destination; CONTEXT.md is the short-term reality.

## Regole UI dell'editor (decise dal maintainer, 2026-08-23)

1. **WYSIWYG obbligatorio.** Il ramo edit-mode di ogni oggetto sinottico DEVE usare lo stesso
   rendering del runtime — pattern: contenuto reale + `pointerEvents:"none"` + hit-rect
   trasparente per selezione/drag (come gauge/symbol/faceplate/grid). I placeholder che
   divergono per contenuto o dimensioni sono bug, non scorciatoie. Dati live veri quando
   disponibili; widget con storico: una fetch al mount, niente polling in edit. Gli effetti
   runtime (blink, motion, flusso pipe, bordo allarme, stale) si previsualizzano col toggle
   "Anteprima effetti" della toolbar, spento di default.
2. **Una sezione per dato.** Mai due punti del pannello proprietà che scrivono lo stesso
   campo; se esistono variante semplice e avanzata, sopravvive solo quella completa. Il campo
   `tag` generico compare solo sui tipi che lo usano come dato primario; per gli altri vive
   nella sezione qualità come "Tag di stato (allarme/stale/qualità)".

## CasaDomotica, il progetto di riferimento (decisione del maintainer, 2026-10-16)

**Quando una funzione visibile entra in `main`, va messa anche in CasaDomotica.** Non come
verifica che funzioni — quella è la *definition of done* — ma perché il progetto di riferimento
resti rappresentativo di cosa il prodotto sa fare. Se per una funzione non c'è un posto sensato
in un impianto domestico, vale la pena annotarlo: è un indizio su chi sia davvero il destinatario
di quella funzione.

Non sostituisce i gemelli `demo-items-*`, che coprono i **tipi** (39 su 39, guardia
`check_demo_templates.sh`): CasaDomotica copre le **combinazioni su dati veri** — sorgenti vere,
allarmi veri, 540 MB di storico — ed è la cosa che i gemelli non possono dire, cioè se una
funzione regge in un impianto che gira. Il 16-10-2026 usava 16 tipi su 39.

Era un piano (`docs/plans/`), ma un piano che non finisce mai non è un piano: dal 21-10-2026 è
una regola, e il piano è in
[archivio](docs/archive/2026-10-16-casadomotica-progetto-di-riferimento.md). Le due domande che
lasciava aperte — versionarla, e separarla dall'impianto di casa del maintainer — stanno nel
seme [CasaDomotica versionata e separata](docs/plans/2026-10-21-casadomotica-versionata-e-separata.md).

## I file di lavoro stanno in `sws/tmp/` (regola del maintainer, 2026-10-22)

**Qualunque file che il maintainer debba guardare va in `sws/tmp/`, mai in `/tmp`.** Istantanee
del pannello, confronti prima/dopo, misure, log di una prova, pagine HTML di anteprima: dentro il
checkout, non nella cartella temporanea della macchina.

Il motivo e' banale e non si risolve da solo: **il maintainer lavora in remoto sulle macchine di
sviluppo**, e `/tmp` di quelle macchine non lo raggiunge. Una cartella dentro il progetto si',
perche' e' la stessa che ha gia' aperta. Il 22-10-2026 una sessione ha prodotto undici immagini
di confronto in `/tmp` e nessuna era apribile: «al posto di usare /tmp (a cui non riesco ad
accedere da qua) usa una cartella tmp all'interno del progetto».

La cartella e' in `.gitignore` (`/tmp/`) e porta un `LEGGIMI.md` che spiega cos'e'. Si puo'
svuotare in qualunque momento: e' materiale di una sessione, non del progetto. Quello che merita
di sopravvivere alla sessione va in `docs/` e si committa.

Vale su **tutte** le macchine di sviluppo, ed e' per questo che sta qui e non in una memoria
locale: `CLAUDE.md` viaggia con git, `~/.claude/` no — stesso motivo per cui i piani stanno in
`docs/plans/`.

## Session start

**First, run `./scripts/session_start.sh`.** It compares this machine with
origin, offers the right remedy for each common case (diverged `main`, tags left
on the pre-rewrite history, missing `node_modules`), and ends by printing where
the last session stopped. It never pushes, never deletes a branch, and never
resets over local commits that carry content origin doesn't have.

Then read, in order:

1. `docs/CONTEXT.md` — context, working mode, frozen architectural decisions, phase plan, task roadmap (T-xx).
2. `STATUS.md` — where the last session stopped, what's working, what to pick up.
3. `docs/OPEN_QUESTIONS.md` — deferred decisions, off-limits in a vibecode session. Since 2026-09-18 it is a frozen index: each remaining card points to the plan file that holds its text.

Then state, in three short lines: what the last session ended with, what you plan to do now, any blockers. **Wait for the go-ahead before writing code.**

Read these only when the trigger applies:

| Trigger | File |
|---|---|
| Touching `scripts/yocto/` or `deploy/yocto/` | `docs/YOCTO_CROSSCOMPILE.md` |
| Deploying to or testing on a device | `docs/TEST_SETUPS.md` |
| A permission prompt looks wrong | `docs/CLAUDE_CODE_SETUP.md` |
| Maintainer asks "come faccio a…?" | `docs/HOWTO.md` — answer from it, and add a new numbered chapter if the answer isn't there yet |
| Running the local stack | `scripts/README.md` |

## Working mode

- **Proof of concept, not a product.** Ship the smallest thing that works — see `docs/CONTEXT.md` §1.
- **Solo maintainer, sparse sessions of 3-4h.** Lost context between sessions is risk #1, permission friction is #2. Plan work that fits one session and stop at clean points.
- **Local stack:**
  - `./scripts/start_runtime.sh` — device runtime: viewer 7443 + IDE/admin 7444 + HTTP companion 8080, auto-opens project `default`.
  - `./scripts/start_editor.sh` — IDE **as a customer would run it**: 8460 + HTTP companion 8090, no viewer, projects in `~/sws_projects` (or `SWS_PROJECTS_ROOT`). Deploy via Configurazione → Istanza → Device → Connessione → "Connetti" with the remote runtime URL.
  - `./scripts/start_editor_develop.sh` — the same IDE with projects inside the checkout (`.run-editor/projects`). Use this one while developing; the other is the production run.
  - First access: open `http://localhost:8080` (runtime) or `:8090` (editor) to accept the self-signed cert without leaving the app.

## Definition of done

`cargo check` green **and** `pnpm build` green **and** `./scripts/check_static.sh` green **and** `cargo test` + `pnpm exec vitest run` green **and** the maintainer has confirmed the feature works. All five, before anything reaches `main`.

**The test suites joined the list on 2026-10-21**, the day they cost a release. The port move to 7443/7444 left two `dispositiviRegistrati` tests red — they still expected 8444 — and nobody saw it, because the three checks above were all green and nothing in this list said to run the tests. Those two reds shipped in 2.16.0, 2.16.1 and 2.16.2. `vitest` takes 26 seconds and `cargo test` about 10: the cost of not running them is a release that nobody can tell is broken.

`check_static.sh` joined the list on 2026-09-14. Two guards had gone red inside 48 hours, both from *good* work that never re-ran them: Q40 made 24 symbols builtin and deleted the SVGs a template still pointed at (`check_templates`), and the live web/LVGL parity fixes changed the `radio` example the generated AI schema is harvested from (`check_synoptic_schema`). Neither was caught at merge time. A guard nobody looks at stops being a signal — so it runs before the squash merge, not after someone notices.

## Si tagga quando si costruisce (2026-10-21)

Un tag di versione senza immagine **perde le sue note di rilascio, per sempre**. Le voci di
`NOVITA.yaml` non si leggono dal file: viaggiano come etichette dentro l'immagine, e il pannello le
raccoglie dalle immagini delle versioni che sta per attraversare (`versioni_dopo` in
`sws-web/src/aggiornamento.rs`, che legge i tag del **registry**). Una versione taggata in git e mai
costruita non è dentro nessuna immagine: le sue voci non le vedrà nessuno.

Successo il 21-10-2026 con 2.16.0 e 2.16.1, taggate e mai costruite. L'avviso sul cambio di porte
8443→7443 — il più importante della giornata — stava nel blocco 2.16.1, ed è rimasto irraggiungibile
finché non è stato riportato in avanti a mano.

Quindi: **il tag si crea quando si costruisce l'immagine, non quando si decide il numero.** E se una
versione resta senza immagine, le sue voci di `NOVITA.yaml` vanno riportate nel blocco successivo
prima del rilascio. Vale anche al contrario: una voce aggiunta a un blocco **dopo** che quella
immagine è stata costruita non è nella sua etichetta, quindi non è vera — va spostata avanti.

## Git workflow per task

Every roadmap task (T-01…T-20 and beyond):

1. **Branch** from `main`: `git checkout main && git checkout -b feat/T-01-pid-symbols`
2. **Develop** — all intermediate commits stay on the branch.
3. **Verify** — meet the definition of done above.
4. **Squash merge**, only after the maintainer confirms it works:
   ```
   git checkout main
   git merge --squash feat/T-01-pid-symbols
   git commit -s -m "feat(T-01): ..."
   ```
5. **Delete the branch** right after the squash merge — see «Un ramo alla volta» below.
   ```
   [ "$(git rev-parse main^{tree})" = "$(git rev-parse <branch>^{tree})" ] || echo FERMATI
   git branch -D <branch>
   ```
   The tree check **is** the safety: if the two hashes differ, something was lost — stop and say so, don't delete. And it has to be `-D`, not `-d`: with a squash merge the branch's commits are not ancestors of `main`, so `-d` refuses every branch this repo ever merges correctly. Same reason `git branch --merged` is useless here.
6. **Push only when told to**, and name the branch you're about to push before doing it.

All commits use `-s` (`Signed-off-by:` trailer).

## Un ramo alla volta (regola del maintainer, 2026-09-14)

**Mai aprire un secondo ramo mentre uno è ancora aperto.** Quando salta fuori qualcosa di nuovo a
ramo aperto, le opzioni sono **sempre tre**, e non ce n'è una quarta:

1. **Chiudere il ramo attuale**: finirlo, soddisfare la *definition of done*, squash merge,
   **eliminarlo**, e solo allora aprire quello nuovo.
2. **Annidare**: partire dal **ramo attuale** e non da `main`, così il lavoro nuovo è figlio di
   quello aperto e rientra passando da lì. È la scelta giusta quando il lavoro nuovo dipende da
   quello in corso o tocca gli stessi file.
3. **Rimandare**: annotare l'attività (in `STATUS.md` o in un piano) e riprenderla quando il ramo
   attuale è chiuso, mergiato ed eliminato.

**Perché, con la giornata che ha prodotto la regola.** Il 2026-09-14 c'erano tre rami aperti
insieme. `fix/ruolo-minimo-avviso-noauth` era finito alle 12:18 e è rimasto lì, non mergiato,
mentre altri due ci passavano davanti su `main`. Uno di quei due — l'IDE che smette di
autenticarsi — ha **invalidato in silenzio la condizione centrale del primo**: `authToken ===
"no-auth"` voleva dire «questo progetto non ha utenti» e ha iniziato a voler dire «questa è
un'istanza IDE». Mergiato com'era, l'avviso avrebbe contraddetto il proprio testo su ogni progetto
che gli utenti ce li ha.

**In git non c'era nessun conflitto.** Il conflitto era nel significato, e quel tipo git non lo
vede: nessun file toccato in comune, merge pulito, difetto vivo. Un ramo lasciato in parallelo
invecchia contro un `main` che intanto si muove — e l'invecchiamento non lascia tracce che un
`git merge` possa segnalare.

**Conseguenza sulla vecchia regola**: fino a oggi il punto 5 diceva «non cancellare il ramo, la
pulizia la decide il maintainer», e serviva quando i rami restavano in giro per settimane. Con un
ramo alla volta non c'è più niente da decidere dopo: il ramo si elimina appena mergiato, perché è
la cancellazione stessa a rendere impossibile il parallelo. Fa eccezione
`backup/main-pre-riscrittura-2026-09-09`, che non è un ramo di lavoro ma la storia pre-riscrittura
e **non si tocca**.

## Plans

**Plans go in `docs/plans/<date>-<slug>.md`, committed — never left in `~/.claude/plans/`.** That directory is per-machine and doesn't travel with git, and the maintainer works from two machines (office server, home PC): on 2026-07-30 an analysis written at home never made it to the office while the code did. Instruction of 2026-09-11: «i plan, non tenerli in ~/.claude/plans/ perché altrimenti li perdo tra casa e lavoro». Write the plan there as soon as it's approved — earlier if it's long — and commit it with the work. When a plan is finished or overtaken, move it to `docs/archive/` and add a row to that folder's README — `docs/plans/` should list only what's still in play. Keep the finished plan: it is the record of why things are the way they are.

**Un dettaglio residuo va in `docs/plans/Appunti.txt`, e il piano si chiude (regola del
2026-10-22).** Quando un piano è **enorme** e quello che resta dentro sono **dettagli da vedere
in futuro** — non lavoro vero — quei punti si spostano in `docs/plans/Appunti.txt`, uno per riga,
e il piano si archivia. Vale anche per i singoli punti sparsi che impediscono a un piano di
chiudersi. `Appunti.txt` è l'elenco delle piccole idee del maintainer, «le cose che devono essere
verificate e trasformate in plan da eseguire»: **quando i piani vivi arrivano a zero, si
analizzano gli appunti**.

Le sue parole: «se ci sono singoli punti che sarebbe bene spostare per chiudere un plan spostali
in Appunti.txt… se sono plan enormi e c'è qualche dettaglio che va visto in futuro, lo sposti in
Appunti.txt e chiudi+archivi il plan». Il motivo è dichiarato: «ho l'esigenza estrema di fare
ordine e archiviare un po' di plan» — un piano enorme tenuto vivo per tre dettagli nasconde
quello che è davvero in gioco, e l'elenco smette di servire a decidere cosa fare.

**Non** vale quando il residuo è lavoro vero: quello resta vivo, e spostarlo sarebbe perderlo.
Una riga in `Appunti.txt` deve bastare a sé stessa fra mesi: il contesto si scrive, non si
presuppone.

**An open question is a plan file too (rule of 2026-09-18).** When something architectural comes up that the maintainer has to decide — the kind of thing that used to become a card in `docs/OPEN_QUESTIONS.md` — write a **short** plan file instead: the idea, what was measured in the code at the time, the options if they're already visible, and **this sentence, stated plainly: when this work starts, the first step is a dedicated, in-depth plan session to work out every detail.** Do not attempt the detailed design when the question is born: too much changes between the question and the work, and a design written months early is a design that lies. The maintainer's words: «genera un file sintetico di plan con l'idea e l'indicazione precisa che quando iniziamo quel lavoro dovrà essere avviata una sessione plan approfondita per sviscerarne tutti i dettagli». Add a row to `docs/plans/README.md` with «**seme — decisione**» as its state. `docs/OPEN_QUESTIONS.md` is frozen: it keeps the numbers already assigned and a one-line reference per card, and `check_documenti.sh` keeps verifying those; new questions don't get a Q-number.

## Session end — and whenever context is running low

Do this *before* you run out of room, not after:

1. `cargo check` / `pnpm build` / `./scripts/check_static.sh` green.
2. Update `STATUS.md` — what was done, what's next, anything left half-finished.
3. Update `CHANGELOG.md` under `[Unreleased]`, **and `NOVITA.yaml`** for anything a panel user would notice: one short line in Italian **and** English (it is what panels show before updating — `check_novita.sh` checks both languages and the length).
4. Commit with `-s` and a clear message.
5. Anything architectural that surfaced → a **short plan file** in `docs/plans/` (see «Plans»), not a decision. Not `docs/OPEN_QUESTIONS.md` any more.
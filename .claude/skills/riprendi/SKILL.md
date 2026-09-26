---
name: riprendi
description: Ciclo di ripresa lavoro sul repo sws — rilevazione rami locali potenzialmente obsoleti (solo proposta), scelta del piano da cui ripartire (da docs/plans/ o da una Open Question), riverifica delle specifiche col maintainer, implementazione, test secondo la definition of done, commit/push su richiesta esplicita, e archiviazione del piano concluso. Usalo a inizio sessione o a inizio di ogni nuovo step di lavoro.
---

# Riprendi — ciclo di ripresa lavoro

Segui questi passi in ordine. Fermati a chiedere conferma dove indicato: questa skill
**propone**, non decide al posto del maintainer — coerente con le regole di `CLAUDE.md`.

Se non è già stato fatto in questa sessione, esegui prima il rituale di inizio sessione
descritto in `CLAUDE.md` (`./scripts/session_start.sh`, poi `docs/CONTEXT.md` →
`STATUS.md` → `docs/OPEN_QUESTIONS.md`, poi tre righe di stato) e aspetta il via libera
prima di scrivere codice. I passi seguenti assumono che sia già stato fatto.

**Qualunque richiesta di sincronizzarsi con origin — «fai pull», «aggiorna», «fetch» — durante
questo ciclo passa da `./scripts/session_start.sh`, mai da un `git pull`/`git fetch` a mano.**
Non è equivalente: `git pull` su una storia divergente tenta un merge in silenzio, esattamente
il guasto per cui questo script esiste (vedi l'intestazione dello script stesso, incidenti del
2026-09-02). Rilanciarlo di nuovo a metà sessione è economico ed è la scelta sicura anche se il
rituale di inizio è già stato fatto una volta.

## 0. Su quale macchina gira questa sessione

`session_start.sh` stampa `utente@hostname` in testa. Cerca quell'hostname nella tabella
«Le macchine» in testa a `docs/TEST_SETUPS.md` e aggiungi alle tre righe di stato una quarta:
**«Sessione su `<hostname>` (<dove sta>), raggiunge: <dispositivi>.»**

- **Non dedurre il luogo dal nome.** L'host `ufficio` è il PC **di casa** del maintainer (il suo
  ufficio privato): il 25-09-2026 una sessione ha creduto di essere in ufficio per il nome e ha
  proposto di «portare il lavoro a casa» per provarlo sul TC620, che era raggiungibile da lì.
- **La macchina e il maintainer sono due cose.** Può lavorare in remoto su una macchina che sta
  altrove: per un collaudo conta cosa raggiunge la macchina, non dove si trova lui. Se un compito
  chiede un dispositivo che questa macchina non raggiunge, dillo e proponi la strada (push, e build
  sulla macchina che lo raggiunge).
- **Casa o no, per l'host `ufficio`**: si è a casa se il TC620 di casa risponde a un ping
  (`ping -c1 -W2 tc620-a-p3-c6-07aff9.local`) — regola del maintainer del 26-09-2026, con il comando
  in `docs/TEST_SETUPS.md` §0. Solo il ping: mai ssh senza chiedere. Se non risponde, chiedi.
- **Un hostname che non è in tabella**: chiedi al maintainer dove sta e cosa raggiunge, e aggiungi la
  riga a `docs/TEST_SETUPS.md` (commit meta su `main`).

## 1. Rami locali potenzialmente obsoleti

> Dal 2026-09-14 vale **«Un ramo alla volta»** (`CLAUDE.md`): un ramo si elimina appena mergiato,
> quindi in una sessione nata dopo quella data qui non dovrebbe esserci niente da proporre. Questo
> passo resta per i rami **anteriori** alla regola, e per il caso in cui una sessione sia finita a
> metà.

- `git branch -v` per elencare i rami locali diversi da `main`.
- Il repo usa **squash-merge**, quindi `git branch --merged` non è affidabile: un ramo
  già confluito in `main` non risulta "merged" da git. Per ogni ramo guarda invece:
  - se il task/la domanda a cui si riferisce risulta già chiuso in
    `docs/archive/README.md`, `STATUS.md` o `docs/history/OPEN_QUESTIONS-chiuse.md`;
  - se l'ultimo commit del ramo dice già da solo che è stato chiuso senza codice o
    superato (es. "chiusa senza codice", "il campo esisteva già");
  - se `git diff main...<ramo>` è vuoto o riguarda solo file ormai irrilevanti.
- Presenta una tabella **ramo — ultimo commit — ipotesi** (fuso in main / superato /
  ancora vivo, non toccare) e chiedi esplicitamente quali cancellare, uno per uno.
  **Per questi rami vecchi non cancellare nulla senza conferma, uno per uno**: sono rami di cui
  nessuno ricorda più lo stato, e la regola nuova non li copre retroattivamente. Diverso il caso
  di un ramo che hai mergiato **tu in questa sessione**: quello si elimina subito dopo aver
  verificato che `main^{tree}` e `<ramo>^{tree}` coincidano, senza chiedere.
  `backup/main-pre-riscrittura-2026-09-09` non è un ramo di lavoro e **non si tocca**.

## 2. Piani da cui ripartire

- Guarda `docs/plans/README.md` (i piani **vivi**). Se c'è almeno un piano
  PARZIALE/vivo, proponi di ripartire da lì, a meno che il maintainer non indichi
  altro.
- Se non c'è nessun piano **in corso**, guarda i **semi** nella seconda tabella di
  `docs/plans/README.md`: sono le domande aperte, una per file, ognuna con l'idea e le
  misure di quando è nata. Proponi al maintainer quale prendere in mano — e quando lo
  sceglie, la prima cosa è **una sessione di plan approfondita** su quel seme, in **Plan
  mode**, senza scrivere codice: il seme dice apposta di essere materiale e non un piano
  d'esecuzione, perché fra la domanda e il lavoro passa troppo tempo.
- `docs/OPEN_QUESTIONS.md` è **congelato dal 18-09-2026**: ogni scheda rimasta rimanda al
  seme che ne tiene il testo. Non ci si aggiunge e non ci si «risolve» niente (CLAUDE.md
  regola #3).

## 3. Per ogni piano, uno alla volta

a. **Riverifica le specifiche col maintainer prima di scrivere codice.** Rileggi il
   piano, evidenzia ambiguità o parti che non corrispondono più al codice attuale, e
   aspetta il via libera. Un piano scritto giorni o settimane fa non è garantito che
   sia ancora accurato.

b. **Branch dedicato**: `git checkout main && git checkout -b feat/T-XX-slug` (o
   `fix/...`), secondo la convenzione già in uso in `CLAUDE.md` § Git workflow.

c. **Implementa** seguendo il piano confermato.

d. **Testa** — definition of done da `CLAUDE.md`: `cargo check` verde **e**
   `pnpm build` verde **e** `./scripts/check_static.sh` verde **e** conferma esplicita del
   maintainer che la funzionalità funziona. Tutti e quattro, non tre o due.

e. **Commit, squash-merge, push**:
   - Commit sul branch di sviluppo con `-s`.
   - Solo dopo conferma del maintainer:
     `git checkout main && git merge --squash feat/T-XX-slug && git commit -s -m "feat(T-XX): ..."`.
   - Il push resta **solo su richiesta esplicita del maintainer in questa sessione**
     (CLAUDE.md regola #1) — invocare questa skill non è di per sé quel via libera:
     chiedilo comunque a fine ciclo, e nomina il branch prima di pusharlo.

f. **Ramo di sviluppo**: a lavoro mergiato, verifica che `main^{tree}` sia identico a
   `feat/T-XX-slug^{tree}` e **cancella il ramo** — è la regola «Un ramo alla volta» del
   2026-09-14: finché il ramo esiste, esiste la possibilità di aprirne un secondo in parallelo.
   Se gli alberi non coincidono qualcosa è andato perso: fermati e dillo, non cancellare.

g. **Aggiorna `STATUS.md`**: cosa è stato fatto, cosa resta, eventuali cose lasciate a
   metà.

h. **Aggiorna `CHANGELOG.md`** sotto `[Unreleased]` — richiesto dalla definition of
   done in `CLAUDE.md`.

i. **Archivia il piano concluso**: sposta il file da `docs/plans/<file>.md` a
   `docs/archive/<file>.md`; aggiorna le due tabelle indice (`docs/plans/README.md`
   toglie la riga, `docs/archive/README.md` la aggiunge con stato ed evidenza); cerca
   ed eventualmente correggi riferimenti al vecchio percorso altrove nel repo
   (`grep -rl "docs/plans/<file>.md" .`).

j. Se durante il lavoro emerge una decisione architetturale non prevista dal piano:
   **non deciderla** — scrivi un **seme** in `docs/plans/<data>-<slug>.md` (CLAUDE.md,
   sezione «Plans»: l'idea, le misure di adesso, e la frase che quando quel lavoro
   comincerà servirà una sessione di plan approfondita), aggiungi la riga nella seconda
   tabella di `docs/plans/README.md`, e continua con il default PoC.

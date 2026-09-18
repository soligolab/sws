---
name: finalizza-giornata
description: Chiusura di fine sessione — verifica che non ci siano rami aperti né lavoro non passato dal ciclo per-task, scrive il riepilogo in STATUS.md, aggiorna CHANGELOG.md, committa i meta file e fa push su origin, così che /riprendi possa ripartire da un'altra macchina. Usala a fine giornata, quando il maintainer chiede esplicitamente di chiudere e pushare.
---

# Finalizza giornata — chiusura e push di fine sessione

Questa skill **non sostituisce** il ciclo per-task di `CLAUDE.md` (branch → sviluppa → verifica →
squash-merge → elimina ramo): presuppone che quel ciclo sia già stato seguito durante la sessione
per ogni pezzo di lavoro. Il suo compito è chiudere la *giornata*, non un singolo task — e fare da
sola l'unica cosa che il resto del flusso lascia sempre in sospeso: il push.

Invocare questa skill **è** l'istruzione esplicita richiesta dalla regola 1 di `CLAUDE.md` ("mai
`git push` senza un'istruzione esplicita nella sessione corrente") per la sessione in corso. Non
generalizza in un'abitudine di push automatico: la prossima sessione richiede una nuova
invocazione, esplicita quanto questa.

## 1. Niente rami aperti

- `git branch -v`. Se compare un ramo diverso da `main` e da
  `backup/main-pre-riscrittura-2026-09-09` (che non è un ramo di lavoro e non si tocca),
  **fermati**: la regola «Un ramo alla volta» dice che a fine giornata non dovrebbe essercene
  nessuno. Non decidere da solo se mergiarlo, annidarci sopra o abbandonarlo — chiedi al
  maintainer prima di proseguire con questa skill.
- Se il ramo risulta già mergiato (`main^{tree}` coincide con `<ramo>^{tree}`), proponi la
  cancellazione con lo stesso controllo del ciclo per-task.

### Quello che `git branch -v` non può vedere (2026-09-17)

La notte fra il 16 e il 17-09-2026 questa skill ha chiuso una giornata dicendo «nessun ramo
aperto, working tree pulito, niente da committare né da pushare». Tutte e tre le affermazioni
erano **vere in quel checkout e false nel repo**: su un'altra macchina era in corso una release,
e il tag `2.8.0` non è mai arrivato su origin.

Un checkout non vede i commit locali di un checkout sorella, e nessuna guardia può cambiarlo.
Quello che si può fare è **guardare origin invece che solo sé stessi**, ed è quello che ora fa
`check_release_coerente.sh` (passo 3, dentro `check_static.sh`): se un tag di versione esiste solo
qui, o se una versione del `CHANGELOG.md` non ha un tag, la giornata non è chiusa. Se sei incerto
se un'altra sessione stia lavorando in parallelo, `git log --format='%h %ad %s' --date=iso -5
origin/main` dice subito se su origin è successo qualcosa che non hai fatto tu.

## 2. Niente lavoro a metà nell'albero

- `git status`. Se ci sono modifiche non committate:
  - solo file meta (`STATUS.md`, `CHANGELOG.md`, `docs/**`, `CLAUDE.md`, `.claude/**`) → procedi,
    li finalizzi al passo 4.
  - codice o contenuto (template, sinottici, sorgenti) non ancora passato dalla *definition of
    done* → **fermati** e dillo: non si committa codice non verificato solo per chiudere la
    giornata prima del previsto.

## 3. Definition of done

`cargo check` verde **e** `pnpm build` verde **e** `./scripts/check_static.sh` verde. Se qualcosa
è rosso, dillo e non pushare — un push rosso è peggio di nessun push. Se il lavoro della sessione
è già stato verificato passo per passo durante il ciclo per-task, questo è un ricontrollo, non una
sorpresa attesa.

## 4. Il riepilogo in STATUS.md

Scrivi (o aggiorna) in cima a `STATUS.md` una sezione nello stesso stile già in uso:

```
## ▶ Riprendere da qui — <breve titolo> (YYYY-MM-DD)

- cosa è stato fatto in questa sessione, con riferimento agli hash di commit dove utile
- cosa resta aperto, se qualcosa è stato lasciato a metà
- il prossimo passo suggerito
```

Questo è **esattamente** ciò che `/riprendi` legge per primo su un'altra macchina (passo 2 di
quella skill: "Guarda `docs/plans/README.md`... proponi di ripartire da lì"; e più a monte, il
rituale di inizio sessione di `CLAUDE.md` legge `STATUS.md` come secondo file). Deve bastare a
ricostruire il contesto senza dover rileggere la conversazione originale.

## 5. CHANGELOG.md

Se in questa sessione sono stati aggiunti, corretti o rimossi comportamenti visibili non ancora
loggati sotto `[Unreleased]`, aggiungili ora.

## 6. Niente decisioni architetturali prese qui

Se durante la sessione è emersa una decisione architetturale mai presa, verifica che esista già
il suo **seme** in `docs/plans/` (dal 18-09-2026 le domande aperte non vanno più in
`docs/OPEN_QUESTIONS.md`, che è congelato: diventano un file di piano sintetico, vedi CLAUDE.md
«Plans») — non deciderla in questo passaggio (regola 3 di `CLAUDE.md`).

## 7. Commit dei meta file

Solo i file meta toccati (`STATUS.md`, `CHANGELOG.md`, eventuali `docs/**`):

```
git add STATUS.md CHANGELOG.md ...
git commit -s -m "docs: chiusura sessione del <data> — <breve riepilogo>"
```

## 8. Push

Nomina il ramo prima di pusharlo — quasi sempre `main`, dato che questa skill presuppone che
tutto il lavoro della sessione sia già stato squash-mergiato lì:

```
git push origin main
```

Non serve chiedere di nuovo "vuoi che pushi?": l'invocazione di questa skill è già quel via
libera. Se il push fallisce (rete, storia divergente da un push fatto altrove), riportalo e
proponi `./scripts/session_start.sh` per capire cosa è successo — mai un push forzato.

## 9. Conferma finale

Riporta al maintainer, in poche righe:

- cosa è stato pushato (`git log --oneline <hash-prima>..main` o l'hash finale di `origin/main`);
- che lo stato è pronto per `/riprendi` da qualunque macchina.

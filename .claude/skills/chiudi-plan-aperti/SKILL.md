---
name: chiudi-plan-aperti
description: Chiude i piani vivi di docs/plans/ uno alla volta, dal più recente al più vecchio, con una dev per ciascuno e senza aprire piani nuovi. Per ogni piano analizza cosa è fatto nel codice; se è fatto propone il collaudo e lo archivia, se manca qualcosa definisce il residuo, lo implementa, lo porta in una dev e lo collauda. Usala quando il maintainer chiede di «chiudere i plan aperti», «smaltire i piani», «finire i plan uno alla volta», o la invoca con /chiudi-plan-aperti.
---

# Chiudi i piani aperti

Richiesta del maintainer, 26-11-2026: «in ordine cronologico dal più recente al più vecchio implementa uno alla volta,
una dev per ciascuno senza aprire nuovi plan, i plan che sono ancora aperti. Parti dall'ultimo, analizzalo, se è fatto
facciamo il collaudo e archiviamolo, se è da fare definiamo cosa manca, implementa e finisci.»

La skill **guida e propone**. Le regole di `CLAUDE.md` valgono tutte: un ramo alla volta, push e tag solo su
istruzione esplicita, ssh su un dispositivo solo con il sì, VPS solo con il sì, CasaDomotica non si tocca senza il sì.

## Regole, per tutta la skill

1. **Un piano alla volta.** Il piano successivo comincia solo quando il precedente è archiviato, o il maintainer
   decide di saltarlo.
2. **Nessun piano nuovo.** Un residuo che non si chiude adesso va in un **seme** di `docs/plans/semi/` (uno che c'è
   già sul tema, altrimenti uno nuovo, con la riga nel suo `README.md`). Un'anomalia del collaudo va nel ramo `fix/`
   del piano, non in un piano.
3. **Una dev per piano.** Il piano che porta codice esce in una `X.Y.Z-dev.N` sua (`docs/HOWTO.md` §19). Un piano già
   fatto non ha bisogno di una dev nuova: si collauda sulla versione che c'è.
4. **Ultracode.** Prima di lavorare su un piano, una riga: «Ultracode: acceso / spento — conviene / non conviene,
   perché…» (regola di `CLAUDE.md`).
5. **Il testo nuovo** segue le regole del repo: codice in inglese, documenti e commit in italiano, scrittura ASD-STE100.

## 0. L'elenco

1. Se un ramo è aperto (`git branch`), chiudilo prima: è la regola «un ramo alla volta». Dillo al maintainer.
2. Leggi la tabella «I piani vivi» di `docs/plans/README.md` e i file in `docs/plans/*.md`.
3. Ordina i piani **per data del nome del file, dal più recente**. A parità di data, segui l'ordine della tabella.
4. Mostra l'elenco in una tabella breve: **piano — stato dichiarato nella tabella**. Indica il primo da prendere.
   Un piano «parcheggiato» dal maintainer: chiedi se saltarlo, non lo prendi da solo.

## 1. L'analisi del piano

1. Leggi il piano per intero.
2. Per ogni punto, misura nel codice se è fatto: `git log --grep`, i file nominati, i test, le guardie, i rami
   squashati in `main`. Non fidarti dello stato scritto nel piano: può essere vecchio.
3. Guarda `docs/COLLAUDI_IN_SOSPESO.md` e `STATUS.md`: le voci del piano già collaudate e quelle ancora aperte.
4. Presenta l'esito in una tabella **punto — fatto / da fare / superato — evidenza** e una conclusione:
   - **fatto**: tutto è nel codice; manca al più il collaudo → passo 2;
   - **da fare**: definisci il residuo in un elenco numerato, piccolo e preciso → passo 3;
   - **superato**: il codice è andato altrove; il piano si archivia con l'errore dichiarato.
5. **Aspetta il sì del maintainer** sulla conclusione e sul residuo.

Un punto breve che non vale una dev si sposta in un seme (regola «un piano quasi finito si chiude» di `CLAUDE.md`).
Lavoro vero resta nel residuo.

## 2. Piano fatto: collaudo e archivio

1. Proponi le voci di collaudo, prese dalla sezione «Verifica» del piano e dalle voci aperte in
   `COLLAUDI_IN_SOSPESO.md`.
2. Il collaudo passa dalla skill **`/test-changes`**, con il target che dà il maintainer. Un test alla volta.
3. Una voce che non si può provare si dice e si annota. Un'anomalia apre il ramo `fix/<slug>` (passo 4).
4. Quando le voci sono passate: archivia (passo 5).

## 3. Piano da fare: implementazione

1. Ramo da `main`: `feat/<slug>` o `fix/<slug>`.
2. Implementa il residuo concordato, niente di più.
3. Definition of done di `CLAUDE.md`: `cargo check`, `cargo clippy -- -D warnings`, `cargo test`, `pnpm build`,
   `pnpm exec vitest run`, `./scripts/check_static.sh`. Tutti verdi.
4. `CHANGELOG.md` sotto `[Unreleased]` e, per quello che vede chi usa il pannello, `NOVITA.yaml` (it e en).
5. Chiedi al maintainer, in una domanda sola: **«squash, dev.N e push?»**. Il sì vale per questo piano solo.
6. Dopo il sì:
   1. squash in `main`, verifica `main^{tree}` = `<ramo>^{tree}`, poi `git branch -D <ramo>`;
   2. `scripts/versione.sh --imposta X.Y.Z-dev.N`, commit `chore(dev): X.Y.Z-dev.N`, tag;
   3. push di `main` e del tag;
   4. `./scripts/build_dev.sh --arm64 --push` in background, log in `tmp/build-<versione>.out`.
7. Il gateway di sws.soligo.net si aggiorna alla dev solo con il sì del maintainer (`deploy/vps/STATO.md`, alias ssh
   `sws-vps`). Dopo, registra la versione in `deploy/vps/STATO.md` e nel quadlet del repo.
8. Collaudo come al passo 2, sulla dev.

## 4. Le anomalie del collaudo

1. Ramo `fix/<slug>` da `main`, con tutte le anomalie del collaudo insieme.
2. Definition of done, poi la domanda «squash, dev e push?» come al passo 3.
3. Un'anomalia piccola che il maintainer accetta di rimandare va in un seme, e il piano si archivia lo stesso.

## 5. L'archivio

1. `git mv docs/plans/<file>.md docs/archive/<file>.md`.
2. Togli la riga da `docs/plans/README.md` e aggiungi la riga in `docs/archive/README.md` (stato, squash, dev,
   collaudo).
3. Riscrivi i rimandi: `grep -rn "plans/<file>.md" --include=*.md .`. I rimandi nei commenti del codice si correggono
   nel ramo di codice seguente, non con un commit su `main`.
4. `docs/COLLAUDI_IN_SOSPESO.md`: la sezione «Collaudo <versione> (<data>)» con gli esiti.
5. `STATUS.md`: il blocco «▶ Riprendere da qui» con il piano chiuso, la dev e **il piano successivo dell'elenco**.
6. `./scripts/check_documenti.sh` e `./scripts/check_static.sh` verdi, poi commit meta `docs: …` con `-s`. Nessun
   push senza istruzione.
7. Torna al passo 1 con il piano successivo.

## Fine della sessione

Prima che il contesto finisca: scrivi in `STATUS.md` a quale piano dell'elenco ti sei fermato e in quale passo. La
sessione dopo riparte da lì con `/chiudi-plan-aperti`.

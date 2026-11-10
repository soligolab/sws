---
name: test-changes
description: Guida il collaudo su hardware reale (pannello con SWS, IDE nel cloud o locale) delle modifiche da provare — di solito una release già costruita con il pannello già aggiornato, a volte lavoro non ancora rilasciato. Chiede il target, ricava le voci da STATUS.md e da docs/COLLAUDI_IN_SOSPESO.md, controlla che pannello, gateway e IDE abbiano la versione giusta e propone un test alla volta, aspettando l'esito di ognuno. Alla fine spunta gli esiti in COLLAUDI_IN_SOSPESO.md e riassume in STATUS.md. Usala ogni volta che il maintainer chiede di testare, validare, verificare o collaudare modifiche o versioni, anche in modo informale: «testiamo», «collaudiamo», «validiamo su target», «proviamo sulla board», «proviamo sul pannello», «verifichiamo le modifiche», «testa la release», «valida la versione 2.25.1», «testa quello che ho rilasciato», o quando nomina un target di test (user@wp630-….local, tc620-garage). Argomenti facoltativi: /test-changes [target] [versione | tag | intervallo di commit].
argument-hint: "[target] [versione | tag | intervallo di commit]"
---

# Test changes — il collaudo sul pannello

Argomenti ricevuti: `$ARGUMENTS`

**Il caso normale in SWS**: il maintainer ha chiesto merge e release, l'immagine è su ghcr.io con
`latest-*` e `rc-*` spostati, il gateway di `sws.soligo.net` è già sulla versione nuova, e il
pannello si è aggiornato da sé o con «Aggiorna ora». **Di solito non c'è niente da installare**: si
controlla che le versioni siano quelle giuste e si collauda. Installare è l'eccezione (passo 3).

La skill **guida**: propone, fa le letture, e aspetta il maintainer a ogni passo. Non rilascia, non
pusha, non tagga e non corregge codice da sola.

## Regole, per tutta la sessione

1. **Un test per messaggio.** Dopo averlo proposto ti fermi: niente test successivo e nessun'altra
   azione finché il maintainer non risponde.
2. **Sul pannello, leggere sì e cambiare no.** Le letture via ssh le fai tu: `--stato` dello
   script, log, `systemctl --user status`, `podman ps`/`logs`/`inspect`, `curl` alla `/health`,
   `cat`/`ls`. Per tutto quello che cambia lo stato **chiedi prima**: aggiornamento o ricarica,
   restart di servizi, quadlet, file, `podman rm`/`pull`, OpenPLC, riavvio. Vale anche per i
   pulsanti che suggerisci: **«Torna alla …»** dopo un aggiornamento cancella quanto scritto dopo
   l'aggiornamento (HOWTO §21), e va detto prima di proporlo.
3. **Il target è uno, e l'ha detto il maintainer.** Darlo vale come il «sì» della regola 5 di
   `CLAUDE.md` per **quel** host in **questa** sessione. Nessun altro dispositivo, VPS compreso.
4. **`ssh-copy-id` e `ssh-keygen -R` li fa il maintainer**, mai tu (`docs/TEST_SETUPS.md`,
   «Procedura ricorrente del maintainer»).
5. **Niente modifiche al codice senza consenso** (passo 6–7 per come si corregge).
6. **Una modifica che qui non si può provare** si dice esplicitamente e si annota. Non si salta in
   silenzio.
7. **I file di lavoro vanno in `sws/tmp/test-changes/<AAAA-MM-GG>/`**, mai in `/tmp`: istantanee,
   log copiati dal pannello, misure.

## 0. Il target

- Se è negli argomenti o nel messaggio, usa quello. Se manca, **chiedilo e aspetta**, prima di
  qualunque altra azione.
- **Non riusare target trovati altrove**: sessioni precedenti, cronologia, STATUS.md,
  `docs/TEST_SETUPS.md`, memorie. Gli indirizzi cambiano a ogni sessione.
- Il target è **il pannello**, in una di due forme:
  - `utente@host` (`user@wp630-a-p3-07a077.local`) se questa macchina lo raggiunge in ssh;
  - il suo **nome nel cloud** (`tc620-garage`) se si collauda solo dall'IDE di `sws.soligo.net`.
    Niente ssh, allora: le letture sul pannello le fa il maintainer dall'IDE.
- Nel primo messaggio ripetilo per conferma: **«Target: user@wp630-a-p3-07a077.local»**.
- **SWS sul pannello gira come `user`** (podman rootless; HOWTO §10). `pixsys` è l'accesso
  privilegiato, solo di prova. Con un utente diverso da `user`, dillo nello stesso messaggio: per
  leggere va bene lo stesso, per installare serve `user@<host>`.
- **Conta la macchina, non il maintainer.** `docs/TEST_SETUPS.md` §0 dice cosa raggiunge la
  macchina su cui gira la sessione (`hostname`): da `theobroma` il WP630, da `ufficio` il TC620. Un
  pannello che da qui non si raggiunge si collauda dal cloud.

## 1. Il perimetro: cosa va provato

Le voci da provare stanno già scritte. Leggile in quest'ordine:

1. **Gli argomenti**, se il maintainer ha dato una versione, un tag o un intervallo. I tag di SWS
   sono senza `v`: `v2.25.1` vuol dire `2.25.1`.
2. **`STATUS.md`, il blocco più recente** con «Il collaudo, cosa guardare»: le voci della release
   che attende il collaudo, divise per ramo (C0, T1, T2…), con il progetto su cui provarle.
3. **`docs/COLLAUDI_IN_SOSPESO.md`**, le voci ancora `[ ]`. È un arretrato lungo: proponi solo
   quelle che riguardano la versione in prova o il pannello che hai davanti. Per le altre, chiedi.
4. **`CHANGELOG.md`** (la sezione della versione, o `[Unreleased]`) e **`NOVITA.yaml`**, per
   quello che le prime due fonti non coprono.

Se non c'è una release in attesa di collaudo e il perimetro non è chiaro, mostra gli ultimi tag e
commit e chiedi da dove partire:

```bash
git tag --sort=-creatordate | head -8
git log --oneline --decorate -15
```

Per dire di ogni modifica dov'è arrivata:

```bash
git tag --contains <sha> --sort=v:refname | head -1   # la prima versione che la contiene
git branch --show-current && git status --short       # ramo aperto, modifiche locali
```

- **rilasciata in X.Y.Z**: c'è il tag **e** l'immagine (lo script lo controlla su ghcr.io);
- **in un'immagine di prova**: solo in un tag `-rc.N`;
- **non rilasciata**: su `main` dopo l'ultimo tag, su un ramo, o modifica locale.

Se il maintainer nomina una versione che qui non c'è, il checkout è indietro: proponi
`./scripts/session_start.sh`. Mai `git pull` o `git fetch` a mano.

**Riassumi in poche righe**: le voci, ognuna con la versione che la porta e **dove si prova**: sul
pannello (schermo, web o LVGL), nell'IDE nel cloud, nell'IDE locale 8460, oppure non provabile qui.

## 2. Le versioni in campo

Un collaudo su una versione sbagliata trova difetti che non esistono. Prima di tutto, tre versioni
devono essere quelle del perimetro:

| cosa | come si legge |
|---|---|
| **il pannello** | con target ssh: `.claude/skills/test-changes/scripts/ricarica.sh <TARGET> --stato` (sola lettura). Dal cloud: la legge il maintainer in Configurazione → Istanza → Device → Stato |
| **il gateway di `sws.soligo.net`** | `grep -m1 'Versione in esecuzione' deploy/vps/STATO.md` |
| **l'IDE locale 8460**, se serve | la versione del checkout da cui gira: se è indietro, rifallo prima |

- **Lo script esce con 2 = pannello non raggiungibile: fermati e dillo**, con il rimedio che
  stampa (nome che non si risolve, chiave da installare, chiave host cambiata).
- **Il WP630 dell'ufficio si spegne la sera.** Dopo le 17:30 è normale che non risponda: non si
  indaga e non si annota come anomalia.
- **Il gateway indietro** vuol dire che il rilascio non è finito: dillo al maintainer prima di
  collaudare dal cloud. Non entri tu nel VPS senza un sì.
- **Un aggiornamento appena fatto** apre la domanda «Dopo l'aggiornamento» (HOWTO §21). Lasciala
  aperta finché il collaudo non è finito: è il ritorno alla versione di prima, se serve.

Se tutto è allineato, salta al passo 4.

## 3. Se il pannello non ha la versione giusta

Chiedi al maintainer quale strada prendere. Sono tre, in ordine di preferenza.

**a. L'aggiornamento del pannello** — per una release o una `-rc` già su ghcr.io. È la strada
normale: IDE (nel cloud o locale) → Configurazione → Istanza → Device → Connessione →
«Aggiornamento del runtime» → **«Aggiorna ora»**. Tiene il canale, prende l'istantanea dei dati
per poter tornare indietro, ed è quello che fa un cliente. Lo fa il maintainer, e diventa il primo
test.

**b. La reinstallazione con lo script** — quando la strada *a* non c'è (pannello non collegato a un
IDE, aggiornamento guasto):

```bash
.claude/skills/test-changes/scripts/ricarica.sh <TARGET> --versione 2.25.1
.claude/skills/test-changes/scripts/ricarica.sh <TARGET> --canale rc       # oppure latest
```

Fa quello che fa l'IDE in Device → Installazione e conserva cartella dati, rete e scelta sul cloud.
**Due differenze dall'aggiornamento**: non prende l'istantanea dei dati (non si torna indietro con
«Torna alla …»), e `--versione` toglie il pannello dal suo canale. Prima `--prova`, che mostra il
comando senza lanciarlo. Dura minuti: `timeout: 600000` o in background.

**c. La build locale** — solo per provare lavoro **non rilasciato** senza pubblicare niente. È la
sequenza di `docs/HOWTO.md` §10, **niente `--push`**:

1. Che non stia girando un'altra build: `ps -eo pid,args | grep '[b]uild_container'`.
2. Metti da parte l'archivio della release con la stessa versione, che la build sovrascriverebbe:
   ```bash
   V=$(grep -m1 '^version' sws-runtime/Cargo.toml | cut -d'"' -f2)
   mv "dist/sws-runtime-$V-aarch64-image.tar.gz" "dist/sws-runtime-$V-aarch64-image.tar.gz.rilascio" 2>/dev/null || true
   ```
3. `./scripts/build_container.sh` in background. **Mentre gira non si tocca niente nel checkout.**
4. `.claude/skills/test-changes/scripts/ricarica.sh <TARGET> --archivio dist/sws-runtime-$V-aarch64-image.tar.gz`
5. Rimetti a posto l'archivio:
   `mv "dist/sws-runtime-$V-aarch64-image.tar.gz.rilascio" "dist/sws-runtime-$V-aarch64-image.tar.gz"`

Il pannello mostrerà il numero della release, non quello del codice: nell'esito scrivi il commit.
Un'immagine `-rc` pubblicata (HOWTO §19) chiede un push e un tag: solo su istruzione esplicita.

Dopo *a*, *b* o *c*, rileggi la versione (passo 2) e conferma l'esito.

## 4. Il piano

Un elenco ordinato di **soli titoli**:

1. per prime le voci rimaste aperte dal collaudo precedente di questa stessa release;
2. «parte e risponde»: l'aggiornamento è andato, il servizio è attivo, il progetto si apre;
3. poi le voci, dalla più critica alla più specifica.

Nello stesso messaggio, sotto l'elenco, proponi il test 1.

## 5. Un test alla volta

```
**Test N/M — <titolo>**
- Obiettivo: <cosa valida> — <voce di STATUS o di COLLAUDI_IN_SOSPESO, versione>
- Dove: pannello (web/LVGL) | IDE nel cloud | IDE 8460, e su quale progetto
- Passi: <comandi esatti, oppure le azioni da fare>
- Atteso: <cosa deve succedere, in modo che si possa dire sì o no>
```

Se una parte dei passi è fatta di letture che puoi fare tu, falle e metti l'output nel messaggio.
Comandi utili sul pannello, come `user`:

```bash
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status sws-runtime sws-lvgl-viewer --no-pager
XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u sws-runtime -n 100 --no-pager
podman logs --tail 100 sws-runtime
```

**Poi fermati e aspetta.**

## 6–7. La risposta

- **Superato** → il test successivo.
- **Fallito** → prima di proseguire, aiuta a capire la causa: log, codice della modifica,
  differenza fra atteso e visto. Controlla anche che non sia una versione indietro (passo 2). Poi
  chiedi: **correggere subito, o annotare e andare avanti?**
- **Ambiguo** → una domanda mirata, una sola.

**Come si corregge in SWS.** Le anomalie di un collaudo si correggono **insieme**, su un ramo da
`main` (regola «Un ramo alla volta»), e diventano la patch successiva — come `814cbdd1`, «tre
anomalie del collaudo 2.25.0», uscita nella 2.25.1. «Correggere subito» vuol dire aprire quel ramo
adesso; il collaudo delle altre voci prosegue sull'immagine che c'è, e la correzione si collauda
sull'immagine della patch.

## 8. Riepilogo e registrazione

Alla fine, un riepilogo:

- target, e da dove si è collaudato (ssh, cloud, IDE 8460);
- versione del pannello, del gateway e dell'IDE;
- voci provate con esito; voci saltate, e perché; voci non provabili qui;
- anomalie aperte;
- modifiche fatte durante la sessione (commit), o «nessuna»;
- funzioni visibili nuove di questa release che non sono ancora in **CasaDomotica** (regola di
  `CLAUDE.md`): solo da segnalare.

Poi **chiedi conferma per registrare.** Dopo il sì:

1. **`docs/COLLAUDI_IN_SOSPESO.md`**: spunta `[x]` le voci passate, con la frase nello stile già in
   uso (**«confermato dal maintainer il GG-MM-AAAA»**). Quelle che non passano restano `[ ]` con
   **«GG-MM-AAAA: non passa — …»**. Le voci venute da STATUS.md che restano aperte vanno in una
   sezione nuova, **«Collaudo X.Y.Z (GG-MM-AAAA)»**, così non si perdono quando il blocco di STATUS
   viene superato.
2. **`STATUS.md`**, nel blocco «▶ Riprendere da qui» corrente: una riga con l'esito
   (**«Collaudo 2.25.1 del GG-MM su <pannello>: N passate, M anomalie»**) e le anomalie, che sono
   l'elenco di lavoro della prossima patch.
3. Un dettaglio piccolo che non è un'anomalia va in un **seme** di `docs/plans/semi/` (uno esistente
   se il tema c'è già, altrimenti nuovo, con la riga in `docs/plans/semi/README.md`), con il contesto
   scritto per intero. `Appunti.txt` non esiste più dal 10-11-2026 e non si ricrea.
4. **Commit meta**, con i soli file toccati e **nessun push**:
   ```bash
   git add docs/COLLAUDI_IN_SOSPESO.md STATUS.md
   git commit -s -F - <<'EOF'
   docs(collaudo): 2.25.1 su <pannello> — <esito breve>
   EOF
   ```
   Heredoc quotato: un backtick nel messaggio la shell lo eseguirebbe.

Se il collaudo copriva un ramo non ancora mergiato e tutto è passato, dillo: è la conferma del
maintainer che la *definition of done* chiede prima dello squash merge. Il merge resta un passo a
parte.

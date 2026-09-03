# `session_start.sh` — cosa lanciare prima di riprendere il lavoro

*2026-09-02, frodo. Sostituisce il piano precedente (divisione editor/runtime), che è **completo,
mergiato e rilasciato** nella 2.4.0 — la sua traccia vive in `docs/plans/2026-09-01-editor-runtime.md`,
in `docs/adr/0003-editor-runtime-same-binary.md` e in `STATUS.md`.*

---

## Contesto

Il maintainer lavora da tre macchine — frodo (server di sviluppo), l'ufficio e casa — e ogni
ripresa comincia con lo stesso rito manuale: capire su che ramo sei, se sei in pari con origin,
cosa hai di locale, e da dove ripartire. Oggi quel rito è andato storto due volte nella stessa
sessione, e in due modi che `git pull` non sa raccontare:

1. **`main` divergente con un commit locale.** All'ufficio era `c519838`, che aggiungeva
   `docs/plans/2026-08-31-T50-chat-ai-esecutivo.md` — un file che su `origin/main` c'era già,
   arrivato dentro il merge di T-50 con un hash diverso. Era la versione **pre-riscrittura** dello
   stesso lavoro. `git pull` si è fermato chiedendo come riconciliare, e nessuna delle tre risposte
   che suggerisce era quella giusta: merge e rebase avrebbero portato dentro il doppione.
2. **Undici tag rifiutati.** `git fetch --tags` li ha lasciati puntati alla storia vecchia
   («sovrascriverebbe il tag esistente»), quindi `git describe` e `git show <tag>` su quella
   macchina mostravano commit che su GitHub non esistono più. Serve `--force`, e il problema si
   vede **solo sui tag vecchi**: quelli nuovi passano senza, quindi è facile crederlo risolto.

Nessuno dei due si diagnostica con un comando ovvio, ed entrambi ricapiteranno alla prossima
macchina ferma da prima del 2026-08-31 — casa è la prossima. La procedura è stata scritta in
`STATUS.md` (commit `c8cd001`), ma una procedura da rileggere e ridigitare a mano è una procedura
che si sbaglia.

**L'esito atteso**: un comando che dice in che stato è la macchina, propone il rimedio giusto per
ciascun caso comune, e chiude dicendo da dove si riprende — senza mai poter perdere lavoro.

---

## Il fatto tecnico su cui si regge tutto

`git diff --stat <A> <B>` **vuoto** significa che i due alberi sono identici, byte per byte.
Applicato a `origin/main` e `main`, distingue i due casi che hanno lo stesso aspetto in
`git status`:

| `git diff origin/main main` | Cosa significa | Cosa si può offrire |
|---|---|---|
| vuoto | i commit locali **non aggiungono niente**: sono la versione pre-riscrittura di lavoro già su origin | `reset --hard`, con la prova mostrata |
| non vuoto | i commit locali portano contenuto che origin non ha | **solo** un ramo di salvataggio; nessun reset |

È più forte del confronto per-file che abbiamo fatto a mano all'ufficio (`git rev-parse
main:<file>` contro `origin/main:<file>`): quello prova un file, questo prova l'albero intero, e
non richiede di sapere quale file guardare.

Verificato: `git diff --stat origin/main main | wc -l` dà `0` con i rami allineati e `2` fra il tag
`2.4.0` e `main` (un commit di documentazione).

---

## Cosa fa, nell'ordine — e l'ordine conta

`scripts/session_start.sh`. **Non** `check_*.sh`: quel prefisso è riservato alle guardie, e
`check_static.sh` fallisce se ne trova una non classificata nei suoi due elenchi.

1. **Chi sono e dove sono.** `hostname`, utente, percorso del repo, ramo corrente. Va per primo
   perché il rischio numero uno di questo progetto è il contesto perso *fra le macchine*: leggere
   «ufficio» in testa all'uscita evita di credere di essere su frodo.
2. **`git fetch --prune`.** Senza, ogni confronto sotto misura dati vecchi. Se la rete non c'è, lo
   **dice** e continua sui remote-tracking ref esistenti, dichiarando che il confronto può essere
   stantìo — un confronto silenziosamente vecchio è peggio di nessun confronto.
3. **Albero di lavoro.** Se è sporco, elenca i file e **non offre più niente che lo tocchi**
   (checkout, ff-merge, reset restano fuori). Il resto della diagnosi continua.
4. **Ramo corrente contro il suo upstream** — avanti/indietro con
   `git rev-list --left-right --count`.
5. **`main` contro `origin/main`**, con il verdetto della tabella sopra.
6. **Tag divergenti.** Confronto fra `git ls-remote --tags origin` (righe senza `^{}`) e
   `git show-ref --tags`: nome uguale, sha diverso. Verificato che qui dia zero e che il meccanismo
   trovi i divergenti.
7. **I rami locali**, con upstream e data (`git for-each-ref`). Quelli **senza upstream** sono i
   sospetti: all'ufficio sono `feat/scada-f6` e `feat/scada-f7`, anteriori alla riscrittura.
8. **Controlli pre-lavoro**: `sws-editor/node_modules` presente (serve alle build dei container,
   che compilano la SPA da sé), `pnpm` e `cargo` nel PATH, e i **quattro** file che dichiarano la
   versione coerenti fra loro (`sws-runtime/Cargo.toml`, `sws-editor/package.json`, i `Cargo.toml`
   di `sws-kiosk` e `sws-lvgl-viewer`) — un disallineamento lì è il difetto che la 2.3.4 ha già
   dovuto correggere una volta.
9. **Da dove ripartire**: versione, `git describe`, e la prima sezione di `STATUS.md` sotto
   «Da fare nella prossima sessione» (titolo + prime righe). **Va stampata alla fine**, dopo le
   azioni: se il pull ha portato uno STATUS nuovo, quello che si legge deve essere il nuovo.

---

## I casi comuni, e cosa propone per ciascuno

Una conferma per caso (`read -r -p "... [y/N]"`), come fa già `scripts/clean_disk_space.sh`;
`-y` le salta tutte. Ogni comando viene **stampato prima di essere eseguito**, così si vede cosa
sta accadendo invece di fidarsi.

| Stato | Cosa propone |
|---|---|
| non sei su `main` (e albero pulito) | `git checkout main` |
| solo indietro | `git merge --ff-only origin/<ramo>` — non `git pull`, che su una divergenza tenterebbe un merge |
| solo avanti | **niente**: dice quanti commit non sono pushati e si ferma lì |
| divergente, albero identico | `git reset --hard origin/<ramo>`, mostrando prima il diff vuoto come prova |
| divergente, contenuto locale vero | `git branch salvataggio-<host>-<data>` e **basta**; dice esplicitamente che il reset non viene offerto e perché |
| tag divergenti | `git fetch --tags --force` |
| `node_modules` assente | `cd sws-editor && pnpm install` |

**Perché il push non c'è.** La regola 1 di `CLAUDE.md` dice che non si pusha senza un'istruzione
esplicita nella sessione corrente. Uno script che lo offre in un `[y/N]` la aggirerebbe di fatto:
la conferma non è un'istruzione, è un riflesso. Lo script quindi **riferisce** i commit non pushati
e non tocca origin. Per la stessa ragione non cancella rami — la pulizia è del maintainer.

---

## Le invarianti, che sono la ragione per cui è sicuro

Vanno scritte in testa allo script, non solo qui:

- **non pusha mai** e **non cancella mai un ramo**;
- **nessun `reset --hard`** se `git diff origin/<ramo> <ramo>` non è vuoto;
- **niente che tocchi l'albero** se l'albero è sporco;
- ogni comando eseguito è stampato prima;
- se `fetch` fallisce, lo dice e non finge di aver confrontato.

`-y` accetta solo ciò che lo script avrebbe **comunque** offerto: la prova sull'albero resta
condizione necessaria, quindi `-y` non può far scattare un reset su commit che portano contenuto.

---

## La guardia, perché il percorso distruttivo se la merita

`scripts/check_session_start.sh`, classificata fra le **STATICHE** di `check_static.sh`: non
serve nessuno stack in ascolto, nessuna rete e nessun dispositivo — solo `git` in una directory
temporanea.

Fabbrica una coppia repo/finto-origin nel temporaneo e ricostruisce i cinque stati, poi verifica il
**verdetto** dello script (con `-y` e uscita catturata):

1. in pari → nessuna azione;
2. solo indietro → fa il fast-forward;
3. solo avanti → **non** tocca niente e nomina i commit non pushati;
4. divergente con albero identico (il caso dell'ufficio: si ricrea committando lo stesso contenuto
   con un messaggio diverso) → resetta, e il commit locale spariesce;
5. divergente con contenuto vero → **non** resetta, crea il ramo di salvataggio, e il commit locale
   è ancora raggiungibile.

Il caso 5 è quello che conta: è la prova che un difetto qui non può perdere lavoro. E il verso
rotto da provare a mano una volta è togliere la condizione sul diff vuoto, per vedere il caso 5
diventare rosso.

**Mai provarlo sul repo vero.** Un test che manufatti una divergenza in `~/sws` per poi resettarla
è esattamente il modo di perdere il lavoro che questo script esiste per proteggere.

---

## File

- `scripts/session_start.sh` — nuovo, ~200 righe.
- `scripts/check_session_start.sh` — nuovo, la guardia.
- `scripts/check_static.sh` — una riga nell'elenco `STATICHE`.
- `scripts/README.md` — una sezione, nella forma delle altre (`## session_start.sh — …`), che dica
  **quando** si lancia e che rimanda alla nota sulla riscrittura in `STATUS.md`.
- `CLAUDE.md` §«Session start» — una riga: prima dei tre documenti, lancia questo.

---

## Verifica

```bash
./scripts/check_session_start.sh     # i cinque stati, in un repo temporaneo
./scripts/check_static.sh            # deve restare verde e contare la guardia nuova
./scripts/session_start.sh           # su frodo, che è in pari: deve dire «in pari» e nient'altro
./scripts/session_start.sh -y        # idem, senza domande
```

La prova che conta non è su frodo, dove tutto è allineato: è **a casa**, dove con ogni probabilità
si presentano insieme la divergenza pre-riscrittura e i tag rifiutati. Lì lo script va lanciato
**senza `-y`** la prima volta, per leggere cosa propone prima di accettarlo — e se il verdetto sul
commit locale non è «albero identico», la risposta giusta è `n` e una parola con me.

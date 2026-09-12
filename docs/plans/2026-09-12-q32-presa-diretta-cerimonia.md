# Q32 — Modificare il progetto di un impianto in presa diretta: serve più cerimonia?

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q32) il 2026-09-12, aperta il 2026-09-02,
> riverificata il 2026-09-06 (la premessa era superata dal cambiamento nello stesso giorno).
> Presenta la domanda ristretta, non la decide. Rileggere la scheda originale (e Q31, che
> tocca lo stesso terreno) prima di procedere.

## Il problema, ristretto dalla riverifica del 2026-09-06

Con l'IDE sulla porta admin di un dispositivo, il Salva modifica il progetto **dell'impianto in
servizio** in presa diretta, con hot-reload immediato — senza riavvio né conferma. La domanda
originale temeva che questo fosse il comportamento di *ogni* dispositivo spedito.

**Non è più così dal 2026-09-02**: tutti i deploy (Yocto, generic-linux, container) partono con
`--no-admin` di default — niente IDE, niente modifica del progetto sul dispositivo. Riaccenderlo
richiede `SWS_ENABLE_IDE=1` nell'env del servizio e un riavvio: un passo esplicito, compiuto da
chi ha accesso al dispositivo, non da chi ha il browser aperto.

## La domanda che resta, ristretta a due casi

1. **Il dispositivo con `SWS_ENABLE_IDE=1`** — chi l'ha acceso sa cosa sta facendo. Basta il
   marcatore in testata già presente, o serve altro (una conferma alla prima modifica,
   un'ulteriore cerimonia)?
2. **`start_runtime.sh` in locale** — lo strumento di sviluppo del maintainer, dove la presa
   diretta è il punto stesso di usarlo. Probabilmente non vuole cerimonia.

## Opzioni dalla scheda originale (nessuna scelta ancora)

1. **Presa diretta = normale**, come oggi con il solo marcatore in testata. Zero lavoro.
2. **Presa diretta = deliberata**: un passo esplicito (conferma alla prima modifica, o un
   interruttore) prima di poter modificare un'istanza che serve un impianto.
3. **Presa diretta = sola lettura per default**: si modifica sempre via pull sull'editor locale,
   poi si ridistribuisce. Cambia il modo di lavorare del maintainer.
4. **Per ruolo**: Supervisor può, altri no — ma il ruolo non descrive la situazione (un Admin in
   ufficio su una copia e un Admin in campo su un impianto sono la stessa cosa per l'auth).

**Default per il PoC**: opzione 1, stato attuale.

## Prossimo passo

Chiedere al maintainer se il caso 1 (dispositivo acceso apposta con `SWS_ENABLE_IDE=1`) merita
altro oltre al marcatore — è l'unica parte della domanda originale rimasta viva dopo la
riverifica.

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q32 — Dove deve vivere il progetto che si sta modificando?

### ⚠ Riverificata il 2026-09-06: la premessa è superata, e questo sposta le opzioni

La scheda dice che si modifica il progetto dell'impianto in presa diretta con «l'IDE sulla porta
admin di un dispositivo (`start_runtime.sh`, e **tutti** i deploy che si spediscono: yocto,
generic-linux, container)». **Oggi non è più così**, e il cambiamento è del **2026-09-02** — lo
stesso giorno in cui questa domanda è stata scritta, il che spiega perché non se ne tiene conto.

Verificato su tutti e tre i percorsi di deploy: partono con **`--no-admin`**
(`deploy/generic-linux/sws-runtime-launch.sh`, `deploy/yocto/sws-runtime-launch.sh`, i tre
`Containerfile`). E `--no-admin` non è un dettaglio di porte:

> «Cade l'IDE — nessuna interfaccia servita, **nessuna modifica del progetto sul dispositivo**,
> nessun `/api/script/exec`, nessun `/api/fs/*`. […] Per riaccendere l'IDE completo su questo
> dispositivo — messa in servizio, assistenza — basta `SWS_ENABLE_IDE=1` nell'env del servizio e un
> restart.»

Quel che resta sulla porta admin è la sola gestione remota che l'editor chiama (deploy, pull,
backup, utenti, datastore), autenticata.

**Perché sposta le opzioni.** L'opzione 2 — «presa diretta = deliberata, serve un passo esplicito»
— è in buona parte **già realizzata**, ma un livello più sotto di dove la scheda la cerca: non una
conferma nell'interfaccia, bensì una variabile d'ambiente sul servizio e un riavvio. È un passo
molto più esplicito di una finestra di conferma, e lo compie chi ha accesso al dispositivo, non chi
ha il browser aperto.

Ne segue che la domanda si restringe a due casi, e vale la pena riscriverla così:

1. **Il dispositivo con `SWS_ENABLE_IDE=1`** — chi l'ha acceso sa cosa sta facendo. Serve altra
   cerimonia oltre al marcatore in testata già aggiunto? Probabilmente no, ed è l'opzione 1.
2. **`start_runtime.sh` in locale**, che l'IDE ce l'ha sempre — è lo strumento di sviluppo del
   maintainer, e lì la presa diretta *è* il punto.

Cioè: la configurazione rischiosa che la scheda temeva — un impianto in servizio con l'IDE aperto
per default — **non viene più spedita**. Resta da decidere solo se il caso «acceso apposta» voglia
qualcosa in più.

*(Nessuna decisione presa qui: cambiano i fatti, non la scelta.)*



**Context**: emerso il 2026-09-02 da una domanda del maintainer («l'editor lavora in locale o
direttamente nella cartella del dispositivo?»). La risposta è **entrambi, e dipende da quale porta
si entra** — e la domanda non è mai stata posta come tale: la risposta di fatto era sepolta in un
aggiornamento di Q31. I fatti sono in `docs/adr/0003-editor-runtime-same-binary.md`; in breve, il
server non tiene nessun `Project` in memoria e il Salva riscrive i file **sul filesystem del
processo a cui la SPA è collegata**, quindi:

- **IDE sulla porta admin di un dispositivo** (`start_runtime.sh`, e *tutti* i deploy che si
  spediscono: yocto, generic-linux, container): si modifica il progetto dell'impianto **in presa
  diretta**, e il Salva fa hot-reload di sorgenti, allarmi e tag senza riavvio né conferma.
- **IDE su un PC** (`start_editor.sh`, pacchetto portabile): cartella locale e separata; il
  dispositivo ne ha una copia, sincronizzata solo a bundle interi (deploy push / export pull).

Nessuno dei due è sbagliato: il primo serve in messa in servizio e in assistenza, il secondo è il
flusso di progettazione. La domanda è **quale sia la via normale e quale l'eccezione**, perché da
quella risposta dipende quanta cerimonia mettere attorno alla prima. Il 2026-09-02 il maintainer ha
deciso la sola metà UI («resta com'è, ma lo dice»: c'è un marcatore in testata quando l'istanza
serve un impianto). Questa domanda è l'altra metà.

**Options**:
1. **Presa diretta = normale.** Come oggi, col marcatore già aggiunto. Zero lavoro; chi lavora su
   un impianto in servizio è avvisato ma non ostacolato.
2. **Presa diretta = deliberata.** Modificare il progetto di un'istanza che serve un impianto
   richiede un passo esplicito (una conferma alla prima modifica, o un interruttore in
   configurazione). Costa poco e rende difficile la cosa irreversibile per distrazione; il prezzo è
   una frizione in più proprio quando si è sul posto con poco tempo.
3. **Presa diretta = solo lettura per default**, e per modificare si fa un pull sull'editor locale,
   si modifica e si ridistribuisce. Coerente con «il progetto si progetta, non si tocca in campo»,
   ma cambia il modo di lavorare del maintainer e richiede che il pull sia comodo.
4. **Distinguere per ruolo**: Supervisor può modificare in presa diretta, chi ha meno no. Oggi la
   soglia di scrittura dei sinottici è già Supervisor, quindi è a portata — ma il ruolo non
   descrive la situazione (un Admin in ufficio su una copia e un Admin in campo su un impianto sono
   la stessa cosa per l'auth).

**Default for PoC**: opzione 1 (stato attuale, più il marcatore aggiunto il 2026-09-02).

**Decided**: not yet.

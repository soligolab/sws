# Cosa sta succedendo nell'IDE: chi esegue, cosa è andato storto, e quanto parla

> **Piano d'esecuzione — tutti e cinque i punti fatti il 28-10-2026**, da collaudare sul campo.
> Nato il 28-10-2026 da un'ora persa a
> inseguire un difetto che non c'era, e da tre osservazioni che il maintainer ha fatto subito dopo.
> Le quattro cose stanno in un piano solo per sua richiesta: «non aprire piani diversi, sistemiamo
> tutto in uno unico». Hanno in comune il difetto di fondo — **l'IDE sa delle cose e non le dice**.

## L'ora persa, perché è il metro di tutto il resto

Il maintainer apre il progetto `CasaDomotica_WP630` nel cloud e usa «Sfoglia broker» su
`192.168.0.203`, il mosquitto del suo portatile in ufficio. Risultato: **0 topic**, in quattro o
cinque secondi, senza un errore.

Abbiamo misurato, nell'ordine: che la delega al pannello funziona (`/api/remote/…`, 200); che il
pannello risponde un elenco vuoto; che su quel broker ci sono sei messaggi `retain` che chiunque
si iscriva a `#` riceve all'istante; che la funzione `browse()` eseguita a mano da `theobroma`
contro lo stesso broker restituisce quei sei topic in dieci secondi pieni. Tutto sano.

La risposta era nel log del container del cloud:

```
11:55:48  INFO  connected to remote runtime  →  https://sws.soligo.net/dev/tc620-garage
```

**L'IDE era collegato al TC620, a casa.** La ricerca partiva da lì, e il portatile dell'ufficio
da casa non si vede. Zero topic era la risposta giusta alla domanda che l'IDE stava davvero
facendo — solo che nessuno poteva saperlo.

Prima di quello, nello stesso log, la ragione per cui era finito sul TC620:

```
10:57:36  WARN  ws relay: collegamento rifiutato — il runtime remoto ha rifiutato: 401
          wss://sws.soligo.net/dev/wp630-ufficio/ws/tags?token=…
```

**Un 401 sul relay verso il WP630**, ripetuto. È anche la spiegazione dei WebSocket falliti che
il maintainer vedeva in console quella mattina, e che avevamo attribuito a Traefik.

## 1. Chi esegue una scoperta — **FATTO il 28-10-2026**

`config/sorgenti/EseguitoDa.tsx`: accanto al titolo di ogni scoperta si legge **«eseguito da
tc620-garage»**, o «eseguito su questa macchina» quando non c'è un pannello collegato. Il nome
viene dall'URL del cloud (`…/dev/<pannello>`), come già fa la pagina Prestazioni.

Messo nei quattro modali che passano da `suImpianto`: MQTT, OPC-UA, Euromap, Home Assistant.
Quattro prove su `usaChiEsegue`, che provano il **nome** e non la frase tradotta.

## 2. Il dispositivo collegato si vede dalla schermata principale — **FATTO il 28-10-2026**

Idea del maintainer, stesso giorno: «nella schermata principale, dove c'è scritto Deploy, si
potrebbe evidenziare il dispositivo a cui si è connessi».

Prima lo stato del pannello collegato viveva in `RuntimeCtrl` e nella scheda Istanza → Device →
Connessione: due posti dove si va *apposta*. In barra c'era il pallino verde del pulsante Deploy,
che dice «collegato» e non dice **a chi**.

`components/DispositivoCollegato.tsx`: una pastiglia verde **🖳 nome**, subito prima di Deploy.
Il nome viene da `usaPannelloCollegato()` (`src/pannelloCollegato.ts`), lo stesso modulo che
serve il punto 1 — estratto da `EseguitoDa.tsx` proprio perché ora i lettori sono due.

Le due domande, sciolte:

- **Si mostra solo il pannello collegato**, non quelli abbinati. Quelli sono un elenco e vivono
  nella scheda Connessione; in barra serve l'unico nome che cambia il risultato di quello che si
  sta per fare.
- **È cliccabile** e porta alla scheda Connessione. Non sta *dentro* il pulsante Deploy perché
  quel clic scollega, e un bottone dentro un bottone non è HTML valido.

## 3. Errori e avvisi del log si vedono **senza aprire il log** — **FATTO il 28-10-2026**

Parole del maintainer: «se compaiono errori sarebbe utile avere una segnalazione a fianco al
simbolo di fulmine per aprire subito il log sull'errore (idem per il warning), ora i log sono
nascosti se uno non apre il menù apposito e gli errori non si vedono subito».

**Com'è oggi.** In barra c'è già un pastiglia `⚡ N` (`components/RuntimeCtrl.tsx:115`) che conta
gli **avvisi del runtime** — script che non partiranno, acquisizione ferma — e diventa `⚠` rossa
se fra quelli c'è un errore. Ma il **log** è un'altra cosa: sta in un cassetto
(`components/LogPanel.tsx`) che si apre dal menu ☰, e la scelta è dichiarata in `App.tsx:103`:

> «the toggle moved into the ☰ menu — it is a diagnostic, not a per-minute control»

**È quella frase che questo punto rovescia.** Un errore non è una diagnostica che si va a
cercare: è una cosa che deve venirti incontro. Oggi un `ERROR` nel log del runtime può passare
inosservato per ore — ed è successo oggi stesso, col 401 del relay.

**Com'è adesso.** `components/SpiaLog.tsx`: una pastiglia **≡ N** accanto al fulmine, rossa se
fra le righe c'è un `ERROR`, ambra se sono solo `WARN`. Il conto sta nello store
(`logNonVisti`), il clic apre il cassetto **sulla riga** e la illumina (`LogPanel` ha preso la
prop `vaiA`, e ogni riga un `data-ts`). Cinque prove in `tests/spiaLog.test.ts`.

Le tre domande, sciolte:

- **Due pastiglie, non una.** Sono famiglie diverse: `⚡` conta avvisi **di stato** del runtime,
  ognuno col suo rimedio scritto accanto; `≡` conta **righe di log**, che rimedio non ne hanno.
  Sommarle darebbe un numero che non vuol dire niente.
- **Si conta da quando si è guardato il log l'ultima volta**, e solo quello che arriva **dal
  vivo** dal socket. L'istantanea iniziale di `GET /api/logs` non accende niente: è la storia di
  prima, e una spia accesa all'apertura dell'IDE per una riga di ieri diventa subito rumore.
- **Si azzera aprendo il cassetto**, e resta a zero finché è aperto — lo si sta guardando.

Resta fuori: la finestra di log staccata è un documento suo, con il suo store, e non azzera la
spia della finestra principale.

## 4. Il log dice molto e non dice abbastanza — **FATTO il 28-10-2026**, e aperto per sempre

Parole del maintainer: «il log andrebbe esteso, ci sono molte informazioni ma mancano altrettante
informazioni utili».

Due buchi li abbiamo trovati oggi sul campo, e vale la pena partire da lì perché sono misurati:

- **`browse()` non aveva un solo log sul percorso buono** (`sws-plugin-mqtt/src/lib.rs`): c'era
  un `warn!` sull'errore e basta. Ora tre `info`: «mi collego» (host, porta, client id, secondi),
  «collegato, mi iscrivo a #», «finito: N topic in M secondi».
- **Nessuno diceva su quale pannello sta girando una richiesta remota.** `inoltra_al_pannello`
  (`sws-web/src/remote.rs`) ora scrive pannello, percorso e metodo prima di inoltrare.

E, cercandoli, se n'è trovato un terzo della stessa forma:

- **`browse_one_level` di OPC-UA era muto esattamente come quello MQTT**
  (`sws-plugin-opcua/src/lib.rs`). Stesse tre righe: endpoint e nodo di partenza, «collegato»,
  «finito: N nodi in M secondi».

**Il punto resta aperto, per costruzione.** Quali altri percorsi siano muti non lo dice una
lettura del codice: lo dice la **prossima diagnosi in cui si è dovuto indovinare**. Quando
succede, la riga di log si aggiunge lì per lì e si annota qui sotto.

| data | dove si è dovuto indovinare | rimedio |
|---|---|---|
| 28-10-2026 | «Sfoglia broker» MQTT tornava 0 topic senza una riga di log | tre `info` in `browse()` |
| 28-10-2026 | niente diceva verso quale pannello andasse una richiesta remota | `info` in `inoltra_al_pannello` |
| 28-10-2026 | il browse OPC-UA, trovato muto mentre si sistemava quello MQTT | tre `info` in `browse_one_level` |

## 5. L'IDE martella il server di richieste — **FATTO il 28-10-2026**

Trovato guardando la scheda Network per tutt'altro motivo. Da una sola scheda del browser, sul
progetto aperto nel cloud:

```
…&to=1793186750591   ← ~35 richieste /api/history/…
…&to=1793186752591   ← +2 s, la stessa raffica
…&to=1793186754592   ← +2 s, di nuovo
```

**Circa 17 richieste al secondo**, per sempre, finché la pagina resta aperta. Alcune chiedono
**24 ore** di storico (`from=1793100350593`) ogni due secondi. Sono i trend della pagina
SystemInfo che rileggono invece di ricevere.

Perché sta in questo piano e non in uno suo: Chrome tiene **sei** connessioni per host, e quelle
raffiche se le mangiano. È un candidato serio per i WebSocket che faticano e per la lentezza
dell'IDE nel cloud — cioè per le stesse cose che i punti 3 e 4 servono a vedere.

**Com'è adesso.** Due regole in `canvas/TrendCanvas.tsx`, nessuna delle due col backend di mezzo:

- **`periodoPolling(pollMs, windowS, larghezzaPx)`**: il pavimento resta il `pollMs` chiesto da
  chi ha configurato il widget, il soffitto è il tempo che vale **un pixel** del grafico, con un
  tetto di un minuto perché oltre quello un trend fermo sembra rotto. Ventiquattro ore su 600 px
  valgono 144 secondi al pixel: il `pollMs` di 2 s chiedeva **settantadue volte** gli stessi
  dati, e adesso ricarica una volta al minuto. Cinque prove in `tests/periodoPolling.test.ts`.
- **A scheda nascosta non si chiede niente** (`document.hidden`), e al ritorno si ricarica
  subito. Una scheda in secondo piano mangiava connessioni come quella davanti.

Quello che **non** si è fatto, e andrà visto se il flusso resta pesante: chiedere solo i campioni
nuovi invece di rileggere la finestra intera (è il «rileggono invece di ricevere» del titolo), e
una richiesta sola per più tag invece di una per tag. Entrambe vogliono il backend.

È parente di [tag uguali ritrasmessi](2026-10-17-tag-uguali-ritrasmessi.md), che è della stessa
famiglia: dati rimandati quando non serve.

## Fuori da questo piano, ma non dimenticato

**Il 401 del relay verso `wp630-ufficio`.** È un difetto a sé e più urgente di tutti questi:
finché c'è, dal cloud quel pannello non si comanda. Non è un problema di visibilità — è una
credenziale rifiutata — e va inseguito per conto suo.

## Verifica

Le cinque voci di `CLAUDE.md` — **tutte verdi il 28-10-2026** (`cargo check`, `pnpm build`,
`check_static.sh` 51 guardie, `cargo test`, `vitest` 1725 prove). Resta la conferma sul campo:

- **punto 1**: aprire una scoperta con un pannello collegato e leggere il suo nome nel titolo;
- **punto 2**: collegarsi a un pannello e vedere il suo nome accanto a Deploy; scollegarsi e
  vederlo sparire; cliccarlo e finire sulla scheda Connessione;
- **punto 3**: provocare un errore nel log (basta una sorgente che non si collega) e vedere la
  pastiglia accendersi senza aprire niente; cliccarla e trovarsi **su quella riga**;
- **punto 4**: rifare lo «Sfoglia broker» che è costato l'ora e leggere nel log dove è andato;
- **punto 5**: riaprire la scheda Network sul progetto nel cloud e contare le richieste
  `/api/history`. È l'unica misura che dice se il punto è chiuso davvero.

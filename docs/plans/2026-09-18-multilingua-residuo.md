# Multilingua: le due cose che restano

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.

## Cosa è già fatto, e perché queste due non lo sono

Il multilingua di progetto è stato realizzato e rilasciato nella **2.8.0**, e il parco template è
completo in tre lingue dal 17-09. Quello che resta di queste due schede **non è codice mancante:
sono due decisioni di prodotto** che il lavoro ha lasciato scoperte, e che il maintainer credeva
ormai chiuse.

| | Cosa resta davvero |
|---|---|
| **Q43** | *(1)* quale fornitore di traduzione è quello **giusto per un allarme d'impianto** — MyMemory senza chiave, LibreTranslate, Google, o l'assistente IA, che è l'unico a cui si può spiegare il contesto; *(2)* il prezzo della segmentazione: mandando i pezzi separatamente il traduttore **non può riordinare** il testo attorno al segnaposto, quindi per una lingua che vuole un altro ordine il risultato è intero ma grammaticalmente imperfetto |
| **Q57** | la **lingua per destinatario**. Oggi c'è una lingua di notifica per progetto, che è il minimo ragionevole; se due persone ricevono lo stesso allarme e leggono lingue diverse, oggi una delle due legge la lingua dell'altra |

## Il lavoro, quando si farà

Entrambe sono piccole in codice e non banali in prodotto. La seconda di Q43 ha tre vie già
misurate: accettare l'imperfezione (oggi), mandare la frase intera **solo** al fornitore IA e
segmentare per gli altri, oppure marcare quelle righe come da rileggere sempre.


---

## Dalla scheda Q43 — Traduzione automatica dei contenuti di progetto (Google Translate)

*Aperta il 2026-09-07 su richiesta del maintainer. Nessuna decisione presa.*

**Richiesta.** Tradurre automaticamente da una lingua nota a una desiderata, usando le API di
Google Translator.

### Cosa c'è già, verificato sul codice

La richiesta **non** è «aggiungere il multilingua»: c'è. Quello che manca è riempire da soli una
struttura che esiste.

- `LanguageTable` in `sws-core/src/project.rs:966` ha un campo `default` — **il codice della lingua
  sorgente** — e la mappa token → traduzioni per codice lingua.
- L'autore scrive `{{token}}` nei campi testo degli oggetti; il viewer e l'anteprima dell'editor li
  risolvono nella lingua corrente (`sws-editor/src/i18n/projectI18n.ts`, T-40).
- Si scrive con `PUT /api/project/languages` (Admin).
- Sono **due assi indipendenti**: la lingua dell'interfaccia (`i18n/it.json`, `en.json`,
  react-i18next) e la lingua dei **contenuti di progetto**. Questa richiesta riguarda il secondo;
  confonderli produrrebbe un'interfaccia tradotta a metà.

### Opzioni

1. **Nel runtime, con un endpoint dedicato.** L'editor chiede «traduci da `it` a `de`», il runtime
   chiama Google e riempie `languages`. La chiave sta dove stanno già gli altri segreti.
2. **Nell'editor, col runtime come solo tramite.** Stessa cosa ma il controllo dell'operazione (cosa
   tradurre, cosa no) resta nell'IDE. Il browser non vede mai la chiave.
3. **Fuori linea, uno strumento a riga di comando** che prende un progetto e restituisce il progetto
   tradotto. Nessuna chiave nel prodotto, ma nessuna traduzione dall'IDE.

### Le domande da sciogliere

1. **Dove sta la chiave Google.** Stesso nodo di Q26: i segreti viaggiano col progetto in chiaro
   (decisione del 2026-08-20). Una chiave a consumo dentro un progetto che si esporta e si spedisce
   è un problema diverso da una password di driver.
2. **Chi rilegge.** Un allarme tradotto male su un pannello d'impianto non è una questione di stile.
   Serve un passaggio umano prima che una traduzione automatica raggiunga un dispositivo in
   servizio, e va deciso **dove** sta quel passaggio.
3. **Cosa NON si traduce.** I segnaposto di formato (`%.1f`, `{value}`), i nomi di macchina, le
   sigle e i codici di impianto. Tradurre `%.1f bar` in una lingua che sposta l'unità rompe il
   formato, non la frase.
4. **Riproducibilità.** La stessa stringa tradotta due volte può tornare diversa: serve decidere se
   si ritraduce tutto ogni volta o solo ciò che manca, e se una traduzione corretta a mano deve
   essere protetta dalla successiva passata automatica.
5. **Rete.** È un'operazione di **progettazione**, non di runtime: il dispositivo è spesso senza
   Internet. Va escluso che qualcosa la invochi a impianto acceso.
6. **Google o un'astrazione.** Il maintainer ha nominato Google; vincolarsi a un fornitore è una
   scelta legittima ma va detta, perché il costo di cambiarlo dopo non è zero.

### Default per il PoC

Nessuno: oggi le traduzioni si scrivono a mano nella tabella lingue.

### Realizzato in parte il 2026-09-15 (Fase 4 del piano multilingua)

Non chiude la scheda: la realizza dove il maintainer ha deciso, e lascia aperto ciò che resta suo.

**Deciso da lui, e fatto**: i fornitori stanno dietro un'astrazione — come già `enum Fornitore`
per l'assistente IA — e sono quattro, non uno. Due professionali a consumo (**Google Cloud
Translation** e l'**assistente IA già configurato**, Claude/Kimi, che è l'unico a cui si può dare
il *contesto*: «etichetta di un pulsante di un impianto industriale») e due gratuiti, aggiunti su
sua richiesta lo stesso giorno: **MyMemory**, senza nessuna chiave — è il default, perché chi preme
«traduci» deve ottenere una traduzione e non un modulo di configurazione — e **LibreTranslate**,
ospitabile in casa per chi non vuole che le stringhe del proprio impianto escano dal proprio
server.

**Le risposte ai sei nodi della scheda**, per quel che sono state date:

1. *Dove sta la chiave*: fuori dal progetto per l'IA (riusa `ai/client.rs`: 0600, mai in
   `project.yaml`). Per Google la chiave arriva nella richiesta e **non viene persistita** —
   scelta minima, non una risposta: persisterla va fatto dove stanno le altre.
2. *Chi rilegge*: il passaggio umano sta nell'IDE. L'esito lo dice esplicitamente ogni volta.
   **Non è una garanzia tecnica**: niente impedisce di tradurre e deployare senza guardare.
3. *Cosa non si traduce*: risolto, e provato — i segnaposti di formato escono dal testo prima di
   partire e ci rientrano identici; se il fornitore ne perde uno la riga viene **scartata**,
   perché una traduzione mutilata salvata è peggio di una riga non tradotta.
4. *Riproducibilità e protezione del lavoro umano*: risolto con `LangEntry.auto`, che elenca le
   lingue riempite dalla macchina. Una correzione a mano esce da lì e non viene più toccata,
   nemmeno chiedendo «ritraduci tutto».
5. *Rete*: risolto. L'endpoint esiste **solo sull'istanza IDE** e risponde 404 altrove.
6. *Google o un'astrazione*: entrambi, che era la decisione del maintainer.

**Cosa resta davvero aperto**, ed è perché la scheda non si chiude: quale fornitore sia quello
giusto **per un impianto consegnato**, e se una traduzione automatica debba poter raggiungere un
dispositivo in servizio senza che una persona l'abbia riletta. La prima è una scelta di costo e
qualità che dipende dal cliente; la seconda è una decisione di responsabilità, e un allarme
tradotto male su un pannello d'impianto non è una questione di stile.

### Cosa è stato realizzato nella 2.8.0 (16-09-2026), e cosa resta da decidere

Il piano multilingua ha costruito la traduzione automatica: quattro fornitori dietro
un'astrazione (MyMemory senza chiave, LibreTranslate, Google Cloud Translation, l'assistente IA),
endpoint solo-IDE, una traduzione umana mai sovrascritta, e una rilettura umana nell'IDE con
selettore della lingua di anteprima. Dei cinque punti elencati sopra, questo copre il 2 (dove
avviene la rilettura), il 4 (il marchio umano/automatico) e il 5 (mai a runtime).

**Il punto 3 — i segnaposto di formato — è stato risolto in un modo che vale la pena registrare,
perché è la parte che ha richiesto quattro tentativi.** I primi tre mettevano nel testo un
*guardiano* al posto del segnaposto, fidandosi che tornasse indietro intatto: il NUL non arrivava
a destinazione, `⟦0⟧` tornava riordinato («Warm stay: ⟦⟧0°C»), un carattere dell'area privata
veniva cancellato. La conclusione adottata è che **il segnaposto non esce dal nostro processo**:
la frase si spezza, si traduce solo il testo, e segnaposti e spazi di giunzione li rimette il
runtime.

**Resta aperto il prezzo di quella scelta**, ed è una decisione di prodotto, non di codice: il
traduttore vede i pezzi separati e **non può riordinare** il testo attorno al segnaposto. Per
l'italiano e l'inglese non cambia niente; per una lingua che volesse l'unità prima del numero, o
il verbo in fondo, il risultato è grammaticalmente imperfetto — intero, ma imperfetto. Le vie
sarebbero: accettarlo (oggi), mandare la frase intera **solo** al fornitore IA (l'unico a cui si
può spiegare cosa non toccare) e segmentare per gli altri, oppure marcare quelle righe come da
rileggere sempre. Non decisa.

Resta aperto anche il punto 1: quale fornitore è quello *giusto* per un allarme d'impianto.

### Decisa

`not yet`


---

## Dalla scheda Q57 — Una notifica non ha uno schermo: in che lingua parla, e a chi?

*Aperta il 15-09-2026 durante la Fase 2 del piano multilingua. Il piano prende il minimo e
registra qui la parte che è una decisione di prodotto.*

**Context.** Fino a oggi email e messaggi Telegram uscivano con il messaggio d'allarme **grezzo**
— un progetto tradotto bene mandava letteralmente `{{allarme_pressione}}` al telefono di chi era
di turno — dentro un template con le etichette («Allarme:», «Messaggio:», «Severità:») **cablate
in italiano**. Corretto: il messaggio si risolve, e le etichette seguono una lingua.

Ma *quale* lingua? Un viewer ce l'ha: è quella scelta sul vetro, e cambia quando un operatore
tocca il `lang_button`. Una notifica no. Parte verso una casella o una chat mentre nessuno sta
guardando il pannello, e la lingua scelta da un operatore in sala controllo non riguarda chi la
riceve. La Fase 2 ha quindi introdotto `notifications.notify_lang` nel progetto — **una sola per
progetto**, con ripiego sulla lingua principale della tabella.

**Il caso che una lingua sola non copre.** Un impianto venduto a un cliente estero ha spesso
destinatari misti: la manutenzione locale, il costruttore italiano, l'assistenza del fornitore del
PLC. Oggi ricevono tutti la stessa lingua, e almeno uno la riceve sbagliata. Il modello dei
destinatari lo permetterebbe: `notify_email[]` ed `escalate_to[]` sono già elenchi per allarme
(`sws-core/src/alarm.rs:175-181`), e `telegram_chat_ids[]` pure.

**Options.**

1. **Una lingua per progetto**, com'è ora. Semplice, e per un impianto con un solo interlocutore è
   la risposta giusta. Costo: chi ha destinatari misti non ha nessuna via d'uscita.
2. **Una lingua per destinatario**: `notify_email` diventa una lista di `{indirizzo, lingua}` e
   altrettanto per le chat. Il corpo si compone una volta per lingua distinta invece che una volta
   sola. Costo: cambia la forma del progetto in un punto che oggi è un semplice elenco di stringhe,
   e moltiplica i messaggi in uscita.
3. **Una lingua per canale** — email in una lingua, Telegram in un'altra. Costa poco ma copre un
   caso che non è quello vero: la lingua dipende da *chi legge*, non da *come* legge.

**Default per il PoC.** Opzione 1, realizzata. Il prezzo è scritto qui.

**Decided:** not yet.

# Righe di rilascio della parte WP630 (rc.30) — da mandare a sws-9b

## E — 389aee8d
- CHANGELOG (Corretto): «Togli ritaglio» nell'editor dei simboli rimetteva la forma con gli attributi scritti come
  oggetto, e l'editor si fermava («e.find is not a function») appena la si selezionava da sola. Ora la forma torna come
  coppie, e gli attributi scritti come oggetto (che il compilatore accetta) diventano coppie all'apertura, dai file
  `.swsym` e dalle proposte dell'IA. Ruota/Specchia su una sola foto: pulsanti spenti con il perché.
- NOVITA it: «Editor dei simboli: dopo "Togli ritaglio" selezionare la forma non ferma più l'editor.»
- NOVITA en: «Symbol editor: after "Remove the cut" selecting the shape no longer stops the editor.»

## A — afa46429
- CHANGELOG (Corretto): un tag calcolato prende la qualità peggiore dei tag che la sua espressione nomina (prima era
  sempre Good se la valutazione riusciva). All'avvio un derivato con un ingresso mai arrivato resta «mai ricevuto»; un
  ingresso Bad lo fa comunque Bad. I commenti `#` non contano come ingressi. Le espressioni costanti ora si valutano.
  Un'espressione modificata vale dal primo risveglio dopo il salvataggio o il deploy.
- CHANGELOG (Da sapere): gli allarmi sui tag calcolati si fermano durante il guasto di un ingresso; MQTT pubblica
  `null`; le variabili di memoria usate come parametri, dopo un riavvio, rendono non Good i derivati finché non si
  riscrivono; `'offline' if not tags['x'] else …` esce Bad se `x` è Bad (lettura statica). Due derivati che si
  leggono a vicenda possono restare «mai ricevuti».
- NOVITA it: «I tag calcolati prendono la qualità peggiore dei tag che leggono: un ingresso Bad non dà più un valore Good.»
- NOVITA en: «Computed tags take the worst quality of the tags they read: a Bad input no longer gives a Good value.»

## B (parte rc.30) — 905f6578
- CHANGELOG (Corretto): il trend dice quando un tag è Bad, sul web e sul pannello LVGL: traccia segnata nella
  legenda, «Dato non valido» nel badge del valore o al centro al posto di «In attesa di campioni…», linea interrotta
  sui campioni Bad (finestre fino a 15 minuti). Prima un tag Bad compariva come una linea piatta valida.
- CHANGELOG (Da sapere): un trend su un tag di testo mostra «In attesa di campioni…» invece degli assi vuoti; nella
  finestra «Espandi» del web, con finestre lunghe, l'avviso non compare (manca la qualità viva).
- NOVITA it: «Trend: un tag Bad non sembra più un dato valido: linea interrotta e "Dato non valido".»
- NOVITA en: «Trend: a Bad tag no longer looks valid: broken line and "Invalid data".»

## C e 2 — e18e6b1c
- CHANGELOG (Corretto): salvare dalla finestra dei simboli non fa più comparire la barra «il progetto sul runtime è
  cambiato»; lo stesso per le foto caricate dall'IDE e per «Genera foto». Con la finestra dei simboli aperta, un
  simbolo cambiato intanto nell'IDE (seconda finestra, aggiornamento dalla libreria, proposta dell'IA) non si perde
  più al Salva della finestra; se nell'IDE si è aperto un altro progetto, la finestra rifiuta il salvataggio e lo dice.
  «Rinomina» non c'è più nella libreria immagini dentro la finestra dei simboli.
- CHANGELOG (Corretto, 2): con il deploy al salvataggio acceso, «Deploy» con modifiche non salvate non fa più partire
  due deploy (uno prendeva 409); un deploy partito da un salvataggio non apre conferme: si ferma e il badge dice di
  usare il Deploy esplicito. Il pulsante di Connessione è spento mentre un deploy è in corso.
- CHANGELOG (Da sapere): le scritture nostre che non passano da un segnale ora danno la barra sempre (prima circa 4
  volte su 5): per esempio dopo il ripristino di un backup, ed è giusto.
- NOVITA it: «Editor dei simboli in una finestra: salvare non mostra più "progetto cambiato" e non perde i simboli cambiati nell'IDE.»
- NOVITA en: «Symbol editor in its own window: saving no longer shows "project changed" nor loses symbols changed in the IDE.»
- NOVITA it (2): «Deploy con modifiche non salvate: parte un deploy solo, senza l'errore "deploy già in corso".»
- NOVITA en (2): «Deploy with unsaved changes: only one deploy starts, without the "deploy already running" error.»

## D — b1a48095
- CHANGELOG (Corretto): nell'editor dei simboli un ingresso nuovo chiede il nome (anche da «Aggiungi effetto», da
  «Ingressi → Aggiungi», da «Anima…» quando nasce una parte, dallo strumento Bocca; Annulla non crea niente), e gli
  effetti non si scambiano più gli ingressi. Un ingresso si rinomina e si toglie da «Ingressi»; togliere un ingresso
  che degli effetti seguono chiede conferma e li toglie insieme. Invio ed Esc funzionano nelle finestre di domanda
  dell'editor, e Esc/Canc non agiscono più sul disegno sotto. Duplicare un gruppo intero fa un gruppo nuovo senza
  effetti. In «Collegamenti» l'ingresso si legge («Ingresso acceso (tag)»).
- CHANGELOG (Da sapere): i nomi delle bocche che cominciano o finiscono con un trattino ora sono rifiutati.
- NOVITA it: «Editor dei simboli: un ingresso nuovo chiede il nome, e gli effetti non si scambiano più gli ingressi.»
- NOVITA en: «Symbol editor: a new input asks for its name, and effects no longer swap their inputs.»

## Per i semi (dopo la rc)
- D: nomi e rinomina dei gruppi (2.27, decisione D1); «Separa» e la cancellazione che tolgono gli effetti di un
  gruppo svuotato senza chiedere; «Salva come» che non controlla i collegamenti in pagina; l'inventario dell'IDE per
  la regola «ciò che si crea chiede prima il nome».
- C: togliere la finestra dei 20 s dopo un salvataggio (riga nel seme 2026-10-21-due-editor-sullo-stesso-progetto);
  BackupsTab che ricarica solo i sinottici; il Salva dei simboli che non fa partire il deploy al salvataggio.
- B: il Bad di default su tutti gli oggetti (piano 2.27 da aprire, decisione B1); secchi del trend con il conteggio
  dei Bad; la finestra «Espandi» del web senza qualità viva.
- A: lettura esatta degli ingressi (non statica); OPC UA server senza qualità; qualità negli script; timestamp dei
  derivati con ingressi fermi; due derivati che si leggono a vicenda (A↔B restano «mai ricevuti»); un'espressione
  modificata in un progetto senza sorgenti vive vale solo alla prossima scrittura.
- E: rotazione/specchio delle foto nei simboli (attributo nuovo nel formato).

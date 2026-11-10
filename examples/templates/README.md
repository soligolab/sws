# Le regole del parco template

> Decise dal maintainer il 17-09-2026, dopo aver misurato tutti i template; R6–R8 il 04-11-2026, collaudando la 2.25.0.
> Il referto della discussione — le misure, le alternative scartate e il perché di ogni scelta —
> sta in [`docs/archive/2026-09-17-regole-dei-template.md`](../../docs/archive/2026-09-17-regole-dei-template.md).
> Le regole sono verificate da [`scripts/check_templates.sh`](../../scripts/check_templates.sh),
> che gira dentro `check_static.sh` e quindi a ogni *definition of done*.

Un template non è un esempio da guardare: è **ciò che l'utente copia**. Quello che c'è dentro
diventa il punto di partenza del suo progetto, difetti compresi — e fino al 17-09-2026 il parco
insegnava a mettere le stringhe in chiaro nei sinottici, a disegnare per uno schermo che non
esiste e a lasciare dentro l'indirizzo IP di casa di chi l'aveva scritto.

---

## R1 — 16:10, 1280×800

Ogni pagina è larga **1280** e alta **800**.

È la risoluzione dei pannelli su cui il prodotto gira, ed è il default dell'IDE per una pagina
nuova dal 16-09-2026. Un template con un altro formato nasce già diverso da tutto ciò che
l'utente creerà dopo.

*Prima di questa regola convivevano sei formati (800×620, 800×680, 880×660, 900×720, 1280×600,
1280×800) e nessuno era una scelta: erano sedimentazioni.*

## R2 — Tre lingue davvero: `it`, `en`, `es`

Due cose insieme, e la seconda è quella che conta:

1. `languages.langs` contiene `it`, `en` ed `es`;
2. **ogni testo che un operatore legge passa dalla tabella** — etichette, titoli, unità dentro i
   formati, messaggi di conferma. Non solo gli allarmi.

Restano fuori, dichiarati nella guardia: le **unità di misura** (`kW` è `kW` anche in spagnolo) e
tutto ciò che non ha lettere una volta tolti i segnaposti. È la stessa regola che usa
`sws_core::traduzione` per decidere cosa mandare a un traduttore automatico.

*Il multilingua del 2.8.0 ha tokenizzato i messaggi d'allarme. Il testo dei sinottici no: al
momento della misura sei template su dodici ne avevano **zero** tradotto, e `demo-items-web` ne
aveva 114 in chiaro. Chi apriva quei template e cambiava lingua vedeva cambiare gli allarmi e
nient'altro.*

## R3 — Semplice, e il numero lo dice

Al massimo **6 pagine**, al massimo **60 oggetti per pagina**.

«Semplice» non si può verificare; un numero sì. I numeri vengono dalla misura: la gran parte dei
template ci stava già dentro, e quelli che sfondavano sono esattamente quelli che nessuno
consiglierebbe a un utente nuovo come punto di partenza.

*Erano 3 pagine fino al 02-11-2026.* Il maintainer, davanti alla demo degli slider che ne ha cinque:
«con 3 pagine il concetto era di farne poche, ma non è un problema se sono anche 5/6, l'importante è
non avere una pagina per oggetto o demo ingarbugliate». Il tetto delle pagine guarda alla prima
metà della frase; la seconda la giudica chi legge il template.

## R4 — Un tipo di risorsa, e un caso d'uso vero

Il `README.md` del template dichiara, in cima: il **ruolo** (già introdotto dal Passo 2 della
revisione — inventario, banco di prova di protocollo, banco di prova di feature, applicazione
realistica), il **tipo di risorsa** mostrato (una presa smart, un inverter, un PLC, un contatore)
e il **caso d'uso** in una frase, preferendo l'impianto domestico o la piccola macchina
all'astrazione.

È l'unica regola che una guardia non può verificare davvero: la presenza della sezione sì, la sua
verità la legge una persona.

## R5 — Un template non porta la rete di nessuno

Nessun indirizzo di una rete vera, nessuna credenziale — né in `project.yaml` né nei `.md` che lo
accompagnano. Si usano nomi riservati (`mqtt.example.invalid`, RFC 2606), le reti di
documentazione (`192.0.2.0/24`, RFC 5737), `localhost`, o il nome mDNS convenzionale di un
prodotto (`homeassistant.local`, che è documentazione del prodotto e non la rete di qualcuno).

*Il 16-09-2026 creare un progetto da `nebulizzatore-sandokan` ha prodotto 1950 righe su 2000 di
`connection refused` in pochi minuti: quel template dichiarava `192.168.1.6`, il broker di casa
dell'autore. Il rumore è stato mitigato con un backoff, ma quello era il sintomo. E non si ferma
agli indirizzi: «i segreti viaggiano col progetto» è una decisione presa e giusta **per un
progetto**, ma un template non è un progetto — è qualcosa che si dà a chi con quell'impianto non
c'entra niente. Vedi Q58 in [`docs/OPEN_QUESTIONS.md`](../../docs/OPEN_QUESTIONS.md).*

## R6 — Ogni pagina ha una cornice

`page_layout.cornice_predefinita` è dichiarata e il suo file sta in `cornici/`. Ogni pagina normale la usa: nessuna
`cornice: null`. Restano fuori le pagine-finestra e le pagine speciali (`kind`), che una cornice non l'hanno mai.

La cornice si disegna **sotto** la pagina e non sposta niente (`componi` in `sws-web/src/cornici.rs`). Testata e piede
sono **riservati alla cornice**: nessun oggetto della pagina ci entra, nemmeno in parte e nemmeno nello spazio vuoto
accanto al titolo. Tutto il contenuto della pagina sta nell'area attiva, fra testata e piede. È la regola di
`oggetti_nelle_fasce`, che il validatore segnala e l'IDE colora di arancio in modifica; il test
`nessun_template_invade_le_fasce_della_cornice` la tiene a zero sul parco.

*Fino al 10-11-2026 un oggetto tutto dentro lo spazio libero di una fascia era lecito: i sottotitoli di
`homeassistant-demo` stavano in testata accanto al nome della pagina. Il maintainer ha deciso che le fasce sono della
cornice, e i sottotitoli sono scesi nella prima riga dell'area attiva.*

Una cornice nuova parte dal modello di `openplc-laboratorio`: testata con il nome della pagina (`{{pagina.nome}}`), data
e ora; piede con la navigazione. Con una pagina sola il piede non serve. I colori sono quelli del template.

*Decisa dal maintainer il 04-11-2026 collaudando la 2.25.0: «il demo ha un difetto, non hai usato i frame per le pagine,
va corretto». Quel giorno 3 template su 16 avevano una cornice.*

## R7 — Ogni comando si usa col ruolo Viewer

Le variabili che bottoni, interruttori, cursori, setpoint e righe scrivibili di una tabella scrivono hanno
`write_min_role: Viewer` (sul tag, o sul membro del tipo per un'istanza). Nessun oggetto chiede un ruolo con
`min_role`. Nessun bottone chiama una funzione Python (`on_press_fn`): una funzione la esegue solo un Operator, e il
pannello LVGL non la esegue affatto. Per contare, accendere o azzerare bastano i modi del bottone (`increment`,
`toggle`, `set`, …).

Chi apre un template lo prova senza accedere. Un comando che chiede il login, in una demo, sembra un difetto.

**Le eccezioni sono due**: `openplc-laboratorio` e `homeassistant-pro` mostrano la gestione dei permessi. Lì qualche
comando resta più alto, dichiarato in `R7_PERMESSI` con il suo tetto. Il lucchetto col ruolo che serve lo mette il
prodotto, non il template: una pastiglia «🔒 Supervisor» nell'angolo del comando, sul web e su LVGL, a chi non ha quel
ruolo. Nessuna scritta «serve il ruolo…» nelle pagine.

Non si possono aprire a Viewer, perché il runtime le tiene a Operator: riconoscere un allarme, applicare una ricetta,
eseguire una funzione.

*Decisa dal maintainer il 04-11-2026: «nei demo tutti i pulsanti mettili con accesso viewer, solo nei demo dove vogliamo
mostrare specificatamente la gestione dei permessi eleva le credenziali di qualche pulsante». Quel giorno i comandi
erano quasi tutti al ruolo predefinito, Operator.*

## R8 — Gli aggregati di oggetti stanno in un faceplate

Un gruppo che si ripete è un faceplate con i suoi parametri, e la pagina ne ha le istanze. Esempi: il riquadro con il
titolo e i valori di una macchina, una pompa col suo stato e il suo comando, una stanza con la luce e la temperatura.

I faceplate legano i tag per radice comune (`motore1.velocita`, `motore1.marcia`). Quindi variabili piatte che si
ripetono (`s.fv_potenza`, `s.inverter_potenza`) si portano prima a **tipi e istanze**.

La guardia conta solo una cosa: due o più oggetti della stessa istanza, fuori da un faceplate, quando il tipo ha più di
un'istanza. Il resto — un gruppo fatto di variabili piatte, un riquadro ripetuto due volte — lo giudica chi rivede.

*Decisa dal maintainer il 04-11-2026: «vedo che non usi mai i faceplates mentre sarebbero molto comodi in tutti i
template che hai fatto oggi, come regola quando puoi gli aggregati di oggetti falli in un faceplates».*

---

## Il debito dichiarato

Le regole sono nate su un parco che non le rispettava. Invece di fingere — o di bloccare tutto
finché non è a posto — le eccezioni stanno **scritte dentro la guardia**, ognuna con il suo
perché e, dove ha senso, **con il numero di oggi**: un tetto che può solo scendere. Se un
template peggiora, la guardia diventa rossa; se migliora, chiede di abbassare il numero.

`./scripts/check_templates.sh` stampa il totale a ogni giro. Erano **30** quando le regole sono
nate, la mattina del 17-09-2026; dopo il Passo 5 della revisione — lo stesso giorno — erano **6**;
dal 18-09, con `casa-locale` uscito dal parco, sono **4**. Le regole R6–R8 le hanno riportate a **25**
il 04-11-2026, la sessione T1 a **15** e la T2 a **0**: oggi il parco non ha debiti dichiarati.

**R1, R2 e R5 sono a zero**: ogni pagina è 1280×800, ogni testo visibile di ogni template passa dalla tabella lingue, ogni
template dichiara `it/en/es` con tutte e tre le colonne piene, e nessuno porta l'indirizzo o le
credenziali di una rete vera. Se una riga ricompare in `R2_DEBITO`, è un template che è tornato
indietro.

**Anche R3 è a zero dal 04-11-2026.** Le ultime due righe erano `homeassistant-demo` (62 oggetti nella panoramica) e
`homeassistant-pro` (106, la vetrina del «cosa si può fare», eccezione decisa dal maintainer il 17-09). Con i faceplate
di R8 sono scese a 38 e a 60: il gruppo che si ripete conta un oggetto solo.

**R6, R7 e R8** sono nate il 04-11-2026 con un debito per template, in `R678_DEBITO`: tre numeri, uno per regola, che
possono solo scendere. Le sessioni T1 e T2 della [serie coordinata](../../docs/plans/README.md) li hanno portati
**tutti a zero lo stesso giorno**: `R678_DEBITO` è vuoto. Restano solo le due eccezioni dei permessi, in `R7_PERMESSI`.
`SWS_TEMPLATE_MISURA=1 ./scripts/check_templates.sh` stampa i numeri di oggi, e
`SWS_TEMPLATE_SOLO=<nome> SWS_TEMPLATE_SENZA_DEBITO=1 ./scripts/check_templates.sh` dice se un template è a zero, con
l'elenco di quello che manca.

Un debito dichiarato non è un'assoluzione. È la differenza fra sapere quanto si è indietro e non
saperlo.

## Cosa non sta qui

I progetti nati per **esercitare una funzione mentre la si costruisce** non sono template e
stanno in [`examples/banchi-di-prova/`](../banchi-di-prova/README.md). Hanno il compito opposto —
mettere sotto sforzo una cosa sola — e tenerli nella vetrina significava o mentirgli addosso o
applicargli regole scritte per un altro scopo.

# Le regole del parco template

> Decise dal maintainer il 17-09-2026, dopo aver misurato tutti i template.
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

Al massimo **3 pagine**, al massimo **60 oggetti per pagina**.

«Semplice» non si può verificare; un numero sì. I numeri vengono dalla misura: la gran parte dei
template ci stava già dentro, e quelli che sfondavano sono esattamente quelli che nessuno
consiglierebbe a un utente nuovo come punto di partenza.

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

---

## Il debito dichiarato

Le regole sono nate su un parco che non le rispettava. Invece di fingere — o di bloccare tutto
finché non è a posto — le eccezioni stanno **scritte dentro la guardia**, ognuna con il suo
perché e, dove ha senso, **con il numero di oggi**: un tetto che può solo scendere. Se un
template peggiora, la guardia diventa rossa; se migliora, chiede di abbassare il numero.

`./scripts/check_templates.sh` stampa il totale a ogni giro. Erano **30** quando le regole sono
nate, la mattina del 17-09-2026; dopo il Passo 5 della revisione — lo stesso giorno — erano **6**;
dal 18-09, con `casa-locale` uscito dal parco, sono **4**.

**R1, R2 e R5 sono a zero**: ogni pagina è 1280×800, ogni testo visibile di ogni template passa dalla tabella lingue, ogni
template dichiara `it/en/es` con tutte e tre le colonne piene, e nessuno porta l'indirizzo o le
credenziali di una rete vera. Se una riga ricompare in `R2_DEBITO`, è un template che è tornato
indietro.

Le quattro che restano sono tutte di semplicità (R3), e sono queste:

| Template | Regola | Perché |
|---|---|---|
| `demo-items-web` / `-lvgl` | R3 | 4 pagine, perché i tipi di widget da mostrare sono 35 |
| `homeassistant-demo` | R3 | 62 oggetti nella panoramica, due sopra il tetto |
| `homeassistant-pro` | R3 | la vetrina del «cosa si può fare» — eccezione decisa dal maintainer |

Un debito dichiarato non è un'assoluzione. È la differenza fra sapere quanto si è indietro e non
saperlo.

## Cosa non sta qui

I progetti nati per **esercitare una funzione mentre la si costruisce** non sono template e
stanno in [`examples/banchi-di-prova/`](../banchi-di-prova/README.md). Hanno il compito opposto —
mettere sotto sforzo una cosa sola — e tenerli nella vetrina significava o mentirgli addosso o
applicargli regole scritte per un altro scopo.

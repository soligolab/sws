# Un allarme per tag, con più condizioni dentro — seme

> **Idea del maintainer, 23-09-2026**, nata provando tre allarmi sullo stesso tag e vedendoli
> scattare tutti insieme: «Un tag può essere agganciato ad un solo allarme. In questo caso dentro il
> menù dell'allarme bisogna poter definire più condizioni e quindi è sottinteso che ad ogni
> "iterazione del codice" quel tag può generare solo uno degli allarmi per cui ha delle condizioni a
> disposizione. Servirà una logica di priorità per definire quale vince.»
>
> **FATTO lo stesso giorno**, perché il maintainer ha deciso subito la parte che serviva: «la
> migrazione automatica non è richiesta, sono progetti di test/prova, basta correggere i template e
> non permettermi di salvare un progetto riaperto se non correggo io gli allarmi. Prosegui.» Il seme
> è rimasto aperto meno di un'ora, quindi non è invecchiato — la ragione per cui i semi esistono.
>
> Le due scelte che restavano sono state prese prima di scrivere codice: vince la **severità più
> alta** fra le condizioni vere (non l'ordine di dichiarazione), e un allarme già confermato che
> **peggiora torna da confermare**.

## Com'è adesso (misurato il 23-09-2026)

`AlarmDef` (`sws-core/src/alarm.rs:152`) ha **una** `condition`, una `severity`, un `message` e un
`id`. Per avere tre livelli sullo stesso dato si dichiarano **tre allarmi distinti** sullo stesso
`tag`, con soglie diverse.

**Non è un caso raro: è la norma.** Otto progetti su tredici, fra i template del parco e i progetti
di prova, hanno già più allarmi sullo stesso tag:

| progetto | allarmi | tag con più di un allarme |
|---|---:|---|
| `homeassistant-pro` | 13 | batteria, tensione di rete, frequenza, temperatura sala |
| `test` (prova del maintainer) | 5 | `slider.alarm` (3 livelli), `host.Temeprature1` (2) |
| `demo-items-web` / `-lvgl` | 3 | `demo.sim.pressure` |
| `homeassistant-demo` | 7 | `sala.temperatura` |
| `nebulizzatore-sandokan` | 2 | `sandokan.power` |

**Il sintomo che ha fatto nascere l'idea.** Con tre allarmi «sopra 60», «sopra 70» e «sopra 80» e il
tag a 85, il runtime ne tiene **tre attivi insieme** (misurato: `alarm_active_count: 3`). Per
l'impianto è **un solo fenomeno** — la pressione è alta — ma l'operatore vede tre righe, la
campanella conta tre, e la notifica parte tre volte. Chi guarda deve capire da solo che sono lo
stesso problema visto a tre livelli.

## Com'è andata

| domanda del seme | risposta |
|---|---|
| forma della dichiarazione | `levels: [{ condition, severity, message, dead_band? }]`, l'id resta uno per allarme |
| priorità | severità più alta; a parità, la prima dichiarata |
| passaggio di livello su allarme confermato | torna da confermare e rinotifica; migliorando, la conferma resta |
| migrazione | **nessuna**: il formato vecchio si legge e continua a far scattare gli allarmi, ma il salvataggio è rifiutato finché non si converte a mano |
| chi altro | validatore (blocco), scheda Allarmi (righe di continuazione), notifiche, storico, viewer web e LVGL, undici template |

**Una cosa che il disegno non prevedeva e i dati hanno imposto**: la banda morta doveva poter stare
sul **livello** e non solo sull'allarme. Nel template `homeassistant-pro` «batteria sotto 15%» ha
isteresi 3 e «sotto 5%» ha isteresi 1, perché una soglia di guardia e una di emergenza non oscillano
allo stesso modo: unendole con una banda morta sola se ne sarebbe persa una. È saltato fuori
convertendo i template, non progettando.

## Cosa la sessione di plan avrebbe dovuto decidere

- **La forma della dichiarazione**: `conditions: [{ when, severity, message }]` dentro un `AlarmDef`
  solo, con l'id dell'allarme che resta uno? E l'id della *condizione* che scatta, serve? Lo storico
  e la conferma oggi lavorano per `id` di allarme.
- **La priorità**: la severità più alta fra le condizioni vere vince, o l'ordine di dichiarazione?
  («Servirà una logica di priorità per definire quale vince».) E se due condizioni della stessa
  severità sono vere insieme?
- **Il passaggio di livello**: da Warning a Critical mentre l'allarme è **già attivo e confermato**,
  cosa succede? Resta confermato? Ri-notifica? Nella pratica è il caso più frequente e il più facile
  da sbagliare.
- **La migrazione**: otto progetti su tredici vanno convertiti, e la conversione deve essere
  automatica come quella dei segreti (backup prima, audit, nessuna perdita). Gli id degli allarmi
  vecchi sono citati nello **storico già registrato** e nelle conferme: cambiare id significa
  spezzare la storia.
- **Chi altro tocca**: la scheda Allarmi dell'IDE, `alarm_viewer`/`alarm_bell`/`alarm_banner` (web e
  LVGL, che devono restare d'accordo — `check_barra_allarmi.sh`), le notifiche, lo storico su SQLite
  (`alarm_events`), l'assistente IA e il validatore.

## Da guardare insieme

- **[Lo storico allarmi perde gli allarmi mai confermati](2026-09-23-storico-allarmi-eventi-persi.md)**:
  un difetto di adesso, nello stesso motore. Va deciso se correggerlo prima o dentro questo lavoro.
- La regola del maintainer nello stesso giorno, che vale anche qui: **l'allarme avvisa quando
  scatta**, non quando rientra. Vale per la notifica (già così) e per il registro (non ancora).

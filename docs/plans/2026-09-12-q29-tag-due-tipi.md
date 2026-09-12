# Q29 — Un tag può servire due direzioni con due tipi diversi?

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q29) il 2026-09-12, aperta il 2026-08-31, misurata
> ma **non decisa**. Presenta la domanda, non la risolve — regola di `CLAUDE.md` su
> `docs/OPEN_QUESTIONS.md`. Rileggere la scheda originale per il dettaglio completo.

## Il problema, in breve

I dodici pulsanti delle tapparelle in `casa-locale` scrivono le stringhe `"open"`/`"stop"`/
`"close"` su tag dichiarati `data_type: float` (una posizione 0-100 in lettura). Funziona (il
server non fa rispettare `data_type` in scrittura, Q27), ma il tipo dichiarato è falso metà del
tempo.

**Misurato**: è un idioma isolato — dodici oggetti, tutti nello stesso progetto, tutti dello
stesso genere (`float ← stringa`). Non è una pratica diffusa. Il modello **ammette già** che un
tag legga da una parte e scriva dall'altra (MQTT ha `topic` per la lettura e `publish_topic` per
la scrittura) — quello che non ammette è che le due direzioni abbiano **tipi** diversi:
`data_type` è dichiarato una volta e vale per entrambe.

## Le domande, senza risposta

1. **Il modello giusto**: due tag separati (uno in lettura, uno in scrittura), o un tag solo con
   due tipi dichiarati esplicitamente (`data_type` + un nuovo `write_data_type`)?
2. Se resta un tag con due direzioni: cosa dice `data_type`? Oggi descrive solo la lettura,
   tacendo sulla scrittura, e non è scritto da nessuna parte che sia così.
3. Cosa deve rispondere il validatore del progetto nel frattempo (rilevante per T-50/l'assistente
   IA, che userebbe `casa-locale` come esempio e imparerebbe la cosa sbagliata se non gestito).
4. Vale anche per Home Assistant (`write_domain`/`write_service`) e Sparkplug (`writable`), o è
   un problema solo di MQTT?

## Una quarta strada emersa misurando, da valutare insieme alle altre

`write_data_type` accanto a `publish_topic` (dichiarato dove è già dichiarata l'asimmetria
lettura/scrittura) — non chiede di mentire sul tipo né di spezzare in due un tag che l'utente
pensa come uno. Non è proposta come "la migliore", solo come opzione che nessuno aveva ancora
scritto.

## Rapporto con altre voci

Stessa famiglia di Q27 (il server non fa rispettare `data_type` in scrittura): Q27 chiede se il
tipo è un contratto, questa chiede se è *un* contratto o due.

## Quando si deciderà

Il segnalibro nel frattempo è `ECCEZIONI_NOTE` in `sws-web/src/validate.rs`, che elenca le
dodici eccezioni una per una — una tredicesima fa fallire il test, così il problema non cresce
in silenzio mentre resta aperto.

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q29 — Un tag può servire due direzioni con due tipi diversi?

*Aperta il 2026-08-31 (notte), scrivendo il validatore di T-50. Misurata, non decisa.*

I dodici pulsanti dei rulli in `casa-locale` scrivono le stringhe `"open"` / `"stop"` /
`"close"` su tag dichiarati `float`:

```yaml
# project.yaml
- id: shutter.garage
  data_type: float          # la posizione 0-100 che arriva da .../roller/0/pos

# Page 5 - Domotica.yaml
- id: cl5_t1_open
  type: button
  tag: shutter.garage
  write_value: "open"       # il comando che esce su .../roller/0/command
```

Lo stesso tag porta **una posizione numerica in lettura** e **un comando testuale in
scrittura**. Funziona: il server non fa rispettare il `data_type` (Q27) e il plugin MQTT
pubblica il valore così com'è. Ma il tipo dichiarato è falso metà del tempo, e il valore che
sta nel `TagDb` subito dopo il comando non è una posizione.

### Misurato il 2026-09-05 — l'estensione è **esattamente** dodici oggetti, e il modello è già a metà strada

Due misure che restringono molto la domanda.

**Uno**: passando tutti i template e confrontando ogni `write_value` col `data_type` del suo tag,
le scritture fuori tipo sono **12, tutte in `casa-locale`, tutte dello stesso genere**
(`float ← stringa`), e sono i dodici pulsanti delle tapparelle. Nessun altro template ha il
problema. Quindi non è una pratica diffusa da sanare: è **un idioma solo**, in un progetto solo.

**Due, e conta di più**: quel tag **è già dichiarato come due canali**. La mappatura MQTT ha
`topic` per la lettura e `publish_topic` per la scrittura, e sono due argomenti diversi:

```yaml
- tag: shutter.garage
  topic: "shellies/SHELLY_GARAGE_ID/roller/0/pos"          # legge una posizione 0-100
  publish_topic: "shellies/SHELLY_GARAGE_ID/roller/0/command"  # scrive open/stop/close
```

Il modello, cioè, **ammette già** che un tag legga da una parte e scriva dall'altra. Quello che non
ammette è che le due parti abbiano **tipi** diversi: `data_type` è dichiarato una volta e vale per
entrambe. La domanda «un tag può servire due direzioni con due tipi?» ha quindi una risposta
parziale già scritta nel formato — le due direzioni ci sono — e resta aperta solo sull'ultimo
pezzo.

Da cui una quarta strada, che non era nell'elenco e che è simmetrica a ciò che esiste:
**`write_data_type` accanto a `publish_topic`**, dichiarato dove è già dichiarata l'asimmetria. Non
la propongo come la migliore — è una decisione di prodotto — ma va valutata insieme alle altre,
perché è l'unica che non chiede né di mentire sul tipo né di spezzare in due un tag che l'utente
pensa come uno.

### Perché è emersa adesso

Il validatore di T-50 deve dire a un assistente se una proposta è accettabile. La regola «il
valore scritto sta nel tipo del tag» è quella che impedisce al modello di ripetere il difetto
del 2026-08-31 (`write_value: 'true'` su un tag `bool`). Applicata ai template, boccia dodici
oggetti di `casa-locale` — cioè un progetto vero che funziona da mesi.

Le dodici eccezioni sono elencate una per una in `ECCEZIONI_NOTE`
(`sws-web/src/validate.rs`), così una tredicesima fa fallire il test. Non è una risposta: è
un segnalibro.

### Le domande

1. **Il modello giusto sono due tag** (`shutter.garage.pos` in lettura, `shutter.garage.cmd`
   in scrittura), o **un tag con due tipi** dichiarati esplicitamente
   (`data_type: float`, `write_data_type: string`)?
2. Se restano due direzioni su un tag solo, **cosa dice `data_type`**? Oggi descrive la
   lettura e tace sulla scrittura, ma non c'è scritto da nessuna parte.
3. Cosa deve rispondere il validatore nel frattempo — e quindi cosa impara un assistente che
   legge `casa-locale` come esempio. Oggi imparerebbe che si può scrivere una stringa su un
   `float`.
4. Vale anche per Home Assistant (`write_domain` / `write_service`) e per Sparkplug
   (`writable`), o è solo MQTT?

### Rapporto con le altre voci

È la stessa famiglia di **Q27** (il server non fa rispettare il `data_type` in scrittura):
Q27 chiede se il tipo è un contratto, Q29 chiede se è *un* contratto o due.

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

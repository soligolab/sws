# Seme — i valori uguali al precedente si ritrasmettono comunque

> **Seme — decisione.** Trovato il 17-10-2026 preparando il banco di prestazioni (onda 2).
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**

## Cosa si è misurato

- `TagDb::set` (`sws-core/src/tag.rs:363`) trasmette **ogni** scrittura sul canale degli aggiornamenti, anche quando
  valore e qualità sono uguali a quelli di prima.
- I generatori dei tag si ricalcolano ogni 100 ms (`sws-runtime/src/main.rs:934`): un tag generato fa quindi
  **10 aggiornamenti al secondo** verso ogni client, anche un'onda quadra che cambia una volta al secondo.
- Lo stesso vale per ogni driver che rilegge un registro e lo riscrive invariato.

## Perché conta

Sul TC620, 5.000 tag aggiornati una volta al secondo verso 20 browser costano già un core
(`docs/manual/16_prestazioni.md`). Valori uguali ritrasmessi moltiplicano quel lavoro senza dire niente di nuovo.

## Domande per la sessione di plan

- Scartare in `set` solo quando valore **e** qualità sono uguali? Il timestamp va aggiornato lo stesso (lo stale lo
  guarda)?
- Chi ha bisogno di vedere anche le scritture uguali (storico con intervallo minimo, «dato vecchio», allarmi)?
- Generatori: ricalcolo a 100 ms per tutti, o legato al periodo?

## Rimisurato il 21-10-2026 — la modifica è di sei righe, il contorno no

La riga da cambiare c'è e il modello da copiare è nello stesso file: `marca_qualita` fa già
esattamente questo scarto (`tag.rs:486-488` per la foglia, `:507-509` per il piatto), e `TagValue`
deriva `PartialEq`. Tutti i produttori passano da `ingest` → `set_tipizzato` → `set`: un punto
solo. **Ma il costo non è lì.**

Correzioni ai riferimenti: `main.rs:934` ora è `:956` (tick) e `:974` (scrittura), e dall'08-10 il
generatore non chiama più `set` diretto ma `set_tipizzato` (`tag.rs:323`).

**I sette sottoscrittori**, misurati: valutatore allarmi (`main.rs:836`), tag derivati Python
(`:876`), anello in RAM dello storico (`sws-historian/src/lib.rs:263`), scrittura su datastore
(`registry.rs:405`), script globali con trigger `TagChange` (`global_scripts.rs:168`), specchio
OPC-UA (`sws-plugin-opcua/src/lib.rs:1129`), e `/ws/tags` (`router.rs:8011`), uno per ogni browser
e per ogni pannello LVGL.

**Tre si rompono in silenzio, e nessun test li prende.**

1. **I ritardi degli allarmi smettono di scattare.** `on_delay_s`/`off_delay_s` avanzano solo
   quando qualcuno chiama `evaluate` (`alarm.rs:1099-1128`), e l'unico chiamante in produzione è
   `main.rs:847`, alimentato dal canale. Non esiste nessun tick periodico. Temperatura a 90,
   soglia 80, `on_delay` 60 s: oggi il driver rilegge 90 ogni secondo e dopo un minuto l'allarme
   scatta; con lo scarto la seconda lettura non passa più, `evaluate` non viene più chiamato, e
   **l'allarme non scatta mai** finché il valore non cambia. Col `off_delay` è il contrario:
   resta attivo per sempre. `on_delay_s` compare una volta sola nei test (`alarm.rs:1548`), e
   quel test verifica che l'allarme **non** scatti: non esiste un test che dimostri che scatta.
2. **Il «dato vecchio» si capovolge sui due visori**, che lo calcolano da `timestamp_ms` ricevuto
   (`SvgCanvas.tsx:1916`, `effects.rs:144`): un tag fermo smetterebbe di aggiornare il timestamp e
   diventerebbe stale pur essendo vivo.
3. **Gli script globali con edge `any`** (`global_scripts.rs:284`) oggi partono a ogni scrittura,
   anche uguale: chi li usa come battito periodico se li vedrebbe fermare.

**Quindi non è «sei righe»**: prima va deciso che cosa fa di nuovo scattare `evaluate`, e come lo
stale continua a funzionare. Le due domande in fondo restano, e ne va aggiunta una terza: lo
scarto è sempre attivo o è un interruttore per progetto?

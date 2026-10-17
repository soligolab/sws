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

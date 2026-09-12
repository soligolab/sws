# Q32 — Modificare il progetto di un impianto in presa diretta: serve più cerimonia?

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q32) il 2026-09-12, aperta il 2026-09-02,
> riverificata il 2026-09-06 (la premessa era superata dal cambiamento nello stesso giorno).
> Presenta la domanda ristretta, non la decide. Rileggere la scheda originale (e Q31, che
> tocca lo stesso terreno) prima di procedere.

## Il problema, ristretto dalla riverifica del 2026-09-06

Con l'IDE sulla porta admin di un dispositivo, il Salva modifica il progetto **dell'impianto in
servizio** in presa diretta, con hot-reload immediato — senza riavvio né conferma. La domanda
originale temeva che questo fosse il comportamento di *ogni* dispositivo spedito.

**Non è più così dal 2026-09-02**: tutti i deploy (Yocto, generic-linux, container) partono con
`--no-admin` di default — niente IDE, niente modifica del progetto sul dispositivo. Riaccenderlo
richiede `SWS_ENABLE_IDE=1` nell'env del servizio e un riavvio: un passo esplicito, compiuto da
chi ha accesso al dispositivo, non da chi ha il browser aperto.

## La domanda che resta, ristretta a due casi

1. **Il dispositivo con `SWS_ENABLE_IDE=1`** — chi l'ha acceso sa cosa sta facendo. Basta il
   marcatore in testata già presente, o serve altro (una conferma alla prima modifica,
   un'ulteriore cerimonia)?
2. **`start_runtime.sh` in locale** — lo strumento di sviluppo del maintainer, dove la presa
   diretta è il punto stesso di usarlo. Probabilmente non vuole cerimonia.

## Opzioni dalla scheda originale (nessuna scelta ancora)

1. **Presa diretta = normale**, come oggi con il solo marcatore in testata. Zero lavoro.
2. **Presa diretta = deliberata**: un passo esplicito (conferma alla prima modifica, o un
   interruttore) prima di poter modificare un'istanza che serve un impianto.
3. **Presa diretta = sola lettura per default**: si modifica sempre via pull sull'editor locale,
   poi si ridistribuisce. Cambia il modo di lavorare del maintainer.
4. **Per ruolo**: Supervisor può, altri no — ma il ruolo non descrive la situazione (un Admin in
   ufficio su una copia e un Admin in campo su un impianto sono la stessa cosa per l'auth).

**Default per il PoC**: opzione 1, stato attuale.

## Prossimo passo

Chiedere al maintainer se il caso 1 (dispositivo acceso apposta con `SWS_ENABLE_IDE=1`) merita
altro oltre al marcatore — è l'unica parte della domanda originale rimasta viva dopo la
riverifica.

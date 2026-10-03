# Due trappole viste al collaudo del 03-10-2026: l'istanza che non si trova, il deploy che cancella

> **Seme — decisione** (03-10-2026). Un'attività sola su richiesta del maintainer, perché tutte e due sono emerse
> lavorando sul TC620 con i tipi struttura, e tutte e due sono casi in cui l'IDE fa (o non fa) qualcosa **senza dirlo**.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## 1. Un tipo da solo non produce variabili, e niente lo dice

**Cosa è successo.** Il maintainer ha definito un tipo `hosts` con due membri e non riusciva a usarli né nella card
della sorgente Host né nell'albero dei tag. Il progetto (`rc14_lvgl`) aveva il **tipo** ma nessuna **istanza**: le foglie
esistono solo per una variabile con `type_ref`, e la si crea dalla scheda **Variabili** scegliendo il tipo nel gruppo
«Tipi di progetto» della colonna Tipo. Niente nella scheda **Tipi** porta lì.

**Misurato oggi.**
- `sws-editor/src/config/schede/TipiTab.tsx` (344 righe) calcola già `istanze` (le variabili con quel `type_ref`) e
  un'anteprima delle foglie su un'istanza fittizia (`foglieDi({ id: "istanza", type_ref })`), ma non offre di crearne una.
- Il selettore dei tag (`TagInput`, `tagCatalog`) offre le foglie solo delle istanze: con zero istanze di un tipo non
  c'è nessuna traccia del tipo stesso.
- Il runtime funziona: un'istanza mappata a foglie dalla sorgente Host riceve i valori (provato con `tc620-sistema`,
  31 foglie, tutte Good sul TC620).

**Direzioni già visibili (da decidere).** Un pulsante «Crea istanza» nella scheda Tipi (con nome proposto); nella
scheda Tipi, «nessuna istanza» detto esplicitamente; nel selettore dei tag, una riga «tipo X: nessuna istanza — crea»;
il CSV/import che già conosce `type_ref`.

## 2. Il deploy di un progetto con un altro nome cancella quello che c'era sul pannello

**Cosa è successo.** Il deploy di `tc620-sistema` sul TC620 ha tolto `rc14_lvgl` dal pannello **con tutto lo storico**
(circa 1,3 milioni di campioni della simulazione demo). Il log del deploy lo diceva solo dopo: «✓ rimosso "rc14_lvgl"».
Nessuna domanda prima.

**Misurato oggi.** `sws-runtime/crates/sws-web/src/remote.rs`, `remote_deploy` (≈ riga 1735): modello a progetto
singolo; per ogni progetto sul target, **stesso nome** → `DELETE …?preserve_state=true` (pagine sostituite, database e
backup conservati); **nome diverso** → `DELETE` completo («preservarne lo storico non ha senso»). Il deploy fa già un
precheck prima di toccare qualunque cosa (utenti, segreti): è il posto naturale per una conferma.

**Direzioni già visibili (da decidere).** Chiedere conferma nominando il progetto che sparisce e quanto pesa il suo
storico; offrire di scaricarne prima un backup (o di farne uno sul pannello); oppure non cancellare affatto un progetto
con un altro nome (il pannello ne tiene più d'uno, uno attivo) e lasciare la pulizia a un comando esplicito.

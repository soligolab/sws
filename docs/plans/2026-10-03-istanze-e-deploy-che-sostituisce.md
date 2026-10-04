# Due trappole viste al collaudo del 03-10-2026: l'istanza che non si trova, il deploy che cancella

> **Piano d'esecuzione dal 03-10-2026** (sezione in fondo). Era un seme (03-10-2026). Un'attività sola su richiesta del maintainer, perché tutte e due sono emerse
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

---

# Piano del 03-10-2026 — approvato

**Scelte del maintainer (03-10-2026):** deploy → **chiedere conferma** prima di cancellare (vale anche per il deploy al
salvataggio; annullando non cambia niente); tipi → **«Crea istanza» nella scheda Tipi** (niente suggerimenti nel
selettore né rilievi).

Un ramo: `feat/istanze-e-deploy-con-conferma`. Il seme diventa piano d'esecuzione (sezione in fondo al file).

### 1. «Crea istanza» nella scheda Tipi

- `TipiTab.tsx`, sotto intestazione e descrizione del tipo scelto, al posto del solo avviso «N istanze»:
  - con istanze: l'elenco (come oggi) **più** il campo e il pulsante;
  - senza: una riga esplicita «Questo tipo non ha ancora istanze: le sue parti esistono solo in una variabile di questo
    tipo» e il campo e il pulsante.
  - Campo nome proposto = id del tipo in minuscolo, reso unico rispetto ai tag esistenti (`sistema`, `sistema2`…);
    validazione col pattern degli id dei tag già usato in TagsTab (stesso helper, non un'espressione nuova).
- Il clic: **salva prima il tipo** se la bozza dei tipi è toccata (riusa il `handleSave` della scheda), poi aggiunge
  `{ id, description: "", type_ref: tipo.id, history: false }` ai tag con `api.updateTags([...tags, nuovo])` +
  `updateProjectTags` — lo stesso percorso di `TagsTab.handleSave` — e poi porta alla riga nella scheda Variabili
  (`setConfigFocus`/vista «variabili», come fa l'albero quando apre un tag). Se la bozza delle **Variabili** è toccata,
  il pulsante è spento con il motivo («salva prima le variabili»), per non mescolare due bozze.
- La scheda Variabili ricarica i tag dallo store (la sottoscheda Tipi è montata dentro `TagsTab`: callback
  `onIstanzaCreata(id)` passata da `TagsTab`, che fa `setTags` e cambia vista).
- i18n it/en (`tipiTab.nessunaIstanza`, `tipiTab.creaIstanza`, `tipiTab.nomeIstanza`, `tipiTab.salvaPrimaVariabili`),
  nel catalogo — `check_i18n_ui` lo vuole.

### 2. Il deploy chiede conferma prima di cancellare un progetto con un altro nome

- **Runtime, `remote_deploy`**: nel precheck che già legge utenti e segreti **prima di toccare qualunque cosa**,
  leggere `GET {base}/api/projects` e calcolare i progetti con nome diverso da `deploy_name`. Se ce ne sono e la
  richiesta non porta `confirm_replace: true` → **428** con
  `{"conferma": "sostituisce-progetti", "progetti": [{"nome", "storico_byte"}]}` — stesso schema del 428
  `utenti-vuoti` già esistente (che resta com'è; se servono tutte e due, una alla volta). Funzione pura testata
  `progetti_da_sostituire(elenco, deploy_name) -> Vec<…>`.
- `DeployBody` riceve `confirm_replace: bool` (default `false`; `deny_unknown_fields` è già lì: va aggiunto il campo).
- **Il peso dello storico**: `list_projects` (`projects.rs`) aggiunge `storico_byte: Option<u64>` (somma dei file in
  `<progetto>/history/`, economica). Un pannello vecchio non lo manda → il messaggio dice il nome senza il peso.
- **IDE**: `api.deployToRuntime` passa `confirm_replace`; `eseguiDeploy` (`store/index.ts`) gestisce il nuovo 428 come
  quello degli utenti: `window.confirm` con nomi e MB («Sul pannello c'è "rc14_lvgl" con 51 MB di storico: il deploy di
  "tc620-sistema" lo cancella, storico compreso. Continuare?»), sì → ritenta con `confirm_replace: true`, no → stato
  «idle» e niente toccato. Vale per «Invia ora», «Utenti e segreti» e il deploy al salvataggio (passano tutti da
  `eseguiDeploy`). i18n it/en.
- Il riepilogo nel log del deploy resta («✓ rimosso …»), ora preceduto dalla conferma.

### Documenti

CHANGELOG, `NOVITA.yaml` (una riga: il deploy chiede prima di sostituire un progetto; nella scheda Tipi «Crea istanza»),
manuale (capitolo deploy: la conferma; capitolo tag/tipi: creare un'istanza), HOWTO se c'è già un capitolo sui tipi,
STATUS, seme → archivio a lavoro chiuso.

### Verifica

- Rust: `progetti_da_sostituire` (stesso nome escluso, più progetti, elenco vuoto), `DeployBody` col campo nuovo e
  senza, `storico_byte` nell'elenco; `cargo test -p sws-web`.
- Vitest: la riga «nessuna istanza», il nome proposto unico, il pulsante spento con bozza Variabili toccata, la
  sequenza salva-tipo → updateTags; il 428 `sostituisce-progetti` → confirm → ritentativo con `confirm_replace`
  (mock come i test esistenti di `eseguiDeploy`, se ci sono; altrimenti sulla funzione estratta).
- `pnpm build`, `cargo check`, `check_static.sh`.
- Dal vivo sul TC620 (rc del ramo): deploy di un progetto con altro nome → compare la conferma con il nome e i MB;
  «Annulla» → sul pannello non cambia niente; «OK» → sostituito. Deploy dello stesso progetto → nessuna domanda.
  Nella scheda Tipi: tipo nuovo senza istanze → «Crea istanza» → la variabile compare in Variabili e nell'albero con
  le foglie, e la card Host le offre nel ▾.

# Le immagini vecchie che restano sul pannello dopo un aggiornamento

> **Seme — decisione** (03-10-2026). Richiesta del maintainer durante il collaudo del
> [quadlet che viaggia](../archive/2026-10-02-quadlet-che-viaggia.md): «l'aggiornamento automatico del
> container del dispositivo può fare pulizia dei download precedenti una volta confermato
> l'aggiornamento?»
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per
> sviscerarne tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## L'idea

Dopo un aggiornamento **confermato**, il pannello toglie da sé le immagini che non gli servono più,
invece di accumularle finché lo spazio finisce.

## Misurato il 03-10-2026

- **TC620**: 9 immagini `sws-runtime` (`dev.1`…`dev.5`, `rc.14`, `rc.16` da archivio, `ghcr` `rc-arm64` e
  `latest-arm64`), una sola in uso. `podman system df`: 1,34 GB, **863 MB recuperabili (64 %)**, su una
  partizione dati da 10 GB con 3,1 GB liberi.
- **Gli archivi** non restano: l'aggiornamento dall'IDE non lascia `.tar.gz` sul pannello (quello trovato
  era stato copiato a mano per il collaudo).
- **Nessun percorso d'aggiornamento cancella immagini**: né `podman auto-update` (canale registro), né il
  deploy da archivio dell'IDE.
- **Esiste già la pulizia a mano**: IDE → Container → `prune_images` (`packaging.rs`, `podman image prune
  -a -f`, via SSH), nata da un pannello rimasto senza spazio con 18 immagini. `sonda.rs` e
  `install-container.sh` la suggeriscono quando lo spazio è poco.
- **Il «confermato» c'è già**: `aggiornamento_esito.rs` scrive «riuscito» solo dopo `CONFERMA_S` secondi
  di vita della versione nuova; prima, podman può ancora tornare all'immagine precedente (che quindi va
  tenuta fino a lì).
- **Il mezzo c'è già**: il runtime avvia servizi transitori sul bus utente (`display_target::bus::
  avvia_transitorio`, collaudato il 03-10 per riscrivere i quadlet) — un `podman image prune` girerebbe
  sull'host senza SSH e senza montare niente.

## Opzioni già visibili (da decidere)

1. **Cosa si tiene**: solo l'immagine in uso (`prune -a`, massimo spazio, nessun ritorno a mano) oppure
   anche la precedente (≈ 470 MB, una via di ritorno), oppure le ultime N.
2. **Canali**: un pannello sul canale archivio ha ancora immagini `ghcr` e viceversa — si toccano o no?
3. **Chi la fa partire**: l'esito «riuscito» dell'aggiornamento dal registro; il deploy da archivio
   dell'IDE (che ha un suo percorso); entrambi.
4. **Visibilità**: una riga nell'esito («liberati 860 MB»), una voce di audit, un'opzione per spegnerla.

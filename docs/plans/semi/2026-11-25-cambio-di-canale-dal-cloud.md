# Cambiare il canale di aggiornamento di un pannello dall'IDE del cloud (seme, 25-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi.

## L'idea

Il maintainer, 25-11-2026, collegato al TC620 di casa dall'IDE di sws.soligo.net: il pannello è sulla
`2.26.0-rc.29` del canale di prova e propone solo la rc.30, mentre il lavoro nuovo è sulla `2.27.0-dev.4`, nel canale
di sviluppo. Parole sue: «nell'IDE Cloud serve un meccanismo per passare dal canale stabile a quello di sviluppo».

Oggi per cambiare canale si reinstalla il pannello: Device → Install con un riferimento d'immagine scritto a mano, o
`ricarica.sh` da una macchina che raggiunge il pannello in SSH. Dal cloud un pannello di casa o di un impianto non si
raggiunge in SSH: passa solo dal tunnel.

## Le misure di oggi

- **Il canale è il tag dell'immagine** nel quadlet (`Image=` e `Environment=SWS_IMAGE`): `latest-<arch>` stabile,
  `rc-<arch>` prova, `dev-<arch>` sviluppo, un tag di versione = fissata, `localhost/…` = archivio
  (`sws-web/src/aggiornamento.rs`, `enum Canale` e `fn canale`).
- **«Aggiorna ora»** fa partire `podman auto-update` attraverso il bus utente di systemd; segue il tag del quadlet,
  quindi resta sul canale (`aggiornamento.rs`, intestazione del modulo).
- **Il runtime sa già riscrivere i propri quadlet** senza SSH: `sws-web/src/quadlet.rs` (`aggiorna`) copia template e
  installer nella cartella config e li fa girare con un servizio transitorio dell'utente (`--solo-unita`). È la strada
  del «quadlet che viaggia» (02-10-2026), e passa già dal tunnel.
- **L'installer** (`deploy/container/install-container.sh`) riscrive `Image=` e `SWS_IMAGE` con quello che installa
  (`--pull`, `--image`, `--tag`), e commenta `AutoUpdate=registry` per un'immagine da archivio.

## Le domande

- Il cambio di canale si fa con la stessa strada dei quadlet (installer con `--solo-unita` e il riferimento nuovo),
  poi un `podman auto-update`? Oppure con una riscrittura mirata di `Image=` e `SWS_IMAGE`?
- Chi può farlo e con quale conferma: un Admin, con l'elenco delle versioni che il pannello attraverserà (le Novità) e
  l'istantanea dei dati per tornare indietro, come «Aggiorna ora»?
- Dove sta nell'interfaccia: in Device → Connessione → «Aggiornamento del runtime», accanto al canale che si vede già?
- Tornare da sviluppo a stabile vuol dire scendere di versione (la dev è più alta della release): si permette, si
  avvisa, o si aspetta la release successiva?
- Un pannello installato da archivio o con una versione fissata può passare a un canale dal cloud?

# Cambiare il canale di aggiornamento di un pannello dall'IDE del cloud, e la release 2.27.0 (piano, 25-11-2026)

> **Piano** (era un seme fino al 25-11-2026 sera). Il maintainer: «se implementi questa cosa ti autorizzo a rilasciare
> una versione stabile che venga vista dal TC620 e lo porti alla 2.27.xxx, in questo momento ho solo dispositivi di
> test tutti in mano mia»; e «"questa cosa" → switch per saltare da devel a stable con opportuni warning».
>
> **Stato (25-11-2026, 21:20)**: fatto. Squash `d077bc4c` in `main`; release **2.27.0** (tag su `17d41858`, build
> `build_rc.sh --push` in 40 min sulle tre gambe; `latest-*`, `rc-*` e `dev-*` sulla 2.27.0); gateway del cloud sulla
> 2.27.0; Tiny TY pubblicato; `main` alla 2.28.0-dev.0; `release/2.27` eliminato. Resta il collaudo del maintainer
> (`docs/COLLAUDI_IN_SOSPESO.md`, sezione «Collaudo 2.27.0»). Dopo il collaudo il piano va in archivio.

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

## Le decisioni del maintainer (25-11-2026)

| | Domanda | Decisione |
|---|---|---|
| 1 | Che versione esce | **2.27.0 stabile**. Il blocco 2.27.0 di NOVITA si riduce a 15 voci (delegato), ramo `release/2.27`, `build_rc.sh` con le tre gambe, poi `main` alla 2.28.0-dev.0. |
| 2 | Scendere di versione | **Non si scende**: il canale scelto vale subito, ma l'immagine resta quella che gira finché il canale nuovo non ha una versione più alta. |
| 3 | Quali pannelli | **Tutti quelli in container**, anche con una versione fissata o installati da archivio: passano a un canale scaricando dal registry. |

## Il disegno

**Sul pannello** (`sws-web`):
1. `POST /api/update/channel` `{channel: "stable" | "test" | "dev"}`, solo Admin, nel registro. Gira attraverso il
   tunnel come `update/apply` (`/api/remote/update/channel`, `remote.rs`).
2. Il pannello legge dal registry la versione più alta del canale scelto (`migliore_nel_canale`). L'architettura viene
   dal tag dell'immagine, anche da uno fissato (`2.27.0-dev.3-arm64`) o da archivio (`localhost/…:…-arm64`); per un
   archivio il registry è quello pubblico.
3. **Più alta di quella che gira**: si cambia subito. Istantanea dei dati come «Aggiorna ora»
   (`prepara_e_avvia_staccato`), poi l'installer in un servizio transitorio dell'utente, come i quadlet
   (`quadlet.rs`): `install-container.sh --solo-unita --image-ref <registry>/<repo>:<canale>-<arch>`. L'installer
   riscrive `Image=` e `SWS_IMAGE`, rimette `AutoUpdate=registry` e riavvia: il container nuovo scarica l'immagine.
4. **Non più alta**: il canale scelto si scrive in `config/update_channel.json` e l'immagine non cambia. Lo stato
   (`/api/update/status`) dice il canale dell'immagine e quello scelto; «disponibile» si calcola sul canale scelto.
   «Aggiorna ora» e la finestra programmata, con un canale scelto, fanno il cambio del punto 3. Il file si toglie
   quando il runtime riparte con un'immagine di quel canale, o quando si sceglie di nuovo il canale dell'immagine.

**Nell'IDE** (`boot/AggiornamentoRuntime.tsx`): accanto al canale, un menu Stabile / Prova / Sviluppo con la conferma.
Gli avvisi:
- verso Sviluppo: «le versioni di sviluppo sono di prova: possono contenere difetti; per un impianto vero usa Stabile»;
- verso un canale più vecchio di quello che gira: «resti sulla X finché il canale Y non ha una versione più alta: non si
  scende di versione»;
- in tutti i casi: il pannello si riavvia (circa un minuto) se cambia subito, e prima si prende l'istantanea dei dati.

**La release 2.27.0**, dopo lo squash: `release/2.27` da `main`, NOVITA 2.27.0 a 15 voci più le compatibilità, la
sezione `[2.27.0]` del CHANGELOG con la data, `versione.sh --imposta 2.27.0`, tag, `build_rc.sh --push` (sposta
`latest-*` e `rc-*`: il TC620 sul canale di prova la vede), gateway del cloud sulla 2.27.0, riporto in `main` e
`main` alla 2.28.0-dev.0, ramo di release eliminato.

## Verifica

`cargo test` (la scelta fra cambio subito e canale in attesa; l'architettura da ogni forma di tag; il file del canale
scelto; lo stato col canale scelto), vitest (il menu, gli avvisi, la conferma), `check_static.sh`, CI; una revisione
prima della release. Il collaudo vero è del maintainer: il TC620 da casa, che vede la 2.27.0 col canale di prova.

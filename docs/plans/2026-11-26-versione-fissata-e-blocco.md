# Fissare una versione a un pannello, e il blocco di versione della piattaforma

> Piano del 26-11-2026. Esce nella `2.28.0-dev.2`, insieme al fix del firewall (`baa98062`).

## Contesto

Collaudo del cambio di canale sul PLX800 (26-11-2026). Il maintainer chiede: «alla prima occasione abilita la
possibilità di fissare una versione ad un device anche nella console di amministrazione». Le sue risposte:

- «La scelta va anche nel menu dell'IDE perché può essere una esigenza del cliente, il fix sulla console però ha la
  priorità, mi può servire ad evitare il rilascio di un aggiornamento o comunque posticiparlo.»
- «Il fix è sulla versione che gira o su una versione maggiore fino a un tot»: un pannello sulla 2.27, con le versioni
  fino alla 2.34 pubblicate, si può fissare alla 2.31. **Mai più in basso** di quella che gira.
- I permessi: «ogni admin può ovviamente gestire solo la sua azienda, ogni utente solo i suoi device. Un
  amministratore di piattaforma può imporre blocchi di versione ma non aggiornare i pannelli dei clienti.»

Oggi: la rotta `POST /api/update/channel` conosce solo `stable`, `test`, `dev` (`sws-web/src/update_channel.rs`); una
versione si fissa solo reinstallando (Device → Installazione); la console (`console/Pannelli.tsx`) non ha niente sugli
aggiornamenti. Un aggiornamento parte solo da SWS (`podman-auto-update.service` avviato da `aggiornamento.rs`):
«Aggiorna ora», la finestra, il pilota automatico e il cambio di canale.

## Due cose diverse

1. **Fissare una versione** (il cliente, dall'IDE). Chi ha il ruolo Admin del pannello sceglie una versione fra
   quella che gira e l'ultima pubblicata (e non sopra il blocco). Il pannello passa all'immagine `X-<arch>` senza
   aggiornamento automatico: istantanea dei dati, installer, riavvio di circa un minuto. Con la versione che gira
   cambia solo il quadlet (niente più `AutoUpdate=registry`), e il riavvio serve lo stesso. Si torna a un canale con
   il menu Canale che c'è già.
2. **Il blocco di versione** (la piattaforma, dalla console). Chi amministra la piattaforma fissa un **tetto** per un
   pannello: «non oltre la 2.31.0», o lo toglie. Il blocco **non aggiorna niente e non riavvia niente**: dice solo fin
   dove il pannello può salire. Ogni strada di aggiornamento lo rispetta: «disponibile» non lo supera, «Aggiorna ora»,
   la finestra e il pilota automatico rifiutano una testa di canale oltre il tetto, il cambio di canale aspetta, il menu
   «Fissa una versione» non offre versioni oltre. Un pannello già sopra il tetto resta dov'è (la piattaforma non
   cambia la versione dei clienti, nemmeno all'ingiù).

## L'approccio

### A. Il pannello (`sws-web`)

- `update_channel.rs`: `POST /api/update/channel` accetta anche `{ "pin": "2.31.0" }`. Controlli: la versione è
  pubblicata per l'architettura (tag `2.31.0-<arch>` nel registry), non è più bassa di quella che gira, non supera il
  blocco. Poi `start_switch` con `…:2.31.0-<arch>`, dopo l'istantanea come per un canale. Registro `update.pin`.
- `GET /api/update/versions` (Admin): `{ running, arch, versions: [...], cap }`, le versioni pubblicate per
  l'architettura, dalla più vecchia, solo quelle `>=` della versione che gira e `<=` del blocco. Il proxy dell'IDE:
  `/api/remote/update/versions` (`remote.rs`, come `update/status`).
- Il blocco: `config/update_cap.json` `{ max, by, since_ms }`. Lo scrive solo `POST /api/update/cap` con la **firma
  del gateway** (`abbinamento.firma_valida`, come `schermo::dal_gateway`); `{ "max": null }` lo toglie. Registro
  `update.cap`. Senza firma: 404.
- `StatoAggiornamento`: `cap: Option<String>`; `disponibile` non supera il tetto; un campo che dice se la testa del
  canale è oltre il tetto, per il testo dell'IDE.
- Il tetto in ogni strada: `aggiornamento_avvia`, la finestra e il pilota automatico (`aggiornamento_finestra.rs`), il
  cambio di canale (`decide` → `Wait`), il pin.

### B. Il gateway

- `tunnel/abbinati.rs`: il pannello abbinato ricorda `blocco_versione: Option<String>` (come `schermo_spento`).
- `POST /api/amministrazione/pannelli/:nome/blocco` `{ max: "2.31.0" | null }`, solo per chi amministra la
  piattaforma (stesso gruppo di `…/schermo`). Salva, e se il pannello è collegato manda `POST /api/update/cap` nel
  tunnel con la firma (`firma_per`, `attraverso`). Registro `pannello.blocco_versione`.
- All'apertura del tunnel il gateway rimanda il blocco salvato (anche `null`): un pannello spento al momento della
  scelta lo riceve quando torna.
- `GET /api/amministrazione/versioni`: le versioni pubblicate su ghcr (dai tag `X-arm64`/`X-amd64`), per il menu della
  console.

### C. La console — priorità

`console/Pannelli.tsx`: per ogni pannello una colonna «Blocco versione» (vuota = nessun blocco) e l'azione «Blocco
versione…»: un elenco delle versioni pubblicate e «Nessun blocco». La spiegazione nella finestra: il blocco non
aggiorna il pannello, dice fin dove può salire.

### D. L'IDE

`boot/AggiornamentoRuntime.tsx`, menu Canale: la voce «Fissa una versione…» con le versioni di
`/api/remote/update/versions`; conferma con l'istantanea e il riavvio. La riga dello stato dice il blocco, quando c'è:
«Bloccato fino alla 2.31.0 dall'amministrazione della piattaforma».

## Verifica

- `cargo test`: il pin (sotto la versione che gira: rifiutato; sopra il blocco: rifiutato; non pubblicato:
  rifiutato), il blocco (`disponibile` tagliato, `decide` aspetta, rotta senza firma = 404), le rotte
  (`/api/update/cap` fuori da `require_admin` ma con la firma; `…/blocco` solo per l'amministratore di piattaforma).
- vitest: la colonna e la finestra della console; la voce del menu dell'IDE e la riga del blocco.
- Collaudo (`/test-changes`):
  1. console → blocco del WP630 alla 2.28.0-dev.1: il WP630 lo riceve (`update_cap.json`), lo stato lo dice;
  2. il PLX800 (2.27.0 fissata) → «Fissa una versione» → 2.28.0-dev.1: istantanea, riavvio, quadlet con
     `2.28.0-dev.1-arm64` senza `AutoUpdate`;
  3. il blocco a una versione più bassa della testa del canale: «Aggiorna ora» non la offre;
  4. il blocco tolto dalla console: il pannello lo dimentica.

# Il quadlet che viaggia, e il viewer che riparte

## Context

`podman auto-update` sostituisce l'**immagine**; i quadlet (`~/.config/containers/systemd/
sws-runtime.container`, `sws-lvgl-viewer.container`) restano quelli scritti dall'installer. Ogni riga
nuova arriva solo reinstallando dall'IDE: è successo con `Timezone=local` (28-09, TC620 rimasto in
UTC), col bus utente/`AutoUpdate`/`Notify=healthy` (un pannello vecchio non si aggiorna affatto), con
la cartella dati del viewer (02-10). Seme gemello (01-10, WP630): dopo «Aggiorna ora» **il viewer LVGL
resta spento** — `Restart=on-failure` dalla nascita, e un difetto del runtime (sotto).

Misurato il 02-10 (tre ricerche):
- nessuna versione di quadlet registrata da nessuna parte; l'immagine **non** contiene i quadlet (li
  porta l'IDE con `include_str!`, `packaging.rs:823-847`); l'installer li copia e li ritocca con `sed`
  (`install-container.sh:413-533`: `Image=`, `SWS_IMAGE`, uid del bus, `AutoUpdate` per `localhost/`,
  `Notify`/`Timezone` per podman < 5, prefisso dati, devicetree, `Network=host`);
- il runtime ha il **bus utente di systemd** (`display_target.rs:163-224`, `aggiornamento.rs:492`) e
  la cartella config montata (`SWS_HOST_CONFIG_DIR`); `~/.config/containers/systemd` **non** è
  montata;
- `/api/system` ha già `avvisi: Vec<Avviso>` con `rimedio` (`system.rs:41,343`), mostrati da
  `RuntimeCtrl.tsx` e accanto a `StatoDisplay`/`AggiornamentoRuntime` nell'IDE;
- **difetto**: `display_target.rs:269-272` — se `RestartUnit` del viewer fallisce l'esito è «errore»
  ma il motore applicato diventa LVGL lo stesso, e non si riprova mai;
- `--uninstall` non toglie il quadlet del viewer.

**Decisioni del maintainer (02-10-2026):** il pannello **rileva** da sé un quadlet vecchio e lo
**aggiorna con conferma** (pulsante in IDE e sul pannello: un'unità transitoria sul bus utente che
scrive solo in `~/.config`, come l'installer — nessun file di sistema, nessun SSH); il **viewer che non
riparte** entra in questo piano; i quadlet **viaggiano dentro l'immagine**.

## Primo passo all'approvazione

Scrivere questo piano in `docs/plans/2026-10-02-quadlet-che-viaggia.md`; i due semi
(`2026-09-29-quadlet-che-non-viaggia.md`, `2026-10-01-viewer-non-riparte-dopo-aggiornamento.md`) in
`docs/archive/` con riga «assorbito dal piano del 02-10»; righe aggiornate nei due README. Un ramo:
`feat/quadlet-che-viaggia`.

## 1. Versione del quadlet

- Ogni template in `deploy/container/` porta la versione nella **`Description=`** di `[Unit]`
  (es. `Description=SWS runtime [quadlet 7]`): systemd la espone come proprietà dell'unità, quindi il
  runtime legge **entrambe** (anche quella del viewer) dal bus utente senza montare niente. Un'unità
  senza `[quadlet N]` vale **0** (installazioni di oggi).
- Una sola fonte del numero atteso: i template stessi (dentro l'immagine, §2).
- Guardia `scripts/check_quadlet.sh` (in `check_static.sh`): fixture
  `tests/fixtures/quadlet-versioni.json` con l'hash di ogni template e il suo numero — un template
  cambiato senza alzare il numero è rosso; lo stesso numero sui due file.
- Etichetta OCI `net.soligo.sws.quadlet=N` in `build_container.sh`: il runtime la legge **prima**
  di aggiornare (con le altre etichette, `aggiornamento.rs:346`) e, se la versione nuova vuole un
  quadlet più recente di quello installato, lo dice fra gli avvisi di compatibilità.

## 2. I quadlet dentro l'immagine

- `Containerfile.aarch64`/`.x86_64` copiano `deploy/container/{sws-runtime,sws-lvgl-viewer}.container`
  e `install-container.sh` in `/usr/share/sws/quadlet/` (contesto di `build_container.sh`).
- L'IDE continua a installare con la sua copia (`packaging.rs`, stesso commit dell'immagine).

## 3. Riscrivere i quadlet dal pannello

- **Installer, modalità nuova `--solo-unita`** (`install-container.sh`): rifà **solo** il passo 5
  (template → `~/.config/containers/systemd/`, stessi `sed`) senza toccare immagine né container.
  I parametri d'installazione li ricava **dai quadlet già presenti** (gira sull'host e li legge):
  `Image=`, prefisso dei `Volume=` dati, `Network=host`; podman, uid e devicetree li rileva come oggi.
  Poi `daemon-reload`, riavvio del runtime e del viewer se era attivo. Corregge anche `--uninstall`
  (via il quadlet del viewer).
- **Runtime** (`sws-web`, modulo nuovo `quadlet.rs`):
  - `stato()` → versione installata (runtime e viewer, dalle `Description` via bus utente; serve
    `LoadUnit` per un'unità non caricata) e attesa (dai template in `/usr/share/sws/quadlet/`);
  - `aggiorna()` → copia template + installer da `/usr/share/sws/quadlet/` nella cartella config
    montata (`<config>/quadlet-nuovo/`), poi `StartTransientUnit` sul bus utente
    (`sws-quadlet-aggiorna.service`, `ExecStart=/bin/sh <host>/quadlet-nuovo/install-container.sh
    --solo-unita`, percorso host da `SWS_HOST_CONFIG_DIR`): l'unità transitoria sopravvive al
    riavvio del runtime che provoca. Esito scritto in un file nella cartella config e letto al
    riavvio, come `aggiornamento_esito.rs`.
  - Nuovi helper nel `mod bus` di `display_target.rs` (o estratti in un modulo comune):
    proprietà stringa di un'unità, `LoadUnit`, `StartTransientUnit`.
- **API**: `GET /api/quadlet` (stato), `POST /api/quadlet/aggiorna` (con ruolo di amministrazione,
  come `/api/update/apply`); entrambe anche sulla porta di gestione remota (la lezione del
  `deploy_only_app`). Avviso in `/api/system` (`calcola_avvisi`): «configurazione del servizio
  vecchia (N, attesa M)» col rimedio.
- **IDE**: in Istanza → Device, accanto ad `AggiornamentoRuntime`, la riga «Configurazione del
  servizio» con stato e pulsante «Aggiorna» (conferma: «il pannello si riavvia»).
- **Pannello**: l'avviso nell'overlay web (`AvvisoAggiornamento.tsx`) e in quello LVGL
  (`lvgl_avviso.rs`), sui pannelli senza utenti come l'avviso di aggiornamento, con lo stesso
  pulsante. Testi in it/en (testi di sistema o i18n secondo dove stanno).

## 4. Il viewer che riparte

- Quadlet del viewer: `Restart=always` (un `StopUnit` esplicito del runtime non lo fa ripartire:
  systemd non applica `Restart=` a un arresto chiesto) — arriva col meccanismo del §3 (quadlet 1).
- `display_target.rs`: un `RestartUnit` fallito **non** segna LVGL come applicato; si riprova al
  giro dopo (con un tetto e l'esito visibile in `StatoDisplay`).
- Dopo un riavvio del runtime con motore LVGL: controllo che il viewer sia attivo per i primi minuti
  (`unit_attiva`), e se non lo è un `StartUnit` — copre la corsa con `podman auto-update`.

## 5. Documenti

`NOVITA.yaml` (voce + `compatibilita` per la versione che porta il meccanismo: i pannelli di oggi
mostreranno «configurazione del servizio da aggiornare»), CHANGELOG, `docs/TEST_SETUPS.md` (come
aggiornare il quadlet), HOWTO (capitolo nuovo), manuale (Istanza → Device).

## Stato (03-10-2026) — fatto e collaudato

Squash su `main` come 2.12.0-rc.16. Prima del collaudo: §1-§5 fatti; verdi `cargo check`,
446 test `sws-web`, 280 `sws-lvgl-viewer`, 1065 vitest, `pnpm build`, 29 guardie (`check_quadlet.sh` provata rossa, e il
test shell di `--solo-unita` su un pannello finto). Il riquadro LVGL visto con `--avviso-di-prova quadlet`.

**Collaudo sul TC620 (03-10-2026).** Il pannello era installato da archivio (`localhost/…:rc.14`), quindi «Aggiorna ora»
dall'IDE avrebbe reinstallato anche i quadlet e saltato la prova. Si è simulato `podman auto-update`: archivio rc.16
caricato a mano e **solo** `Image=` cambiata nei quadlet senza numero. Risultato:
- avviso «configurazione del servizio da aggiornare (0 → 1)», «Aggiorna» → servizio transitorio
  `sws-quadlet-aggiorna-<ts>` (5 s, raccolto alla fine), quadlet 1 su runtime e viewer, viewer `Restart=always`;
- conservati immagine, cartella dati `/data/user/sws`, `Network=host`, device-tree, bus utente, `Timezone=local`,
  `Notify=healthy`; immagine e container non toccati; esito `riuscito` 0 → 1;
- `systemctl --user stop sws-lvgl-viewer` → il viewer riparte da sé in ~30 s (la sorveglianza del runtime);
- difetto trovato e corretto: `/api/system` diceva «in corso» per un minuto, perché la cache di 60 s dello stato era
  piena da prima che `all_avvio` scrivesse l'esito — ora la svuota (non è nella rc.16, arriva con la successiva).

Notato: il servizio gira sotto `user` (uid 1000), non sotto `pixsys`. «Gestione container» dell'IDE ritocca
`WantedBy=`/`Restart=` via SSH; l'aggiornamento della configurazione le riporta al template, come la reinstallazione
(scritto nel manuale). Seguito: [pulizia delle immagini dopo un aggiornamento](2026-10-03-pulizia-immagini-dopo-aggiornamento.md).

## Verifica

- Test Rust puri: lettura di `[quadlet N]` da una `Description`, decisione stato/attesa, scelta
  del rimedio, comando della transitoria, regola di ritentativo del viewer.
- `install-container.sh --solo-unita` provato in locale con una `HOME` di prova (quadlet vecchi finti
  → nuovi, parametri conservati; `bash -n` + un test shell nella guardia).
- `check_quadlet.sh` provato rosso (template cambiato senza numero).
- `cargo check`, `cargo test`, `pnpm build`, vitest, `check_static.sh`.
- **Sul TC620** (chiedendo prima l'SSH): rc con la funzione, installazione con quadlet vecchio →
  avviso → «Aggiorna» → quadlet nuovo, servizio ripartito, viewer su; poi «Aggiorna ora» e viewer
  ancora su. Collaudo finale del maintainer.

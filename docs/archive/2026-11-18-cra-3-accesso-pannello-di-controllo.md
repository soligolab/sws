# CRA, sessione 3: accesso al pannello di controllo, credenziali di fabbrica, OpenPLC

> **Stato: archiviato il 20-11-2026** — **FATTO**, nella rc.21 (squash `5bdaba816`); il collaudo in `docs/COLLAUDI_IN_SOSPESO.md`.

> Piano della sessione 3 delle [sessioni CRA](../plans/2026-11-17-cra-sessioni-e-decisioni.md). Ramo
> `fix/cra-3-control-panel-access`, **annidato** su `fix/cra-2-cloud-isolation-sandbox`. Misurato sul codice del ramo
> il 18-11-2026. Le decisioni D13-D18 e D20 le ha rivista il maintainer prima del codice (18-11, «rivediamo assieme le
> decisioni della sessione 3»); D19 e D21 sono prese in autonomia, da validare a fine sessione.
>
> **Fatto il 18-11-2026, da validare** (D19 e D21; D19 è cambiata durante il lavoro, vedi sotto). Le voci da provare
> sui dispositivi sono in `docs/COLLAUDI_IN_SOSPESO.md`, «CRA, sessione 3».
>
> **Scopo**: dalla rete, senza credenziali, non si arriva a reset, rete e spegnimento; niente `admin`/`admin`;
> l'utente dell'Editor di OpenPLC non lo crea il primo che passa; nel cloud un progetto non si prende tutta la CPU.

## I fatti

| Tema | Oggi | Dove |
|---|---|---|
| PIN iniziale | Le ultime sei cifre del MAC. Vale da qualunque indirizzo finché il progetto non ha un PIN suo; con quello si apre la sessione di servizio e si fa il reset | `control_panel/pin.rs:41-88`, `control_panel/mod.rs:306-340`, `control_panel/reset.rs:99-150` |
| Da dove arriva una richiesta | Il kiosk e i viewer LVGL chiamano `https://localhost:7443` o `127.0.0.1:7443`. Lo schermo remoto del cloud arriva **anche lui** da 127.0.0.1 sulla stessa porta (`schermo.rs::dal_gateway` gira la richiesta alla pagina operatore); il tunnel arriva da 127.0.0.1 sulla porta di gestione. L'indirizzo di chi chiama è già nelle estensioni della richiesta (`main.rs:2062`) | `sws-runtime/src/main.rs:1980-2095`, `schermo.rs:62-90`, `tunnel/pannello.rs:282-300` |
| Blocco dei PIN | Uno solo per tutto il pannello: 5 errori da chiunque, 60 s di blocco per tutti, schermo compreso. Un riavvio lo toglie. Solo nel log, non nell'audit | `control_panel/mod.rs:56-69`, `:317-330` |
| Codice di abbinamento | `GET /api/abbinamento` lo dà a chiunque, finché il pannello non ha utenti (decisione 14 dell'11-10) | `abbinamento.rs:410-434` |
| Cambio password | Il router della porta di gestione blocca chi deve cambiarla; quello del viewer no: scrive tag, riconosce allarmi, applica ricette. Il viewer web ha la pagina (con «Più tardi»), il viewer LVGL no | `router.rs:1305-1313`, `:2140-2240`, `sws-editor/src/runtime-view/RuntimeView.tsx:573-581` |
| Installazioni native | `SWS_ADMIN_PASSWORD=admin` di default: un progetto senza utenti riceve `admin`/`admin`. Il servizio gira da root (Yocto e Linux generico) | `deploy/yocto/sws-runtime-launch.sh:23-24`, `deploy/generic-linux/sws-runtime-launch.sh:24-25`, `install.sh:110-111`, i due `sws-runtime.service` |
| OpenPLC | Porte su tutte le interfacce (decisione del 30-10). L'Editor non ha un utente finché il primo che si collega non lo crea (`POST /api/create-user` senza credenziali su un archivio vuoto). Immagine presa per tag | `deploy/container/install-container.sh:239`, `:324-354`; `restapi.py` dell'immagine v4.3.1 |
| Guardia delle rotte aperte | Legge solo i gruppi `let open`: non vede `aperte` di `deploy_only_app` né le rotte del pannello di controllo | `scripts/check_rotte_preauth.sh:153-160` |
| CPU nel cloud | Nessun tetto. Sul VPS il controller `cpu` è delegato (misurato il 18-11) | `gateway/progetti.rs:660-672` |

## Le decisioni (nel registro, «Sessione 3»)

- **D13 — Il PIN iniziale vale solo dallo schermo del pannello.** «Schermo» vuol dire: porta del viewer, indirizzo
  127.0.0.1 o ::1, e nessuna intestazione dello schermo remoto. `dal_gateway` aggiunge quell'intestazione a tutto
  quello che inoltra; chi la manda da fuori non è comunque sul loopback. Dalla rete e dallo schermo remoto vale solo il
  PIN del progetto; se il progetto non ne ha, il pannello di controllo dice di impostarlo dall'IDE.
- **D14 — Dallo schermo remoto il reset si fa solo nella forma «tieni il cloud»**, col PIN del progetto. Quello
  completo toglierebbe l'abbinamento e il pannello sparirebbe dal cloud.
- **D15 — Il blocco resta temporaneo** (5 errori, 60 s, un riavvio lo toglie) **ma si conta per origine**: lo
  schermo, lo schermo remoto, ogni indirizzo di rete. PIN sbagliati, blocchi e sessioni aperte vanno nell'audit.
- **D16 — Il codice di abbinamento si mostra solo allo schermo**, nel log e nell'installer. Dalla rete la pagina dice
  dove leggerlo. Supera la decisione 14 dell'11-10.
- **D17 — Il cambio password vale sulle due porte.** Sulla porta del viewer chi deve cambiarla legge come un anonimo
  ma non scrive e non comanda, finché non la cambia o sceglie «Più tardi» (che finisce nell'audit, come oggi). Il
  viewer LVGL riceve la sua pagina: nuova password e conferma, con la password appena data all'accesso tenuta in
  memoria; se non c'è (sessione ripresa dopo un riavvio), prima si rientra.
- **D18 — Le installazioni native non hanno più `admin`/`admin`**: partono in attesa col codice di abbinamento, come
  il container, e l'installer lo stampa. Un utente `admin` con password `admin` rimasto nel progetto di
  un'installazione vecchia deve cambiarla al primo accesso.
- **D19 — Niente root, da nessuna parte** (validata dal maintainer il 18-11): Linux generico come utente di sistema
  `sws`, con la regola polkit del Tiny TY; il binario nativo Yocto e i suoi viewer come `user`, l'utente del pannello
  («l'utente user può fare tutto»).
- **D20 — OpenPLC: l'installazione crea l'utente dell'Editor** (`admin`, password casuale di 10 caratteri senza
  simboli e senza lettere che si confondono, lo stesso alfabeto del punto d'accesso Wi-Fi). Le credenziali stanno in
  `<config>/openplc-credentials.json` (0600) e si leggono nel pannello di controllo, sezione OpenPLC, dietro il PIN.
  Se OpenPLC ha già un utente fatto fuori da SWS, la sezione dice che la password non è nota qui. Immagine per
  digest.
- **D21 — Nel cloud ogni container di progetto ha un tetto di un core** (in autonomia, validata il 18-11), solo dove
  podman dice di saperlo applicare (`cgroupControllers` contiene `cpu`); altrove si apre senza, con un avviso. Il peso
  più basso del piano è stato tolto: vedi «Le alternative per la CPU nel cloud» in fondo.

## I passi

1. **Origine della richiesta e PIN** (D13-D15). `control_panel::routes(listener)`: solo il router del viewer passa
   «viewer». Una funzione `origin(listener, peer, headers)` → `Screen | RemoteScreen | Network(ip)`. `pin_matches`
   riceve l'origine. Blocco per origine, con un tetto alle voci. Audit di errori, blocchi, sessioni. `status`
   restituisce l'origine e se il PIN iniziale vale da lì; `/info` dà il PIN iniziale solo allo schermo. Reset:
   dallo schermo remoto solo `keep_cloud`. Le due interfacce (web e LVGL) mostrano i messaggi giusti. Test del
   router per le tre origini.
2. **Codice di abbinamento solo allo schermo** (D16). `abbinamento::stato` col loopback della porta del viewer o della
   porta di gestione chiamata dall'installer stesso (127.0.0.1 senza firma del gateway). `AbbinamentoScreen` senza
   codice dice di leggerlo sullo schermo. Test.
3. **Cambio password sul viewer** (D17). Router del viewer: le scritture e le rotte Operator/Admin dietro
   `require_password_changed`. LVGL: `LoginOk.must_change_password`, la schermata a due campi (stesse misure di quella
   d'accesso), `change-password` e `rimanda-cambio-password` nel client, i testi in it/en. Test del router e del
   client LVGL.
4. **Installazioni native** (D18, D19). Script Yocto e Linux generico senza default, l'installer stampa il codice
   (come `install-container.sh:1103-1116`); Linux generico con utente non root e `chown` dei dati. `sws-auth`: all'apertura di un archivio,
   un `admin` con password `admin` riceve `must_change_password`. Test di `sws-auth`; `bash -n` degli script.
5. **OpenPLC** (D20). Installer: digest, `POST https://127.0.0.1:8443/api/create-user` appena la 8443 risponde,
   credenziali nel file. Runtime: `GET /api/control-panel/openplc` (dietro la sessione): installato, risponde,
   versione, porte, credenziali. Sezione OpenPLC nel pannello di controllo web e LVGL, solo se OpenPLC è installato.
   I testi dell'IDE che dicono «il primo che si collega lo crea» cambiano. Test.
6. **La guardia delle rotte aperte**: legge anche `aperte` e il gruppo aperto di `control_panel::routes()`, e
   controlla che il resto stia dietro `require_session`.
7. **CPU nel cloud** (D21). `resource_limits.cpu` (quota e peso) se `GET /libpod/info` elenca `cpu`. Prova con
   podman su theobroma (controller `cpu` delegato anche qui).
8. **Documenti**: registro (D13-D21), valutazione del rischio, capitolo 17 del manuale, collaudi, CHANGELOG, Novità
   (righe di compatibilità: PIN iniziale, codice, password `admin`), STATUS.

## Cosa può andare storto

| Rischio | Come si evita |
|---|---|
| Il tecnico che apriva il pannello di controllo dal portatile resta fuori | Il messaggio dice di impostare il PIN del progetto dall'IDE; riga nelle Novità |
| Un pannello `--bridge` non riconosce lo schermo | Lì serve sempre il PIN del progetto: lo si scrive nel manuale e nel messaggio |
| Un'installazione nativa da root, aggiornata, non legge più i suoi file | L'installer fa il `chown` della cartella dati; voce di collaudo su un dispositivo Yocto dell'ufficio |
| Un operatore LVGL col cambio password da fare resta bloccato | «Più tardi» c'è anche lì; senza password in memoria si torna all'accesso, non a un vicolo cieco |
| OpenPLC già installato con un utente | L'installer non tocca un archivio con utenti; la sezione lo dice |
| Un gateway su una macchina senza delega della CPU | Il tetto si mette solo se podman lo sa applicare |

## Verifica

- Automatica: `cargo test` del workspace, `clippy -D warnings`, `fmt`, `pnpm build`, `vitest`, `lint`, `type-check`,
  `check_static.sh`.
- Sui dispositivi (voci in `docs/COLLAUDI_IN_SOSPESO.md`): dal PC `POST /api/control-panel/session` col PIN del MAC dà
  401, dallo schermo entra; reset dallo schermo remoto; la pagina di cambio password su TC620 e TY570; OpenPLC
  installato da zero sul WP630; un'installazione Yocto non root; nel cloud un progetto con un ciclo infinito non
  rallenta gli altri.

## Dopo la revisione (18-11-2026)

Due revisioni indipendenti, una sugli attacchi e una sulle regressioni. Le correzioni sono nel registro delle
decisioni, «Dopo le due revisioni della sessione 3». Cambiano tre cose del piano:

- l'origine ha un quarto caso, **`Tunnel`** (la porta di gestione dal loopback), che per il reset vale come lo schermo
  remoto;
- il codice di abbinamento si dà solo sulla **porta del viewer**, e una pagina di un altro sito in un browser sul
  dispositivo conta come rete;
- D18 diventa un obbligo vero: `admin`/`admin` non si rimanda.

Restano da provare su un dispositivo: un'installazione `--bridge` (il port forwarder di podman senza root potrebbe
non conservare il loopback, e allora lo schermo vale come rete); un container di OpenPLC che raggiunge il loopback
dell'host.

## Le alternative per la CPU nel cloud (18-11-2026)

Misurato su theobroma e sul VPS: i container che il gateway crea con l'API di podman stanno in
`user@1000.service/user.slice`, il gateway, Traefik, Portainer e il manuale (servizi quadlet) in
`user@1000.service/app.slice`. I due rami hanno peso 100: sotto carico systemd dà metà CPU a ciascuno.

| Strada | Cosa protegge | Costo |
|---|---|---|
| Tetto di un core per progetto (fatto) | un progetto solo non prende tutto il VPS | niente |
| Peso per container (tolto) | niente: pesa i progetti fra loro, e sono tutti uguali | — |
| Tetto su tutto il ramo dei progetti (`CPUQuota=150%` su `user.slice` dell'utente del VPS) — **scelta, 18-11** | il gateway ha sempre almeno mezzo core, anche con molti progetti impazziti | un drop-in di systemd sul VPS, nel rilascio: `deploy/vps/user-systemd/` |
| Peso più basso al ramo dei progetti (`CPUWeight=50`) | sotto carico il gateway e gli altri servizi hanno due terzi della CPU | come sopra |
| Tetti per azienda (un ramo per azienda) | un'azienda non rallenta le altre | lavoro vero: va coi piani commerciali |
| Tempo massimo dentro gli script Python | la causa, non l'effetto | costa CPU sul Tiny TY: scartato nella sessione 2 |


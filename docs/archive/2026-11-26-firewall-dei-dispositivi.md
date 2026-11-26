# Il firewall dei dispositivi: porte aperte all'installazione e pannello delle regole

## Contesto

Il 26-11-2026 il WP630 è passato a **Pixsys OS 2.2.0**, che porta `firewalld` attivo (zona `public` su `ethernet0`).
La zona apre ssh, http, https, mdns, codesys e altri servizi, ma **non 7443 e 7444**. Dalla LAN l'IDE e il viewer non
raggiungono più il pannello («Nessun instradamento per l'host»). Il cloud funziona, perché il tunnel è una
connessione uscente. Sul pannello l'utente `user` ha il permesso polkit per cambiare la configurazione
(`pkcheck org.fedoraproject.FirewallD1.config` = 0), e il bus di sistema è già montato nel container.

Il maintainer chiede, **tutto e subito sulla dev**:
1. l'installazione di SWS apre le porte che servono;
2. un pannello per le regole del firewall dei dispositivi con firewalld attivo: **nell'IDE, nel pannello di
   controllo web e in quello LVGL**;
3. le funzioni: servizi e porte delle zone, **più le regole per sorgente** (rich rule);
4. ogni modifica con la **barra dei 60 s**, come la rete: senza «Conferma», torna com'era.

API di firewalld 1.3.2 misurata sul WP630 (`busctl introspect`): `FirewallD1.zone` con `getActiveZones`,
`getZoneSettings2`, `addPort(sssi)`, `removePort`, `addService(ssi)`, `removeService`, `addRichRule(ssi)`,
`removeRichRule`; `FirewallD1.config` con `getZoneByName` → `config.zone` (permanente), `addService2` (servizio nuovo),
`getServiceNames`; `FirewallD1.reload`.

## L'approccio

### A. Il nucleo nel runtime — `sws-runtime/crates/sws-web/src/firewall.rs` (nuovo)

- Client zbus sul bus di sistema, come `control_panel/dbus.rs` (riusa `system()`, `get_all`, `prop`, li rende
  `pub(crate)`). firewalld assente (`ServiceUnknown`) = funzione non disponibile, come `launcher_dbus.rs`.
- `stato()`: le zone attive (interfacce, sorgenti), per ognuna servizi, porte e rich rule, la zona predefinita,
  l'elenco dei servizi noti, e **le porte su cui ascolta SWS** con «aperta/chiusa». Le porte di SWS si leggono da
  `/proc/self/fd` (socket del processo) incrociati con `/proc/net/tcp{,6}` e `udp{,6}` in LISTEN, escluse quelle su
  loopback: valgono 7443/7444 e le porte del progetto (OPC UA, Modbus server, …), senza leggere il progetto.
- **Le regole già presenti si gestiscono tutte**, non solo quelle create da SWS: i servizi della zona di Pixsys OS
  (atvise, cockpit, codesys, codesysedge, finder, http, https, logiclab, mdns, pixsys-portal, ssh), le porte e le rich
  rule. Ogni voce ha un interruttore **attiva / disattivata** e, per porte e rich rule, **Modifica**.
  - firewalld non ha uno stato «disattivata»: disattivare = togliere la voce dalla zona. La definizione del servizio
    resta nel sistema. SWS ricorda le voci disattivate da lui in `config/firewall.json` (zona, voce, quando, chi), così
    restano in elenco come interruttori spenti e si riattivano con un tocco.
  - Modificare = togliere la voce vecchia e aggiungere quella nuova **nella stessa modifica**: una barra sola, e
    l'annullamento rimette la vecchia.
- `Modifica` = **un elenco di operazioni** `{zona, azione: aggiungi|togli, cosa: servizio | porta+protocollo | rich
  rule}`, applicate insieme: si possono spegnere più voci e confermare una volta sola. Le rich rule si creano da un
  modulo strutturato (famiglia, sorgente IP/CIDR, porta+protocollo o servizio, accept/reject/drop) e il testo si
  compone e si valida in Rust; quelle esistenti scritte a mano si mostrano come testo, si disattivano, e si modificano
  nel modulo se il modulo le sa leggere, altrimenti come testo.
- **Barra dei 60 s**, una modifica alla volta (una seconda mentre una aspetta = 409):
  1. *applica*: solo runtime. Un'aggiunta usa il `timeout` di firewalld (60 s): se SWS cade, firewalld la toglie da
     solo. Una rimozione si annulla con l'operazione inversa da un timer.
  2. *conferma*: la stessa operazione sulla configurazione permanente (`config.zone`), e in runtime l'aggiunta
     temporanea diventa definitiva (rimuovi + aggiungi senza timeout).
  3. *annulla* o scadenza: operazione inversa in runtime.
  - Stessi tempi della rete: `CONFIRM_WITHIN_SECS` di `control_panel/backend.rs`.
- Nessuna porta bloccata: con la barra dei 60 s chiudere 7444 dalla LAN si annulla da solo. L'interfaccia avvisa in
  rosso quando una modifica chiude una porta di SWS o ssh.
- `assicura_porte_sws()` all'avvio del runtime, **solo su un dispositivo** e **una volta sola**: se firewalld è attivo
  e 7443/7444 sono chiuse nella zona delle interfacce, le apre come porte, permanente e runtime. Un segno in `config/firewall.json` (`sws_ports_opened`) evita di riaprire porte che un admin
  ha chiuso dopo. È la strada per i pannelli **già installati** (il WP630 si aggiorna dal registro, senza installer).
- Registro delle azioni: `firewall.apply`, `firewall.confirm`, `firewall.rollback`, `firewall.sws_ports`, con zona,
  modifica e utente/origine.
- Un backend `Fake` (variabile `SWS_CONTROL_PANEL_FAKE=1`, come `control_panel/backend.rs`) per i test e lo sviluppo
  locale.

### B. Le API

- **Pannello di controllo** (sessione col PIN), in `control_panel/mod.rs` dentro il gruppo con `require_session`:
  `GET /api/control-panel/firewall`, `POST …/firewall/apply`, `POST …/firewall/confirm`, `POST …/firewall/rollback`.
  `Capabilities.firewall: bool` (`#[serde(default)]`) in `backend.rs`, provata in `dbus::capabilities()`.
- **Gestione su 7444** (IDE), Admin: `GET /api/firewall`, `POST /api/firewall/{apply,confirm,rollback}` in
  `deploy_only_app()` e in `build()` di `router.rs`, sotto `require_admin`. Capacità `firewall: bool` in
  `/api/system` (`system.rs`, come `openplc`).
- **Proxy dell'IDE**: `/api/remote/firewall*` in `remote.rs` con `inoltra_aggiornamento` (modello
  `remote_sicurezza_leggi/scrivi`): vale per LAN e tunnel. Un pannello vecchio dà già «versione senza questa funzione».

### C. L'installazione

- ~~Un servizio firewalld `sws`~~ **Cambiato durante il lavoro (26-11-2026)**: si aprono le **porte** 7443/tcp e
  7444/tcp, non un servizio nuovo. Un servizio creato nella configurazione permanente non esiste in runtime fino a un
  `firewall-cmd --reload`, e un reload toglie anche le regole in runtime degli altri (netavark, NetworkManager). Con le
  porte, runtime e permanente si scrivono subito, senza reload. Nella scheda le due porte hanno l'etichetta «SWS».
- `install-container.sh`, al passo 5 (dopo il quadlet), anche con `--solo-unita`: se `firewall-cmd --state` = running,
  apre 7443/tcp e 7444/tcp nelle zone con una scheda di rete (o nella predefinita), `--permanent` e runtime, senza
  `--reload`. Senza permesso: avviso con il comando da dare, l'installazione continua. Con `--uninstall`: le chiude.
  Con `--solo-unita` non le tocca: le apre il runtime, una volta.
- Installazioni native (`deploy/yocto/install.sh`, `deploy/tiny-ty/install.sh`, `deploy/generic-linux/install.sh`,
  girano come root): le stesse funzioni shell, ripetute in ognuno; `tests/shell/firewall.sh` (da `check_quadlet.sh`)
  verifica che siano uguali e le prova su un firewalld finto. Le regole polkit `50-sws-control-panel.rules` (tiny-ty, generic-linux) danno
  all'utente `sws` le azioni `org.fedoraproject.FirewallD1.{info,config,all}`.
- `deploy/container/sonda-dispositivo.sh`: `SONDA firewalld=running|inactive|absent` e `SONDA firewalld_permesso=yes|no`;
  `valuta_sonda` lo dice nella finestra d'installazione («firewalld attivo: l'installazione apre 7443 e 7444»).

### D. L'IDE — scheda «Firewall» in Configurazione → Istanza → Device

- Voce in `SCHEDE` di `sws-editor/src/config/schede.ts` (`sottoRamo: "device"`, `soloAdmin: true`), componente in
  `ConfigView.tsx`, file `sws-editor/src/config/schede/FirewallTab.tsx`. Visibile da collegati; con capacità `false`
  dice «firewalld non è attivo su questo pannello».
- Testata fissa con titolo, aiuto e azioni (regola UI 4; qui non c'è un Save: ogni modifica passa dalla barra).
- Una carta per zona attiva: interfacce, poi una tabella per servizi, porte e regole per sorgente. Ogni riga: nome,
  porte che apre (per un servizio, lette da `getServiceSettings2`), interruttore attiva/disattivata, «Modifica» (porte
  e regole). Sotto: «+ servizio» (da elenco), «+ porta» (con protocollo), «+ regola» (col modulo). In alto «Porte di
  SWS»: elenco con stato e «Apri» per quelle chiuse.
- Le modifiche si accumulano come **bozza** (righe segnate, contatore «3 modifiche»), poi «Applica»: conferma in
  finestra con l'elenco (rossa se chiude una porta di SWS o ssh), poi la barra dei 60 s con «Conferma» e «Annulla».
  Se la conferma non arriva (pannello non più raggiungibile), dopo 60 s la scheda ricarica lo stato.
- Funzioni in `sws-editor/src/api/client.ts` (`remoteFirewall`, `remoteFirewallApply/Confirm/Rollback`), testi in
  `it.json`/`en.json` sotto `firewall.*`.

### E. Il pannello di controllo web

- Sezione `"firewall"` in `sws-editor/src/control-panel/ControlPanel.tsx` (accesa da `caps.firewall`), funzioni in
  `control-panel/api.ts`. Riusa i componenti della scheda IDE (zona, servizi, porte, regole, barra) in un file comune
  `sws-editor/src/firewall/` con l'API passata come parametro. La barra riusa il modello di `network-confirm`.

### F. Il pannello di controllo LVGL

- Sezione Firewall in `sws-runtime/crates/sws-lvgl-viewer/src/control_panel.rs` / `lvgl_control_panel.rs`, sulle
  stesse rotte `/api/control-panel/firewall*`: elenco per zona di servizi, porte e regole con l'interruttore
  attiva/disattivata (anche quelle già presenti), modifica di porte e regole, aggiungi porta
  (tastiera numerica + tcp/udp), aggiungi servizio (elenco), aggiungi regola per sorgente (campo IP/CIDR + porta o
  servizio), barra dei 60 s. Stessa struttura della sezione Rete LVGL.

### G. Documenti e versione

- `CHANGELOG.md` `[Unreleased]`; `NOVITA.yaml` (it/en): porte aperte da sole con firewalld, pannello Firewall.
- `docs/manual/17_sicurezza.md` e `10_deployment.md`: il firewall dal pannello (oggi dicono «chiudi 7444 col
  firewall»); `docs/HOWTO.md` nuovo capitolo «Il pannello non risponde dalla LAN: il firewall».
- `docs/TEST_SETUPS.md`: il WP630 su Pixsys OS 2.2.0 con firewalld.
- CasaDomotica: niente da adeguare (la funzione è del pannello, non del progetto). Template: nessuno.

## Fuori da questo piano

La seconda cosa trovata al collaudo: `podman-auto-update.service` di sistema ha
`ExecStartPost=/usr/bin/podman image prune -f`, che cancella l'immagine precedente dopo un aggiornamento dal registro.
`immagini.json` resta con `precedente: null`, e «Torna alla …» non ha un'immagine. Va proposta al maintainer come
lavoro a parte, dopo questo.

## Ordine del lavoro e rami

1. Ramo `feat/firewall` da `main` (nessun ramo aperto).
2. A + B (Rust, con test) → C (installer, `tests/shell/` se c'è il modello) → D + E (IDE e pannello web, vitest) → F
   (LVGL) → G.
3. Definition of done; revisione (ultracode consigliato acceso per quella sola fase).
4. Collaudo con `/test-changes` sul WP630: prima con l'IDE locale 8460 dal ramo verso il pannello via cloud, poi sulla
   dev.
5. Col sì del maintainer: squash su `main`, `chore(dev)` 2.28.0-dev.1 (`docs/HOWTO.md` §19), `build_dev.sh`. Push e
   tag solo su istruzione esplicita.

## Verifica

- `cargo check`, `cargo test` (nuovi: composizione e validazione delle rich rule; Fake con applica/conferma/annulla e
  scadenza; rotte sotto `require_admin` e `require_session`, come `le_scritture_dell_aggiornamento_restano_admin…`;
  lettura delle porte in ascolto su un `/proc` finto), `pnpm build`, `pnpm exec vitest run` (scheda e sezione con API
  finte, «fuori da un pannello non si mostra», barra che scade), `./scripts/check_static.sh`, fmt/clippy.
- In locale: `start_runtime.sh` con `SWS_CONTROL_PANEL_FAKE=1`, la scheda e la sezione con il backend finto.
- Sul WP630 (target `user@wp630-a-p3-07a077.local`, da `/test-changes`):
  1. dopo l'aggiornamento alla dev, il log dice «the ports of SWS are now open in firewalld» e
     `firewall-cmd --list-ports` mostra `7443/tcp 7444/tcp`;
     da questo portatile `curl -k https://192.168.1.106:7443/health` = 200;
  2. IDE → Device → Firewall: apri 4840/tcp, poi «Conferma»: è in `firewall-cmd --permanent --list-ports`;
  3. togli `sws` senza confermare: la LAN si perde, dopo 60 s torna da sola;
  3b. disattiva `atvise`, `finder` e `cockpit` in una modifica sola, «Conferma»: spariscono da
      `firewall-cmd --permanent --list-services` e restano nella scheda come interruttori spenti; riattivane uno;
  3c. modifica una porta (4840/tcp → 4841/tcp) senza confermare: dopo 60 s torna 4840/tcp;
  4. regola per sorgente su 7444 dalla rete dell'ufficio, confermata, visibile in `--list-rich-rules`;
  5. le stesse operazioni dal pannello di controllo web e da quello LVGL;
  6. `install-container.sh --uninstall` chiude 7443 e 7444.

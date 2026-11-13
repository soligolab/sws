# Il QR del codice di abbinamento, e l'abbinamento senza progetto

**Piano, 13-11-2026** — dalla sessione di plan sui due semi (archiviati lo stesso giorno). Ramo `feat/qr-abbinamento`, annidato su `feat/tiny-ty-systemd`.

## Context

Oggi un pannello si abbina al cloud solo **dentro un progetto aperto** (Configurazione → Istanza → Device →
Connessione, `AbbinaPannelloCloud.tsx`), scrivendo a mano il codice di 16 caratteri mostrato sullo schermo.
Il maintainer vuole un **QR** accanto al codice: lo inquadra col telefono, si apre `sws.soligo.net`, fa il login
se serve, e **conferma l'abbinamento del pannello a un'azienda sua** (anche quella personale), senza progetto.
Il codice in chiaro resta sempre, come alternativa. Nasce dai semi
[il QR](../archive/2026-11-12-qr-del-codice-di-abbinamento.md) e [abbinare dall'account](../archive/2026-11-12-abbinare-un-pannello-dall-account.md),
che questo piano chiude entrambi.

Decisioni del maintainer (13-11-2026):
- il link apre `sws.soligo.net`; senza accesso chiede il login, con l'accesso chiede conferma;
- l'abbinamento va **all'azienda/utente**, non a un progetto; **ogni membro** dell'azienda può farlo;
- la stessa schermata si apre anche dal **menu utente** («Abbina un pannello…», codice scritto a mano);
- su LVGL `lv_qrcode`; RAM tenuta d'occhio (la pagina vive solo senza progetto);
- l'indirizzo del cloud sta in una **configurazione del runtime**, scritta dall'installatore;
- pagina LVGL: **testi e codice a sinistra, QR a destra**;
- (richiesta a parte) la **cornice** attorno alla pagina di abbinamento sul Tiny TY è «quasi uguale» allo
  sfondo e sembra un errore.

Ramo: `feat/qr-abbinamento`, **annidato su `feat/tiny-ty-systemd`** (tocca la stessa pagina del viewer e
l'installatore del Tiny TY). Codice nuovo in inglese (regola di `CLAUDE.md`); testi a schermo nei file di lingua.

## Fette

### 0. La cornice che stona (piccola, prima)
`main.rs:1646` e `:1850` dipingono la cornice con `#0f172a` in XRGB8888, mentre la pagina (sfondo `#0f172a`
in `abbinamento.rs:93,127`) passa da LVGL a 16 bit (RGB565): esce `#08142a`-circa. Due blu quasi uguali = un
bordo che sembra un difetto. Rimedio: la cornice si dipinge col colore **ridotto a RGB565 e riespanso** come
fa il flush (`sws_flush_cb`), così pagina e cornice coincidono al pixel finché `LV_COLOR_DEPTH` è 16 (con la
parte B del passo 2, a 32 bit, il problema sparisce da solo). Una funzione `rgb565_roundtrip(r,g,b)` vicino a
`riempi`, con un test. Vale per ogni pagina con sfondo `#0f172a`, non solo per l'abbinamento.

### 1. Il runtime: l'indirizzo del cloud e il link
- Nuovo argomento `--cloud-url` / env `SWS_CLOUD_URL` in `sws-runtime/src/main.rs` (accanto a `--tunnel`,
  L255). Vuoto = niente link, niente QR.
- `GET /api/abbinamento` (`sws-web/src/abbinamento.rs`, `stato()` L378) aggiunge `cloud_link`:
  `{cloud_url}/#pair={codice}` **solo se** c'è un codice in attesa **e** il tunnel d'attesa è acceso (senza
  tunnel il gateway non trova il pannello: un QR lì porterebbe a un errore). Il JSON è già letto con
  `#[serde(default)]` dai due viewer: i vecchi ignorano il campo.
- Container: `ENV SWS_CLOUD_URL=https://sws.soligo.net` accanto a `SWS_TUNNEL_URL` in
  `deploy/container/Containerfile.x86_64:117` e `.aarch64:149`; la riga commentata nel quadlet
  `deploy/container/sws-runtime.container` e la sostituzione in `install-container.sh` come per `SWS_TUNNEL_*`
  (self-host: l'installatore scrive l'indirizzo giusto).
- **Tiny TY**: oggi non ha tunnel. `deploy/tiny-ty/install.sh` scrive in `/etc/sws/runtime.env`
  `SWS_TUNNEL_URL=wss://tunnel.soligo.net/tunnel/v1` e `SWS_CLOUD_URL=https://sws.soligo.net` **se la chiave
  manca** (il file esistente non si riscrive, si completa: niente ritocchi a mano sul TY570), e `sws-runtime-launch.sh` li **esporta** (oggi `runtime.env` è letto ma solo `PYTHONPATH`
  passa al binario). RAM del tunnel in attesa da misurare col PSS.

### 2. Il viewer LVGL: il QR sulla pagina
- `lv_conf/lv_conf.h:665` `LV_USE_QRCODE 1`. Il sorgente è già nel vendored LVGL 8.3 e `build.rs` compila tutto
  senza allowlist: compaiono `lvgl_sys::lv_qrcode_create/update`, nessun cambio a `build.rs` né a
  `patches/lvgl/` (`lv_conf.h` non è nel vendor; verificare con `check_vendor_patches.sh`).
- `abbinamento.rs`: `StatoAbbinamento` legge `cloud_link`; `pagina()` ridisposta (testi e riquadro del codice a
  sinistra, ~460 px; a destra lo spazio del QR con la didascalia «Inquadra col telefono»). Senza `cloud_link`
  la pagina resta com'è oggi, centrata.
- Il QR non è un tipo di oggetto del sinottico (non deve entrare nei 39 tipi né nelle guardie dei template):
  dopo il render della pagina, un aggancio in `main.rs` (dove si apre la `Schermata::Codice`, ~L533-575) crea
  `lv_qrcode_create(lv_scr_act(), 200, scuro, chiaro)` + `lv_qrcode_update(link)` alla posizione riservata,
  col margine bianco attorno (lettura dal telefono), seguendo il pattern FFI di `canvas_icona`
  (`lvgl_render.rs:8998`). Costo atteso: 200×200×2 = 80 KB dal heap LVGL; **PSS misurato prima e dopo**.

### 3. La pagina del pannello nel browser (7443/7444)
- `sws-editor/src/components/AbbinamentoScreen.tsx`: se `cloud_link` c'è, il QR accanto al codice
  (`data-testid="codice-abbinamento"` resta). Libreria: `qrcode-generator` (MIT, senza dipendenze, ~20 KB),
  disegnata come SVG; nessuna libreria QR c'è oggi.
- `type Stato` (L163) e il test `tests/abbinamento.test.tsx` col campo nuovo.

### 4. Il gateway: abbinare da utente, a un'azienda
- `tunnel/gateway.rs` `abbina` (L549): il terzo caso oggi è 403. Diventa: **utente con sessione** + `azienda`
  nel corpo (il campo `Abbina.azienda` esiste già, L544) → ammesso se l'azienda è fra le sue
  (`projects::appartenenze_di(s, chi).cartelle`, `projects.rs:732`, ruolo qualunque). Senza `azienda` e con
  una sola azienda: quella. Resto invariato (prepara, rivendica attraverso il tunnel, `salva`, audit con l'utente).
- Nuovo `GET /api/pannelli/in-attesa/{codice}` (stessa protezione `auth_utente_o_figlio`): `{nome_proposto}` dal
  registro `pannelli_in_attesa` (`abbinati.rs:350`), 404 se il codice non c'è. Serve a far vedere **quale**
  pannello si sta abbinando prima di confermare.
- `GET /api/identita/mie-aziende` (`router.rs:2316`) aggiunge `cartella` a ogni voce (oggi solo id/nome/ruolo).

### 5. L'IDE nel cloud: la schermata «Abbina un pannello»
- Componente nuovo `sws-editor/src/components/PairPanel.tsx` (modale), riusando la logica di
  `AbbinaPannelloCloud.tsx` (codice, nome, il secondo giro con utente/password quando il pannello ha già
  utenti) ma chiamando il gateway direttamente: codice (prefilled o da scrivere), nome del pannello in attesa
  (dal GET nuovo, modificabile), azienda (scelta solo se più d'una, pattern di
  `benvenuto/NuovoProgetto.tsx:247-319`), «Abbina». Esito: «abbinato a <azienda> come <nome>; per mandarci un
  progetto aprilo e usa Connetti con `…/dev/<nome>`».
- **Il link**: `App.tsx` legge `#pair=<codice>` all'avvio e lo tiene in `sessionStorage` (sopravvive al
  `LoginScreen` e al cambio password); a sessione pronta apre `PairPanel` col codice, sopra la `WelcomeScreen`
  o il progetto, e pulisce l'hash. Si appoggia all'effetto degli hash esistente (`App.tsx:492-522`).
- **Il menu utente**: voce «Abbina un pannello…» in `components/BarraIdentita.tsx` (solo nel cloud,
  `identitaStato().gateway`), apre la stessa modale vuota.
- La scheda dentro il progetto (`AbbinaPannelloCloud`) resta com'è.
- i18n it/en: testi nuovi; `installCloudDopo` (`it.json:577`) non dice più «apri un progetto».

### 6. Documenti
- Piano in `docs/plans/2026-11-13-qr-di-abbinamento.md` (copia di questo), semi spostati in `docs/archive/`
  con le righe nei due README; `NOVITA.yaml` (it+en) e `CHANGELOG.md`; HOWTO del primo abbinamento se lo cita.
- CasaDomotica: il TC620 di casa è già abbinato; la funzione si vede solo a un pannello nuovo o resettato —
  annotarlo (regola di `CLAUDE.md`).

## Stato (13-11-2026)

Fette 0-6 fatte sul ramo, mergiate in `main` con la catena del 13-11 e uscite nella rc.17. Sul TY570: QR a destra,
cornice uguale allo sfondo, PSS del viewer invariato (14,6 → 14,4 MB), runtime +2,1 MB per il tunnel d'attesa; il
telefono legge `https://sws.soligo.net/#pair=RSSW-J0JZ-P064-H7GK`. Da collaudare sulla rc.17: il giro completo dal
telefono (login, conferma, pannello in `…/dev/<nome>`), il menu utente, un utente con due aziende.

## Verifica
- `cargo check`, `cargo test` (test nuovi: `cloud_link` presente/assente, `rgb565_roundtrip`, gateway: membro
  ammesso, non membro 403, azienda unica implicita), `pnpm build`, `pnpm exec vitest run` (AbbinamentoScreen col
  QR, PairPanel con hash e dopo login), `./scripts/check_static.sh`.
- Sul TY570 (pacchetto ricostruito, `runtime.env` con tunnel e cloud): pagina con QR a destra, cornice uguale
  allo sfondo; PSS del viewer prima/dopo; dal telefono: QR → login → conferma → pannello abbinato e visibile
  come `…/dev/ty570-1ad-p1-06e990`; poi Connetti da un progetto e deploy.
- Codice a mano dal menu utente, senza progetto; e dalla scheda del progetto (invariata).
- Gateway del VPS: serve un'immagine con la fetta 4 — rc nuova solo su istruzione del maintainer.

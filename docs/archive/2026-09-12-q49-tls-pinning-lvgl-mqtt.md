# Q49 — Estendere il pinning TLS al viewer LVGL e al plugin MQTT

> **Realizzato e mergiato in `main` il 13-09-2026** (`chore/q49-tls-pinning`, `1b52423`) —
> l'ostacolo rumqttc/rustls segnalato sotto risolto aggiornando rumqttc a 0.25.1
> (`use-rustls-no-provider`), che ha permesso di condividere un solo modulo di pinning
> (`sws_core::pin_tls`) invece di duplicare il verificatore. Collaudato dal vivo per il viewer
> LVGL, per lettura di codice per MQTT. Scheda chiusa in
> `docs/history/OPEN_QUESTIONS-chiuse.md`.

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q49) il 2026-09-12, aperta il 2026-09-09, decisa
> (opzione 1, pinning alla prima connessione) e **parzialmente realizzata** lo stesso giorno.
> Questo piano copre solo il residuo, dichiarato esplicitamente nella scheda come "restano da
> fare". Rileggere la scheda originale per il disegno completo del meccanismo già costruito
> prima di estenderlo.

## Contesto

**Già fatto** (editor ↔ dispositivo): `sws-web/src/certificati.rs` — al primo «Connetti» si
memorizza l'impronta SHA-256 del certificato in `<config>/dispositivi_conosciuti.yaml`; se
cambia, l'azione `certificato-cambiato` blocca con «Dimentica il vecchio certificato e riprova».
Il relay WebSocket usa la stessa impronta e chiude con 4495.

**Restano da fare, con lo stesso modulo** (non un disegno nuovo — riusare quello esistente):

1. **Il viewer LVGL** (`sws-lvgl-viewer/src/viewer/tls.rs` o percorso equivalente — verificare
   il nome file attuale, potrebbe essere cambiato) — oggi accetta qualunque certificato. Parla
   con `127.0.0.1` (il runtime sulla stessa macchina/container), quindi il rischio è diverso da
   un dispositivo remoto: verificare con il maintainer se vale comunque la pena pinnare un
   certificato locale, o se lì il modello di minaccia è già coperto dal fatto che è loopback.
2. **Il plugin MQTT** (`insecure_skip_verify`) — oggi è un'opzione booleana per sorgente. Da
   ripensare come «impronta del broker», sullo stesso modello TOFU: alla prima connessione a
   quel broker si memorizza l'impronta, non solo "salta la verifica sì/no".

## Prima di scrivere codice

- Rileggere `certificati.rs` per capire la forma esatta del meccanismo esistente (dove si
  salva l'impronta, come si confronta, come si espone l'azione «dimentica») — riusarla, non
  reinventarla.
- Confermare col maintainer se il viewer LVGL locale (loopback) merita davvero lo stesso
  trattamento, dato che il rischio non è lo stesso di un dispositivo remoto in LAN.
- Per MQTT: capire dove vive oggi `insecure_skip_verify` per sorgente (`sws-plugin-mqtt`) e se
  un'impronta per broker si inserisce naturalmente nello stesso punto di configurazione.

## File coinvolti (di massima)

`sws-runtime/crates/sws-web/src/certificati.rs` (il modulo da riusare),
`sws-runtime/crates/sws-lvgl-viewer/src/*` (tls del viewer, nome file da confermare),
`sws-runtime/crates/sws-plugin-mqtt/src/*` (dove sta `insecure_skip_verify`).

## Verifica

Per ciascuna delle due estensioni: cambio di certificato/impronta rilevato e bloccato, stesso
pattern «dimentica e riprova» già collaudato per editor↔dispositivo. Conferma del maintainer
prima di archiviare, come per il resto di Q49.

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q49 — TLS senza verifica del certificato, in quattro posti

*Aperta il 2026-09-09 dalla revisione pre-2.7.0. Nessuna decisione presa.*

**Context.** L'editor parla con il runtime remoto con `danger_accept_invalid_certs(true)`
(`remote.rs`); il relay WebSocket e il viewer LVGL hanno un verificatore che accetta
qualunque certificato (`remote_relay.rs`, `viewer/tls.rs`, copiato in due crate); il plugin
MQTT ha `insecure_skip_verify` con un WARN esplicito. È una scelta PoC documentata: i
dispositivi hanno certificati self-signed su LAN fidata. Ma è esattamente il caso in cui la
cifratura c'è e l'identità no — la stessa classe di problema che il maintainer ha appena
chiuso su SSH scegliendo `accept-new` invece di `no`.

**Options.**
1. **Pinning alla prima connessione** (TOFU): al primo «Connetti» si memorizza l'impronta del
   certificato del dispositivo; se cambia, si rifiuta e si offre il pulsante «dimentica»,
   come per la chiave host SSH. Stesso modello mentale, stesso pulsante.
2. Distribuire un certificato per dispositivo firmato da una CA del progetto, e verificare
   quella.
3. Lasciare com'è, dichiarando «LAN fidata» nel modello di minaccia. Con Q44 (servizio
   ospitato) non regge più.

**Default for PoC.** Com'è (3). Raccomandazione: (1), riusando ciò che esiste per SSH.

**Decided:** 2026-09-09 dal maintainer — opzione 1, pinning alla prima connessione.
Realizzato lo stesso giorno per **editor ↔ dispositivo** (`sws-web/src/certificati.rs`):
al primo «Connetti» si memorizza l'impronta SHA-256 del certificato in
`<config>/dispositivi_conosciuti.yaml`; se cambia, «Connetti» si ferma con l'azione
`certificato-cambiato` e il pulsante «Dimentica il vecchio certificato e riprova»
(`POST /api/device/cert/forget`, Admin, audit); il relay WebSocket usa la stessa impronta e
chiude con 4495, definitivo. Il verificatore controlla la **firma** del certificato con
gli algoritmi del provider; solo la catena non si verifica (self-signed).
**Restano da fare**, con lo stesso modulo: il viewer LVGL (`viewer/tls.rs`, che parla con
`127.0.0.1` e ha un rischio diverso) e il plugin MQTT (`insecure_skip_verify` è un'opzione
per sorgente, va ripensata come «impronta del broker»). Da verificare dal maintainer prima di
archiviare.

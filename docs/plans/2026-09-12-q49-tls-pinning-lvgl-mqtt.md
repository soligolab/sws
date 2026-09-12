# Q49 — Estendere il pinning TLS al viewer LVGL e al plugin MQTT

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

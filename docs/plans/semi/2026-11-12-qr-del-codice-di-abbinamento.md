# Il QR del codice di abbinamento

**Seme, nato il 12-11-2026** guardando la pagina di abbinamento sul Tiny TY. Richiesta del maintainer: «il
codice di abbinamento è possibile mostrarlo anche come QR (su tutti i dispositivi e viewer) così da poterlo
leggere con un lettore QR?». Rimandato da lui a dopo il lavoro sul Tiny TY.

**Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata per sviscerarne i dettagli.**

## Già deciso

- **Il QR porta un link al cloud col codice dentro**, non il solo codice: il telefono apre l'IDE di
  `sws.soligo.net` su «Abbina un pannello» con il codice già scritto. Sotto resta il codice in chiaro, per
  l'IDE locale («Connetti»), che dal telefono non si raggiunge.
- **Ovunque si mostra il codice**: la pagina di abbinamento del viewer LVGL e la pagina del pannello nel
  browser (porte 7443/7444).

## Com'è oggi (12-11-2026)

- LVGL: la pagina è costruita dal viewer, `sws-lvgl-viewer/src/abbinamento.rs` (`pagina`), 800×480, testi e
  un `rect` attorno al codice.
- Il codice lo dà il runtime, `sws-web/src/abbinamento.rs` (lo stato con `in_attesa` e `codice`).
- L'IDE nel cloud non legge oggi un codice da un link: va aggiunto.

## Da decidere nella sessione di plan

- La forma del link (`#abbina=…` o un parametro) e cosa succede se chi lo apre non ha fatto l'accesso.
- Su LVGL: `lv_qrcode` di LVGL (da accendere in `lv_conf`) o un QR generato in Rust e disegnato come
  immagine. **La RAM in più va misurata sul Tiny TY** (piano `2026-10-30-sws-lvgl-sul-tiny-ty.md`, controllo
  maniacale della RAM): atteso pochi KB.
- Dove porta il link: oggi l'abbinamento sta dentro un progetto aperto; il seme [abbinare dall'account](2026-11-12-abbinare-un-pannello-dall-account.md) gli darebbe una destinazione senza progetto.
- Un cloud diverso da `sws.soligo.net` (self-host): da dove il pannello prende l'indirizzo da mettere nel link.

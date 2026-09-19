# SWS — Open Architectural Questions

> **File congelato dal 2026-09-18.** Le domande architetturali non nascono più qui: una domanda
> nuova è un **seme di piano** in [`docs/plans/`](plans/README.md) (CLAUDE.md, «Plans»). Questo
> file tiene i numeri già assegnati, perché `STATUS.md`, il codice e i piani li citano e
> `check_documenti.sh` verifica che nessuno sparisca. Ogni scheda rimasta è **un titolo, un
> rimando e lo stato in una riga**; il testo integrale vive nel piano che la porta.
>
> Le schede decise, realizzate e **verificate sul codice** stanno in
> [`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md), indicizzate in
> coda. I numeri non si riusano mai.

---

## Q13 — Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

Contenuto spostato in [`docs/archive/2026-09-18-immagine-di-boot.md`](archive/2026-09-18-immagine-di-boot.md) il 18-09-2026 — più l'idea nuova del maintainer: disegnare lo splash nell'IDE e installarlo al deploy via D-Bus.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q16 — Widget `image` su LVGL: nessun decoder raster compilato, e il catalogo bundle è SVG

Contenuto spostato in [`docs/plans/2026-09-12-q16-decoder-raster-image.md`](plans/2026-09-12-q16-decoder-raster-image.md) il 2026-09-12. **Decided:** parzialmente decisa (metà SVG fatta, metà raster no).

---

## Q23 — Collegare lo SCADA a un robot ROS 2

Contenuto spostato in [`docs/plans/2026-09-18-ros2-robot-come-sorgente.md`](plans/2026-09-18-ros2-robot-come-sorgente.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q26 — Un server MCP per far editare il progetto all'IA

Contenuto spostato in [`docs/plans/2026-09-18-mcp-editing-con-ia.md`](plans/2026-09-18-mcp-editing-con-ia.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q43 — Traduzione automatica dei contenuti di progetto (Google Translate)

Contenuto nel seme [`docs/archive/2026-09-18-multilingua-residuo.md`](archive/2026-09-18-multilingua-residuo.md), diventato il piano [`docs/archive/2026-09-18-multilingua-chiusura.md`](archive/2026-09-18-multilingua-chiusura.md) il 18-09-2026.
**Decided:** fornitore MyMemory con marchio visibile (D3), voci con segnaposto come proposte da approvare (D4) — decisioni del maintainer del 18-09; il timbro quando il piano è chiuso.

---

## Q44 — Ospitare l'editor come servizio, con aziende, utenti e quote

Contenuto spostato in [`docs/plans/2026-09-18-identita-utenti-istanze.md`](plans/2026-09-18-identita-utenti-istanze.md) il 18-09-2026 — insieme a Q54 e Q56, che sono la stessa domanda vista da tre punti.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q53 — Due immagini aarch64 (SDK Pixsys e generica): tenerle entrambe, o convergere su una?

Contenuto spostato in [`docs/archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md`](archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md) il 2026-09-12, archiviato il 2026-09-14. **Decided:** decisa e realizzata il 2026-09-10; fase due chiusa il 2026-09-14 — misura sul WP630 confermata e percorsi SDK/QEMU rimossi, alias `-arm64-generic` mantenuti.

---

## Q54 — Un dispositivo che crea utenti propri: cosa succede al deploy successivo?

Contenuto spostato in [`docs/plans/2026-09-18-identita-utenti-istanze.md`](plans/2026-09-18-identita-utenti-istanze.md) il 18-09-2026 — insieme a Q44 e Q56, che sono la stessa domanda vista da tre punti.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q55 — `reqwest` via `rt_handle.spawn()` si blocca per sempre nel viewer LVGL, solo per una POST che riceve 200

Contenuto spostato in [`docs/plans/2026-09-18-post-bloccata-viewer-lvgl.md`](plans/2026-09-18-post-bloccata-viewer-lvgl.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q56 — Un IDE non si autentica più: `users.yaml` governa il dispositivo, non l'editor

Contenuto spostato in [`docs/plans/2026-09-18-identita-utenti-istanze.md`](plans/2026-09-18-identita-utenti-istanze.md) il 18-09-2026 — insieme a Q44 e Q54, che sono la stessa domanda vista da tre punti.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q57 — Una notifica non ha uno schermo: in che lingua parla, e a chi?

Contenuto nel seme [`docs/archive/2026-09-18-multilingua-residuo.md`](archive/2026-09-18-multilingua-residuo.md), diventato il piano [`docs/archive/2026-09-18-multilingua-chiusura.md`](archive/2026-09-18-multilingua-chiusura.md) il 18-09-2026.
**Decided:** lingua **per canale** (email, Telegram) con ripiego sulla predefinita di progetto (D5) — decisione del maintainer del 18-09; il timbro quando il piano è chiuso.

---

## Q60 — La gestione dei workspace

Contenuto spostato in [`docs/plans/2026-09-18-workspace-dei-progetti.md`](plans/2026-09-18-workspace-dei-progetti.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Aprire una domanda nuova

Non qui. Si scrive un seme in `docs/plans/<data>-<slug>.md` — l'idea, le misure di adesso, e la
frase che quando quel lavoro comincerà servirà una sessione di plan approfondita — e una riga
nella seconda tabella di `docs/plans/README.md`. Regola del maintainer del 2026-09-18, in
`CLAUDE.md`.

## Archivio — decise, realizzate e verificate

Le schede qui sotto sono state **spostate intere** in
[`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md) il 2026-09-06, dopo
una verifica sul codice di ciò che ognuna dichiara. I numeri **non si riusano**: una scheda nuova
prende il numero successivo all'ultimo mai assegnato, archivio compreso.

| # | Questione | Decisa |
|---|---|---|
| Q1 | Python embedding strategy | bootstrap |
| Q2 | Sparkplug B implementation | T-08 |
| Q3 | Plugin ABI strategy | bootstrap |
| Q4 | Frontend state management | 2026-05 (ADR 0001) |
| Q5 | i18n scaffolding | bootstrap |
| Q6 | Symbol library packaging | 2026-08-11 |
| Q7 | LICENSE file content | 2026-05-12 |
| Q8 | Isolamento runtime ↔ IDE | 2026-07-26 e 2026-09-02 |
| Q9 | Le `PUT /api/project/*` accettano e scartano in silenzio i campi sconosciuti | 2026-08-21 |
| Q10 | Una sorgente non parsabile viene scartata in silenzio, e il salvataggio successivo la cancella | 2026-08-21 |
| Q11 | Estendere `BrandColors` con `secondary`/`accent`, o tenerli solo nell'artwork? | 2026-08-21 |
| Q12 | I neutri di `theme.ts` restano condivisi fra tutti i brand, o diventano override per-brand? | 2026-08-21 |
| Q14 | Binding Rust↔LVGL e sequenza dei backend di output | 2026-08 (15 seguiti) |
| Q15 | Simboli SVG (`symbol`) su LVGL: nessun renderer SVG disponibile | 2026-08-11 |
| Q17 | `apply_recipe` scrive i tag senza contesto utente | 2026-09-06 |
| Q18 | Colori del testo dai token di tema su pagine con sfondo scelto a mano | 2026-08-25 |
| Q19 | Il backend DRM del viewer LVGL apre i device a mano, mentre PixsysOS li distribuisce con `seatd` | 2026-08-25 |
| Q20 | Il viewer LVGL non si accorge che il progetto è cambiato | 2026-08-25 |
| Q21 | Due superfici Python nel progetto, in due punti lontani dell'interfaccia | 2026-08-25 |
| Q22 | La `sparkline` fa crashare il viewer LVGL quando la pagina ha altri widget | 2026-08-25 |
| Q24 | Il font del viewer LVGL non ha le lettere accentate | 2026-08-27 |
| Q25 | Installare web e LVGL insieme, e far scegliere al sistema quale mostrare | 2026-08-27 |
| Q27 | Il server non fa rispettare il `data_type` dei tag in scrittura | 2026-09-06 |
| Q30 | `patch_project` è un leggi-modifica-scrivi senza lock | 2026-09-03/04 |
| Q32 | Dove deve vivere il progetto che si sta modificando? | 2026-09-12 |
| Q33 | `POST /api/system/stop` viene annullato in silenzio dal salvataggio delle Sorgenti | 2026-09-04 |
| Q34 | Il cron degli script globali non capisce `*/5`, e non parte in silenzio | 2026-09-03/04 |
| Q35 | «fuori pagina» implicito nelle coordinate o campo esplicito? | 2026-09-06 |
| Q37 | Cosa c'è attorno alla pagina sul pannello, e se il foglio non ci sta | 2026-09-06 |
| Q38 | `size_mode: ratio` senza dimensioni esplicite: il bordo non arriva al canvas | 2026-09-06 |
| Q39 | Il validatore deve aprire la famiglia dei rilievi geometrici? | 2026-09-12 |
| Q41 | La chat IA deve mostrare consumo di token e credito residuo? | 2026-09-06 |
| Q42 | Gli script Python scrivono i tag senza lo scaling inverso | 2026-09-06 |
| Q47 | `/api/script/exec` esegue codice arbitrario e nessuno lo chiama più | 2026-09-09 |
| Q48 | `/api/deploy/remote` scarica un binario che non esiste, e duplica il deploy | 2026-09-09 |
| Q50 | I dispositivi registrati: dal browser al server, e popolati dal discovery mDNS | 2026-09-10 |
| Q51 | «Pacchetto runtime» e il deploy binario sono strumenti di sviluppo: nascosti quando il repo non c'è | 2026-09-09 |
| Q52 | «Installa su dispositivo»: container per primo, campi dal dispositivo connesso, e un discovery che trova **qualunque** macchina in rete | 2026-09-09 |
| Q58 | Un template porta gli indirizzi e le credenziali dell'impianto in cui è nato | 2026-09-17 |
| Q59 | La cartella dei progetti: il default c'è, ma chi lavora nel repo non lo vede mai | 2026-09-18 |

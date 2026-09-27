# Immagine di boot dal container: collaudo, tre difetti, e il ripristino di fabbrica

> Piano d'esecuzione, 27-09-2026. Riunisce e sostituisce due semi del 19-09:
> [collaudo nel container](2026-09-19-boot-image-collaudo-container.md) (verifica) e
> [ripristino di fabbrica](2026-09-19-boot-image-ripristino-di-fabbrica.md) (decisione). Scelti dal
> maintainer fra i piani leggeri da chiudere prima del lavoro su utenti e aziende. Ramo
> `feat/boot-image-dbus`, da `main`.

## Com'è oggi, misurato

Dal 24-09 la chiamata al launcher la fa il runtime, via D-Bus, da dentro il container
(`launcher_dbus.rs`; il quadlet monta `/run/dbus/system_bus_socket`, `UserNS=keep-id`,
`SWS_HOST_CONFIG_DIR`). Il meccanismo a file sull'host (`sws-boot-image.{path,service}` e lo script) è già
stato tolto quel giorno; resta nel runtime la scrittura del file `trigger`.

**Sul TC620, con la 2.12.0-dev.3 (sola lettura, 27-09):** CasaDomotica ha una pagina di boot abilitata;
`boot-image/boot.png` e `trigger` sono del 20-09; **`status` non esiste**; il launcher risponde
`GetBackgroundImage → "Default"`. L'immagine non è mai stata applicata: allora la doveva applicare
l'host, e le unit non c'erano.

## Tre difetti trovati leggendo il codice

1. **Il launcher si chiama solo se il `trigger` cambia** (`publish`, `scrivi_se_diverso`). Un
   dispositivo con un trigger già scritto e mai applicato — il TC620 — non recupera finché il PNG non
   cambia.
2. **Parole diverse fra chi scrive e chi legge `status`**: il runtime scrive `esito=applicata`,
   l'editor (`StatoBootImage.tsx`) riconosce `installato` e mostrerebbe la parola grezza.
3. **Chiavi diverse**: il runtime scrive `nota=`, `parse_stato` legge `messaggio`, `quando`,
   `percorso`. Un errore del launcher arriverebbe all'editor senza testo.

## Decisioni del maintainer (27-09)

- **Via il `trigger`**: una strada sola, il D-Bus («toglierlo in questo lavoro»).
- **Pulsante «Ripristina l'immagine di fabbrica»** nella scheda Runtime, sulla riga «Immagine di
  boot» del dispositivo collegato.
- **Conferma e solo Admin**.

## Cosa si fa

1. `boot_image.rs`
   - `publish`: scrive `boot.png` se diverso, e chiama il launcher **quando il PNG è cambiato oppure
     `status` non dice già `installato` con quello SHA**. Nessuna pagina abilitata: non tocca
     l'immagine (invariato), `status` dice `nessuna_immagine`.
   - `status` con le chiavi che il lettore conosce: `esito` (`installato`, `non_supportato`,
     `nessuna_immagine`, `fabbrica`, `errore`), `sha256`, `quando`, `percorso`, `messaggio`.
   - Niente più `trigger`: la «richiesta» per la scheda è lo SHA del `boot.png` pubblicato.
2. `launcher_dbus.rs`: `ripristina()` → `ResetBackgroundImage`, verificato con
   `GetBackgroundImage == "Default"`.
3. Rotta sul dispositivo `POST /api/boot-image/reset` (Admin), **anche in `deploy_only_app`** — il test
   `ogni_chiamata_dell_ide_ha_la_sua_rotta_sul_dispositivo` lo pretende; proxy nell'IDE
   `POST /api/remote/boot-image/reset`.
4. Editor: pulsante con conferma in `StatoBootImage`; stato `fabbrica`; i18n it/en.
   **Scostamento**: l'IDE non conosce il ruolo con cui è collegato al dispositivo, quindi il pulsante
   compare sempre a connessione avvenuta; «solo Admin» lo fa rispettare il dispositivo (la rotta è
   Admin su tutte e due le porte) e un rifiuto arriva con un messaggio chiaro.
5. Documenti: `HOWTO` §17 (il ripristino si fa dall'IDE), i due semi in archivio.

## Verifica

- `cargo test -p sws-web`, `pnpm build`, `pnpm vitest run`, `./scripts/check_static.sh`.
- Sul TC620 (autorizzato dal maintainer, «4+6 sul TC620»), con una dev nuova: un deploy di
  CasaDomotica applica l'immagine — `status` `installato`, `GetBackgroundImage` ≠ `Default` — senza
  cambiare il PNG; poi «Ripristina» → `Default`, `status` `fabbrica`. **L'effetto a schermo si vede solo
  al riavvio**: quello lo guarda il maintainer.

## Collaudo del maintainer (27-09, sera) e un quarto difetto

- Ripristino dall'IDE, riavvio: a schermo l'immagine di fabbrica. ✔
- **Ma il ripristino non resisteva al riavvio successivo**: ripartendo, il runtime riapriva il progetto,
  vedeva `fabbrica` (≠ `installato`) e riapplicava l'immagine (log del TC620, 17:03:40 UTC). Corretto con
  `Occasione::{Avvio, Modifica}`: all'avvio un ripristino di fabbrica si rispetta finché il PNG è lo stesso;
  un deploy o una modifica del progetto lo riapplicano. Il PNG pubblicato non si cancella più al ripristino
  (risulterebbe «cambiato» all'avvio). Test provato rosso.
- Dopo lo stesso riavvio il browser apriva Cockpit (9443): **non è SWS**, è CODESYS con
  `allow_url_override = true` (vedi `docs/TEST_SETUPS.md`). Lo corregge il maintainer nella configurazione di CODESYS.

**Confermato dal maintainer il 27-09-2026** («ok, funziona tutto»): ripristino che resiste al riavvio, «Invia ora» che riapplica, browser su SWS dopo `allow_url_override = false` in CODESYS.

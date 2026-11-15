# Pannello di controllo — le correzioni del primo collaudo sul TY570

> **Stato: piano — in corso.** Ramo `fix/control-panel-ty` da `main` (dopo la rc.18). Anomalie che rovinano l'uso
> (regola del 09-11-2026): si correggono subito. Piano di riferimento:
> [`2026-11-13-pannello-di-controllo.md`](2026-11-13-pannello-di-controllo.md).

## Cosa ha visto il maintainer (14-11-2026, TY570 con la rc.17)

1. **Il fuso orario è inutilizzabile**: un elenco lunghissimo, con una barra a lato che non si trascina. Proposta del
   maintainer: «aggiungere un campo di filtro e organizzare le regioni in un menù a tendina, prima il continente, poi
   il paese e poi la città».
2. **Il Wi-Fi non si apre**: la chiavetta c'è, `wlan0` «non configurata», la voce del menu resta spenta.
3. **Il tastierino del PIN perde spesso i tocchi.**

## Le misure (14-11-2026, TY570 con la rc.18 installata)

- **Wi-Fi**: la rc.17 non aveva la sezione (è la fase 4). Con la rc.18 `capabilities.wifi = true`, la scansione trova
  le reti, `wlan0` è `disconnected` (pronta). La chiavetta è una Realtek RTL8188EUS (`0bda:8179`, driver `r8188eu`):
  `WIFI-PROPERTIES.AP: no`, quindi niente hotspot con questa chiavetta, e il pannello lo dice già (`can_hotspot:
  false`). **Nessuna correzione di codice**: si riprova sul vetro con la rc.18.
- **Fuso**: il fuso del TY era diventato `America/Swift_Current`, un tocco a vuoto nella tendina. La causa: il
  pannello sta sul layer di sistema di LVGL, la lista della tendina (`lv_dropdown`) si apre su `lv_layer_top`, che
  sta **sotto**: si vede, ma il dito tocca il pannello. Sul TY `/usr/share/zoneinfo/zone.tab` e `iso3166.tab` ci sono.
- **Tasti persi**: ogni tasto reagisce a `LV_EVENT_CLICKED` (al rilascio) e cambia lo stato; il frame dopo il pannello
  si ricostruisce da capo. Scrivendo veloce, il tasto successivo viene ricostruito sotto il dito fra pressione e
  rilascio, e il clic si perde.

Dopo, provando il Wi-Fi con la rc.18 (stesso giorno): «sembra lo scolleghi dopo la conferma che funziona,
bisogna gestire la priorità delle interfacce di rete?», e «quando il WiFi è connesso visualizza nel pannello di
configurazione le impostazioni anche di quella rete». Il journal di NetworkManager dice che il Wi-Fi **non si è mai
collegato**: `4way_handshake -> disconnected`, poi `no-secrets` e `failed` in 5 s, prima della conferma; anche con la
PMF spenta. È la password salvata (10 caratteri) a essere rifiutata, con ogni probabilità scritta con la tastiera
che perdeva i tasti. Il pannello però chiedeva di confermare comunque, e alla scadenza dei 60 s la rete di sicurezza
toglieva il profilo. La priorità fra le schede non serve: NetworkManager dà già metrica 100 al cavo e 600 al Wi-Fi,
quindi il cavo resta la strada predefinita quando ci sono tutti e due.

## Le correzioni

1. **Tasti alla pressione**: nei tastierini (PIN, indirizzi, data e ora, tastiera del Wi-Fi, filtro dei fusi) i tasti
   reagiscono a `LV_EVENT_PRESSED`. Gli elenchi che scorrono (reti, fusi) restano al clic, che non scatta se il dito
   ha trascinato.
2. **Fuso: filtro e tre passi, su LVGL e sul web.**
   - `GET /api/control-panel/timezones` dà `[{zone, country}]`: il paese (codice ISO) da `zone.tab`; senza tabella,
     `country: null`.
   - I nomi dei paesi in italiano e in inglese in `sws-editor/src/i18n/countries.json`, generato una volta con
     `Intl.DisplayNames` (web e LVGL lo leggono uguale; il viewer in compilazione).
   - Il selettore: continente (dal prefisso del fuso), poi paese, poi città; un paese con un fuso solo sceglie
     subito. Il campo filtro cerca in città, paese e nome del fuso e dà un elenco piatto.
   - LVGL: elenchi dentro il pannello (niente `lv_dropdown`), con la tastiera di lettere per il filtro.

3. **Wi-Fi: l'esito prima della conferma.** Dopo `ActivateConnection` il runtime guarda lo stato della scheda fino a
   12 s (il viewer aspetta al massimo 15): attivata o ancora in corso → la conferma di sempre; fallita → la rete di
   sicurezza annulla subito e l'errore dice `wifi-wrong-password` (motivo 7 o 8 di NetworkManager) o `wifi-failed`,
   che web e viewer traducono.
4. **Gli indirizzi della rete Wi-Fi collegata** anche nella sezione Wi-Fi (indirizzo, DHCP o statico, gateway e DNS),
   come li mostra la sezione Rete, dove si cambiano.

## Verifica

`cargo test` (modello del selettore, parsing di `zone.tab`), vitest (selettore web), le guardie, istantanee LVGL del
selettore, poi la prova sul TY570: PIN scritto veloce, fuso scelto per passi e col filtro, Wi-Fi con Casa01.

## Stato

- **14-11-2026**: piano scritto, lavoro avviato.

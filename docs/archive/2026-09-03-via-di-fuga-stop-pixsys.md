# La via di fuga STOP dei pannelli Pixsys — vincoli riusabili

*Scritto il 2026-09-03 per portare le stesse regole in un secondo progetto (non SWS)
che gira sugli stessi pannelli. Qui c'è il nucleo trasferibile; i dettagli misurati
stanno in `docs/TEST_SETUPS.md` §«La via di fuga del launcher — non romperla» e in
`docs/OPEN_QUESTIONS.md` Q25.*

## Il fatto

`pixsys-launcher` gira a `sysinit.target`, **prima di Weston**, disegna su DRM/KMS e
legge il touch. Allo scadere di un timer unico da 10 s guarda dove sta il dito:

| dito allo scadere dei 10 s | cosa parte |
|---|---|
| dentro l'icona **STOP** (225×225 px, in alto a **destra**) | `chromium@wp-control.service` → Cockpit su `127.0.0.1:9443` = **modalità configurazione** |
| premuto altrove | `touch-calibration-from-launcher.service` |
| non premuto | `desktop.target` → Weston + `chromium@main-app.service` = **modalità normale** |

Un tocco rilasciato prima dei 10 s non conta. La modalità configurazione è l'unico modo
di rimettere a posto un pannello con la rete sbagliata: chi prende lo schermo lì rende
il dispositivo **non configurabile**. In SWS è già successo (2.3.0): Cockpit compariva e
un istante dopo ci finiva sopra la finestra LVGL.

## La regola (decisa col maintainer, 2026-08-28)

In modalità configurazione l'applicazione **non prende lo schermo, ma continua a
girare**. La configurazione riguarda il *dispositivo*, non l'*applicazione*: impianto,
storico e allarmi non si fermano perché qualcuno sta sistemando la rete.

## Il discriminante

In configurazione il launcher avvia *solo* `chromium@wp-control.service` e **non
raggiunge mai** `desktop.target`. Due letture, senza sudo:

```bash
systemctl is-active desktop.target                 # active = normale
systemctl is-active chromium@wp-control.service     # active = configurazione
```

## I vincoli da rispettare in qualunque progetto

1. Non prendere lo schermo prima di aver verificato la modalità.
2. Aspettare un **esito**, non un tempo: loop da 1 s (max 60 s), vince il primo che
   diventa `active`. Una lettura sola al boot scambia un avvio lento per una modalità
   configurazione, perché la sessione utente può partire prima di `desktop.target`.
3. **Nel dubbio non si tocca lo schermo**: timeout, file di stato assente o valore
   ignoto → si logga e si lascia com'è. Prendere lo schermo "per default" *è* il difetto.
4. Mai toccare `chromium@wp-control.service`. Mai abilitare `weston.service` al boot:
   partirebbe prima del launcher e col suo `Conflicts=` ucciderebbe la finestra dei 10 s.
5. Backend su `WantedBy=default.target` (gira in **entrambe** le modalità); solo la parte
   che tocca lo schermo fa il controllo e si astiene. Commentarlo come deliberato.
6. Il browser si comanda per **politica** via D-Bus —
   `net.pixsys.Config1.WebBrowser.SetEnabled` sull'oggetto
   `/net/pixsys/Config1/WebBrowser/MainApp` — che il launcher rilegge a ogni avvio,
   **più** uno `stop` per la sessione in corso. Da PixsysOS 2.1.0; sotto, ripiego
   `systemctl disable --now` (con `stop` il symlink in `desktop.target.wants` resta e al
   riavvio il browser torna su *sotto* la nostra finestra). Disponibilità sondata con
   `GetEnabled`, che è una lettura. Ripiego marcato `RIPIEGO`.
7. L'URL della propria UI via `SetUrl`, **prima** dello start: il browser lo rilegge a
   ogni avvio. Il valore di fabbrica (che un factory reset ripristina) punta alla 9443,
   quindi l'installer deve impostarlo.
8. Container rootless: non parla col systemd dell'host. Il processo scrive l'intenzione
   in un file di stato, uno script sull'host la applica (unit `oneshot` + `.path` con
   `PathChanged=`). Non riscrivere un valore identico, o lo schermo commuta a ogni
   salvataggio.
9. Trappole systemd già pagate: `PathChanged=` + `PathExists=` sullo stesso file con un
   `oneshot`/`RemainAfterExit=no` è un ciclo garantito → `failed` per sempre (sul WP630
   era failed da due ore e nessuno l'aveva notato); `PathChanged` scatta anche alla prima
   creazione; `ExecStart=` assoluto; wrapper systemctl con `"$@"` e non `"$1"` (i verbi
   possono essere `disable --now`, e il dry-run non mostra l'errore).
10. L'installer verifica `is-active`/`is-failed` dopo l'`enable --now`: un enable riesce
    anche su una unit che muore due secondi dopo.
11. Log espliciti sulla decisione e sul perché, più un `--dry-run`.

## Collaudo (il dry-run non basta)

Riavviare tenendo premuta l'icona STOP in alto a destra oltre 10 s: compare la login di
Cockpit e **ci resta**, la nostra UI non appare, il backend risponde e i servizi non si
sono fermati, il journal dice «modalità configurazione». Superato in SWS il 2026-08-29
sul WP630 (test 10-13 in `STATUS.md`) — prima era stato provato solo *simulando* la
modalità, mai col gesto vero.

**Un dispositivo lasciato in modalità configurazione ci resta fino a un riavvio
normale**: in quello stato ogni prova di commutazione schermo è inutile.

## Implementazione di riferimento in SWS

`deploy/container/sws-display-apply.sh` (controllo modalità + `attendi_decisione()`),
`deploy/container/sws-display.service` / `.path`, `deploy/container/sws-runtime.container`
(`WantedBy=default.target` deliberato), `scripts/check_systemd_units.sh` (guardia contro
la trappola `PathExists`).

---

## Esito — chiusura dell'11-09-2026

Riverificato vincolo per vincolo contro il codice che spediamo. **Tutti e undici erano
rispettati**; a mancare era il modo di accorgersi se smettessero di esserlo. Questo
documento nasceva come nota trasferibile a un altro progetto e diceva «non rompetela»,
ma in SWS la via di fuga era tenuta in piedi solo dalla memoria di chi l'aveva scritta:
un refactoring che togliesse il controllo di modalità passava ogni test, e il difetto si
sarebbe visto solo su un pannello, con un gesto che nessuno fa per caso.

| Vincolo | Dov'è rispettato | Chi lo difende, da oggi |
|---|---|---|
| 1 · non prendere lo schermo prima di conoscere la modalità | `sws-display-apply.sh`, `in_configurazione`/`in_modalita_normale` | `check_via_di_fuga.sh` §1 |
| 2 · aspettare un esito, non un tempo | `attendi_decisione()`, 1 s × 60 | §2 |
| 3 · nel dubbio non si tocca | quattro rami che escono `0` senza commutare | §3 |
| 4 · mai `chromium@wp-control`, mai `weston` al boot | compare solo in `is-active` | §4, esteso a installer e unit |
| 5 · backend in entrambe le modalità | `sws-runtime.container`, `WantedBy=default.target` | §5 |
| 6 · browser per politica D-Bus, ripiego dichiarato | `SetEnabled` + `stop`, `GetEnabled` come sonda, `RIPIEGO` | §6 |
| 7 · URL prima dello start | `imposta_url_sws` prima di `browser_accendi`; l'installer lo imposta | §7 |
| 8 · non riscrivere un valore identico | `display_target::publish`, uscita anticipata | **quattro test nuovi** in `display_target.rs` |
| 9 · trappole systemd | nessun `PathExists`, `ExecStart` assoluto, wrapper `"$@"` | `check_systemd_units.sh` (già c'era) |
| 10 · l'installer verifica dopo l'`enable --now` | `is-failed` sulle due unit | `check_systemd_units.sh` |
| 11 · log espliciti e `--dry-run` | 29 chiamate a `log`, `--dry-run` | `check_via_di_fuga.sh` §11 |

Il vincolo 8 era **il più esposto**: nessun test lo copriva, e il suo guasto — un lampeggio
del pannello a ogni salvataggio — è di quelli che si attribuiscono al dispositivo invece
che al software. Il test nuovo parte da un file senza newline finale, così distingue «non
ha scritto» da «ha riscritto identico» senza dipendere dalla risoluzione dell'mtime;
provato rosso togliendo l'uscita anticipata.

`check_via_di_fuga.sh` è provata rossa in tre modi, il primo dei quali è il guasto vero
della 2.3.0: un'azione sullo schermo spostata prima del controllo di modalità; poi una
lettura sola al posto del ciclo; poi un `systemctl stop chromium@wp-control`.

### Cosa resta aperto, e di proposito

- **Il `RIPIEGO` pre-PixsysOS 2.1.0** (`systemctl disable --now` quando `SetEnabled` non
  c'è) va tolto quando 2.1.0 sarà su tutti i prodotti. È una decisione sul parco
  installato, non sul codice: si toglie quando lo dice il maintainer, e si trova cercando
  `RIPIEGO`.
- **Q25** resta aperta: quale interruttore decide fra web e LVGL, e quando si valuta. Il
  meccanismo descritto qui la serve ma non la chiude.
- **Il collaudo è un gesto**, e questa guardia legge solo file fermi: riavviare tenendo
  premuta l'icona STOP oltre 10 s resta l'unica prova che vale. Superata il 2026-08-29 sul
  WP630.

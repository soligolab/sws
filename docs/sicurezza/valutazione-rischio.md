# Valutazione dei rischi di cibersicurezza di SWS

> **Bozza del 17-11-2026. Documento interno.** Misurata sul codice di `main` a `4db7e228` (2.26.0-rc.20), sul ramo
> `docs/cra-1-true-statements`. Cresce con le [sessioni CRA](../plans/2026-11-17-cra-sessioni-e-decisioni.md): ogni
> sessione aggiorna le righe che chiude e aggiunge la sua voce al registro delle revisioni in fondo.
>
> **Nomina difetti ancora aperti**, con il punto del codice dove stanno. Per la decisione D5 resta interna finché ne
> nomina uno che non sia già pubblico. La catena d'attacco del cloud (un'espressione legge l'ambiente del container, che
> conteneva il segreto del gateway) è **chiusa sul ramo della sessione 2** (D6, D7), non ancora rilasciata.
>
> I numeri di riga invecchiano: la guardia `scripts/check_security_docs.sh` controlla che ogni `percorso:riga` citato
> qui esista ancora, non che dica ancora la stessa cosa. Chi tocca un punto citato rilegge la riga.

## 1. Cos'è, e quando si aggiorna

È la valutazione dei rischi che il fabbricante deve fare e tenere aggiornata per tutto il periodo di supporto
(art. 13(2)-(3) del regolamento (UE) 2024/2847). Entra nel fascicolo tecnico (Allegato VII, punto 3).

Si aggiorna:
- a ogni sessione del lavoro sul CRA;
- quando nasce una superficie nuova (una porta, una rotta senza credenziali, una chiamata verso fuori, un segreto);
- quando arriva una segnalazione di vulnerabilità ([`procedura-art14.md`](procedura-art14.md));
- prima di ogni dichiarazione di conformità.

Le date del regolamento, lette il 17-11-2026 su una copia dell'art. 71, **da rileggere sul testo ufficiale della
Gazzetta Ufficiale prima di qualunque dichiarazione**:
- l'art. 14 (segnalazione delle vulnerabilità sfruttate e degli incidenti gravi) vale dall'11-09-2026;
- il capo IV (organismi notificati) vale dall'11-06-2026;
- i requisiti essenziali e gli obblighi del fabbricante valgono dall'11-12-2027, e solo per ciò che è immesso sul
  mercato.

## 2. Ambito

**Dentro** (decisione D1: il cloud fa parte del prodotto, perché abbinamento, schermo remoto e deploy dal tunnel
sono funzioni del pannello che senza il gateway non esistono):
- il runtime `sws-runtime`, nelle sue forme: pannello in container (Pixsys, podman), pannello Tiny TY (pacchetto
  armv7, senza podman), istanza IDE (porta 8460), container di progetto nel cloud, e le due **installazioni native**
  (Yocto e Linux generico, con gli installatori di `deploy/yocto/` e `deploy/generic-linux/`);
- i due viewer: la pagina web e il viewer LVGL;
- l'IDE (`sws-editor`), servito dal runtime;
- il gateway del cloud e il tunnel (`sws.soligo.net`, `tunnel.soligo.net`);
- i canali con cui SWS arriva a chi lo usa: le immagini su `ghcr.io`, l'archivio offline, il pacchetto del Tiny TY e
  il suo sito, il sito del manuale.

**Fuori, perché non sono nostri**: il software di terzi qui sotto. **Dentro resta come SWS lo installa, lo configura
e lo espone** (le porte di OpenPLC, la regola polkit del Tiny TY, i container di Traefik e Portainer sul VPS): quei
buchi sono nostri, e stanno nelle righe del §7. Per ogni componente di terzi integrato serve una riga di dovuta
diligenza (art. 13(5)): chi lo fa, che versione, come arrivano le sue correzioni. Si scrive con la sessione 7.
- il sistema operativo dei pannelli (Pixsys OS, Ubuntu del Tiny TY), con il suo Python e le sue librerie;
- il browser dello schermo dei pannelli (il Chromium di Pixsys);
- OpenPLC, che l'IDE installa su richiesta da un'immagine di terzi;
- i fornitori di IA (Anthropic, Moonshot, Mistral, OpenAI, Black Forest Labs) e il modello in casa del cliente;
- i servizi che il progetto configura: broker MQTT, server OPC UA, PLC, Twilio, Telegram, server SMTP;
- Traefik e Portainer sul VPS.

## 3. Uso previsto e ambiente previsto

*Proposta da confermare dal maintainer.*

- **Uso previsto**: supervisione e comando di impianti piccoli e medi (automazione di edifici e di macchine, impianti
  energetici): pagine grafiche, allarmi, storico, ricette, notifiche, su un pannello operatore o in un browser.
- **Non è** un dispositivo di sicurezza: non sostituisce le protezioni dell'impianto. Oggi lo dicono solo le condizioni
  d'uso del cloud (`docs/legale/condizioni-d-uso.md:49-59`); va detto anche per il prodotto.
- **Ambiente previsto**: una rete d'impianto separata da Internet, con il pannello in un luogo presidiato. Da fuori si
  arriva al pannello attraverso il tunnel del cloud, che non apre porte in entrata.
- **Durata d'uso attesa**: *campo del maintainer*.

## 4. Beni da proteggere

| Bene | Dove sta |
|---|---|
| I comandi verso l'impianto (scritture dei tag, ricette, funzioni) | runtime del pannello, protocolli di campo |
| Le credenziali di campo e dei servizi (MQTT, OPC UA, database, SMTP, Twilio, Telegram) | `secrets.yaml` del progetto, in chiaro con permessi 0600 (`sws-runtime/crates/sws-core/src/segreti.rs:382-398`) |
| Le copie dei dati: l'istantanea prima di un aggiornamento, i backup, gli export | `<config>/istantanea/`, la cartella dei backup, gli zip esportati: contengono utenti e, con l'opzione, i segreti |
| Il PIN di servizio del pannello di controllo | `control_panel.pin_hash` nel progetto (Argon2); senza, il PIN del dispositivo, che non è un segreto |
| Gli utenti e le loro password | `users.yaml` del progetto e `utenti_dispositivo.yaml` (Argon2id); `identita.db` nel cloud |
| Lo storico, gli allarmi, l'audit | SQLite e JSONL nella configurazione e nel progetto |
| L'abbinamento del pannello e il token del tunnel | `abbinamento.json` |
| Il segreto del gateway, da cui si ricavano i token dei pannelli e le chiavi dei container | `segreto_gateway` sul VPS; nell'ambiente di ogni container di progetto (`SWS_SEGRETO_GATEWAY`), con la chiave di ritorno del container (`SWS_CHIAVE_RITORNO`) |
| La chiave dell'audit, se c'è | variabile `SWS_AUDIT_KEY`, che nessun installatore imposta |
| Le chiavi dei fornitori di IA | `<fornitore>.key` sull'istanza; cifrate AES-256-GCM nell'account del cloud (`sws-runtime/crates/sws-identita/src/ai_keys.rs:12`) |
| La chiave TLS del pannello | `tls.key` |
| Il codice che gira: immagini, pacchetti, script degli installatori | `ghcr.io`, VPS, macchine di build |

## 5. Attori

- **Operatore** davanti allo schermo; **amministratore** del progetto; **integratore** che lo installa.
- **Chi sta sulla rete d'impianto**, senza credenziali.
- **Chi sta su Internet**: arriva solo al cloud.
- **Un utente del cloud** con un progetto suo, che prova ad arrivare ai progetti e ai pannelli di altre aziende.
- **Chi ha il pannello in mano**: chiavette USB, accesso fisico.
- **Un fornitore esterno compromesso**: fornitore di IA, servizio di notifica, registro delle immagini.
- **Una dipendenza compromessa**: crate Rust, pacchetto npm, immagine di base.

## 6. Metodo

Per ogni superficie: le minacce, le misure, il rischio residuo, con probabilità e impatto su tre livelli (basso,
medio, alto). L'analisi per superficie si scrive con la sessione 7. Questa bozza parte dai requisiti: per ognuno dice
cosa c'è oggi, dove sta nel codice, i buchi aperti e chi li chiude.

## 7. Allegato I, parte I: i requisiti, uno per uno

Bersagli: **P** pannello in container, **TY** pannello Tiny TY, **N** installazioni native (Yocto, Linux generico),
**IDE** istanza IDE, **C** cloud (gateway e container di progetto).

Il **pannello di controllo del dispositivo** compare in più righe. Le sue rotte stanno nel gruppo senza credenziali e
le apre il PIN di servizio. Fino alla sessione 2 c'erano in tutti i router, quindi anche sull'istanza IDE e sul
gateway del cloud, dove non c'è un dispositivo da comandare; ora solo dove c'è un dispositivo
(`sws-runtime/crates/sws-web/src/router.rs:2737`, D9, da rilasciare). «Sessione N» rimanda alla tabella del
[piano delle sessioni](../plans/2026-11-17-cra-sessioni-e-decisioni.md); «D*N*» a una decisione dello stesso file.

| Requisito | Cosa c'è oggi | Buchi aperti | Chi li chiude |
|---|---|---|---|
| **(1)** Progettato, sviluppato e prodotto secondo i rischi | Questa bozza, il capitolo 17 del manuale, la procedura dell'art. 14, le guardie di `scripts/check_static.sh` | La valutazione per superficie e il fascicolo tecnico non ci sono ancora | questa bozza; sessione 7 |
| **(2)(a)** Nessuna vulnerabilità sfruttabile nota | `cargo audit` in CI (`.github/workflows/ci.yml:117`), eccezioni motivate in `sws-runtime/.cargo/audit.toml`; `pnpm audit` solo per le critiche (`.github/workflows/ci.yml:210`) | Difetti noti e aperti: quelli di (b), (d) e (k). Nessuna scansione dell'immagine; `RestrictedPython` senza versione fissata (`deploy/container/Containerfile.aarch64:84`); cinque eccezioni di `audit.toml` con un motivo superato. **TY, N**: Python e librerie del sistema, fuori dal nostro controllo | sessioni 2, 3; scansione, versioni ed eccezioni di `audit.toml`: sessione 5 |
| **(2)(b)** Sicuro di default, con ritorno allo stato originale | Pannello senza utenti chiuso, con un codice di abbinamento di 80 bit e dieci tentativi in cinque minuti (`sws-runtime/crates/sws-web/src/abbinamento.rs:12-24`, `:53-54`); sandbox degli script obbligatoria (`sws-runtime/crates/sws-runtime/src/main.rs:611`); OPC UA non si fida di tutti i certificati (`sws-runtime/crates/sws-core/src/project.rs:1360-1365`); MQTT verifica il broker (`sws-runtime/crates/sws-plugin-mqtt/src/lib.rs:341-348`); **TY** senza credenziali di partenza (`deploy/tiny-ty/sws-runtime-launch.sh:7-10`) | **P, TY** (fino alla sessione 2 anche **IDE** e **C**, D9): il PIN iniziale del pannello di controllo sono le ultime sei cifre del MAC (`sws-runtime/crates/sws-web/src/control_panel/pin.rs:11-13`, `:41`). **N**: `admin`/`admin` (`deploy/yocto/sws-runtime-launch.sh:24`, `deploy/generic-linux/sws-runtime-launch.sh:25`) senza cambio obbligatorio (`sws-runtime/crates/sws-auth/src/lib.rs:344`), e il runtime gira da root (`deploy/generic-linux/sws-runtime.service:17`, `deploy/yocto/sws-runtime.service:18`). OPC UA con policy `None` di default (`sws-runtime/crates/sws-core/src/project.rs:1429-1431`). `--senza-autenticazione` accettata su una rete privata (`sws-runtime/crates/sws-runtime/src/main.rs:1334`, `:2299`). Ritorno allo stato originale: vedi (m) | PIN, `admin`/`admin` e root: sessione 3; OPC UA e `--senza-autenticazione`: dichiarati alla sessione 7; ritorno: sessione 4 |
| **(2)(c)** Aggiornamenti di sicurezza, con avviso | **P**: avviso di versione nuova, installazione da un Admin, finestra programmata o «Pilota automatico» (`sws-runtime/crates/sws-web/src/aggiornamento_finestra.rs:32-37`), sempre preceduti da un'istantanea dei dati che permette di tornare indietro (`sws-runtime/crates/sws-web/src/aggiornamento.rs:622-636`). L'installazione automatica è spenta di default (D2, che ribalta una decisione del 05-10) | **TY, N**: nessun canale e nessun avviso (`sws-runtime/crates/sws-web/src/aggiornamento.rs:62`). **IDE**: nessun avviso. Nessuna firma delle immagini e del pacchetto (vedi (f)). Nessuna versione di sola correzione distinta da quelle con funzioni nuove | avvisi e versioni di sicurezza: sessione 6; firma: sessioni 5 e 6; D2 motivata al §8 |
| **(2)(d)** Protezione dagli accessi non autorizzati, e segnalazione | Argon2, blocco per utente dopo cinque errori, ruoli e zone; confronto a tempo costante di token e firme; lista bianca delle rotte senza credenziali (`scripts/check_rotte_preauth.sh`); pannelli confinati per azienda (`scripts/check_pannello_confinato.sh`) | **Pannello di controllo** (rete, Wi-Fi, ora, riavvio, spegnimento, reset, diagnostica), su tutti i bersagli: fuori dall'autenticazione (`sws-runtime/crates/sws-web/src/control_panel/mod.rs:9`), aperto dal PIN di (b); un blocco solo per tutti dopo cinque errori (`sws-runtime/crates/sws-web/src/control_panel/mod.rs:58-59`). **C**: *chiuso sulla sessione 2, da rilasciare*: ogni container riceveva il segreto del gateway, con cui si calcolano i token dei pannelli e si diventa Admin degli altri container; ora riceve un segreto suo, ricavato da una chiave che non è mai uscita dal gateway (`sws-runtime/crates/sws-web/src/gateway/ritorno.rs:91`, D6 e D10). Chi ha letto il segreto del gateway prima del rilascio potrebbe ancora presentarsi come un pannello abbinato al cloud (`sws-runtime/crates/sws-web/src/tunnel/abbinati.rs:58`): il maintainer ha deciso di cambiarlo al rilascio e di riabbinare i tre pannelli di prova (D10). Il pannello di controllo non esiste più su IDE e gateway (D9). **P, TY**: il cambio password obbligatorio non vale sulla porta del viewer (`sws-runtime/crates/sws-web/src/router.rs:3025`). La guardia delle rotte aperte non vede tutti i gruppi (`scripts/check_rotte_preauth.sh:153`). Nessun avviso attivo di accessi sospetti, solo l'audit. 2FA e LDAP non ci sono | pannello di controllo, guardia e cambio password: sessione 3; segreto del gateway e pannello su IDE e gateway: sessione 2, fatta; token dei pannelli del cloud: segreto cambiato al rilascio della sessione 2; avviso attivo: dichiarato alla sessione 7; 2FA e LDAP: voce P6, fuori da queste sessioni |
| **(2)(e)** Riservatezza a riposo e in transito | **P**: TLS da sé al primo avvio dove l'installatore trova `certutil` (`sws-runtime/crates/sws-runtime/src/main.rs:564-586`; `deploy/container/install-container.sh:562`); fiducia a impronta fra IDE, pannello, MQTT e viewer (`sws-runtime/crates/sws-core/src/pin_tls.rs`); **C**: HTTPS di Let's Encrypt; chiavi IA dell'account cifrate | **P** senza `certutil`, **TY**, **N**, **IDE**: in chiaro di default. Segreti del progetto, chiavi IA dell'istanza, `smtp.yaml`, token del tunnel in chiaro a riposo (permessi 0600); **C**: password SMTP delle aziende in chiaro in `identita.db` (`sws-runtime/crates/sws-identita/src/lib.rs:491`). Protocolli di campo in chiaro per natura (Modbus, S7, EtherNet/IP) | TLS e protocolli: dichiarati alla sessione 7; cifratura a riposo: D3; SMTP delle aziende: da assegnare (sessione 7 lo dichiara o lo manda in un seme) |
| **(2)(f)** Integrità di dati, comandi, programmi, configurazione, e segnalazione della corruzione | Registro di audit a catena di hash con verifica (`sws-runtime/crates/sws-audit/src/lib.rs:187`); validatore del progetto; scritture tipizzate; somma di controllo del pacchetto TY | Nessuna firma né verifica di immagini, archivio offline e pacchetto TY (la somma sta sullo stesso server); il pannello scarica `latest-arm64`, che cambia a ogni rilascio; OpenPLC preso per tag (`deploy/container/install-container.sh:239`); audit non firmato di default (`sws-runtime/crates/sws-runtime/src/main.rs:1261-1267`); CORS `*` (`sws-runtime/crates/sws-web/src/router.rs:1830-1833`). **Segnalazione della corruzione**: solo per l'audit; lo storico SQLite non si controlla, e un archivio di impronte rotto vale come vuoto | firma, verifica e digest: sessioni 5 e 6; firma dell'audit: D3; CORS e corruzione: da assegnare (sessione 7 li dichiara o li manda in un seme) |
| **(2)(g)** Minimizzazione dei dati | IA: i dati del progetto escono solo con una chiave, con i segreti mascherati (`scripts/check_segreti.sh`); modello in casa; cancellazione degli account inattivi nel cloud (`sws-runtime/crates/sws-web/src/ciclo_account.rs`) | **P, TY**: da non abbinato il pannello manda al cloud codice di abbinamento, seriale e nome, di default (`sws-runtime/crates/sws-web/src/tunnel/pannello.rs:132`; `deploy/container/Containerfile.aarch64:149`). **IDE**: il listino da models.dev ogni giorno anche senza IA configurata (`sws-runtime/crates/sws-web/src/ai/price_list.rs:45`; `sws-runtime/crates/sws-runtime/src/main.rs:1557`). **P, TY**: `GET /api/project` senza credenziali sulla porta del viewer dà email, telefoni dei reperibili e codice degli script (`sws-runtime/crates/sws-web/src/router.rs:2268`; seme [progetto letto da un anonimo](../plans/semi/2026-10-26-progetto-letto-da-un-anonimo.md)) | dichiarati alla sessione 7; `/api/project`: il seme, da decidere |
| **(2)(h)** Disponibilità, resistenza al DoS | Limiti di richieste per indirizzo con 429; tetto ai corpi delle richieste (`sws-runtime/crates/sws-web/src/router.rs:576`); tetti di memoria e processi per container nel cloud (`sws-runtime/crates/sws-web/src/gateway/progetti.rs:668-671`); limiti di memoria sul TY (`deploy/tiny-ty/sws-runtime.service:46-47`); riconnessione con attesa crescente | Riavvio, spegnimento e reset col PIN di (b); il blocco unico del PIN tiene fuori anche chi ha il PIN giusto. **C**: i limiti per indirizzo non contano nessuno dietro Traefik (`sws-runtime/crates/sws-web/src/limiti.rs:212-228`). Decompressione degli zip: *chiusa sulla sessione 2, da rilasciare* (`sws-runtime/crates/sws-web/src/zip_limits.rs`, D11). Un'espressione che in un passo solo dà un risultato enorme (`10 ** 10 ** 10`) bloccava l'interprete: *chiusa sulla sessione 2, da rilasciare* (D7); catene di operazioni scritte apposta restano possibili, e le ferma solo il tetto di memoria. **C**: nessun tetto di CPU per container (D12) | PIN: sessione 3; zip ed espressioni: sessione 2, fatta; CPU dei container: sessione 3; cloud: seme del 18-10, dichiarato alla sessione 7 |
| **(2)(i)** Impatto su altri dispositivi e reti | Soglia di scrittura per tag, audit delle scritture, conferma dei comandi critici; il cambio di rete torna indietro da solo dopo 60 secondi | **TY, P**: il pannello di controllo può aprire un punto d'accesso Wi-Fi nella rete d'impianto col PIN di (b) (`deploy/tiny-ty/50-sws-control-panel.pkla:4-8`: sul TY lo concede la nostra regola polkit, su PixsysOS la regola di Pixsys) | sessione 3 |
| **(2)(j)** Superficie d'attacco ridotta | IDE spento sui pannelli (`--no-admin`); rotte dell'IA assenti sui dispositivi (`sws-runtime/crates/sws-web/src/ai/config_api.rs:11-17`); server MCP solo su stdio e in sola lettura (`scripts/check_mcp.sh`) | Le rotte aperte di (d): *tolte sulla sessione 2 da IDE e gateway, dove non servivano, da rilasciare* (D9); restano sui dispositivi. **P**: le porte di OpenPLC pubblicate su tutte le interfacce, senza credenziali finché nessuno crea l'utente (`deploy/container/install-container.sh:326`). **P**: il bus D-Bus di sistema e dell'utente montati nel container (`deploy/container/sws-runtime.container:111`, `:251`). **IDE**: la porta 8460 ascolta su tutte le interfacce | rotte e OpenPLC: sessione 3; D-Bus: D3, dichiarato |
| **(2)(k)** Ridurre l'impatto di un incidente | Utente non root sui pannelli in container, sul Tiny TY e nel cloud; segreti separati dal progetto; tetti per container nel cloud | **N**: il runtime gira da root (vedi (b)). **C, P**: *chiusi sulla sessione 2, da rilasciare*: le espressioni dei tag giravano in Python senza sandbox, e negli script `_getattr_` era `getattr`, quindi chi modificava un progetto leggeva l'ambiente del processo. Ora le espressioni sono un sottoinsieme nella sandbox (D7) e gli script usano `safer_getattr` (D8). **C**: un container non conosce più il segreto del gateway, né la chiave da cui si ricavano i segreti degli altri (D6, D10). **P**: il runtime fa eseguire comandi sull'host come utente (`sws-runtime/crates/sws-web/src/display_target.rs:311-338`) | sandbox e segreto: sessione 2, fatta; root: sessione 3; comandi sull'host: D3, dichiarato |
| **(2)(l)** Registrazione e monitoraggio degli eventi, con la possibilità di disattivarli | Audit di circa 110 azioni (accessi, utenti, progetto, scritture, deploy, aggiornamenti, certificati, pannelli, chiavi IA) | PIN sbagliati e sessione di servizio fuori dall'audit (`sws-runtime/crates/sws-web/src/control_panel/mod.rs:326`); audit non leggibile dalla porta di gestione del pannello; firma dell'audit. **Disattivazione**: l'audit non si spegne; il regolamento chiede che l'utente possa farlo, quindi va motivato o aggiunto | PIN nell'audit: sessione 3; lettura e disattivazione: da assegnare (sessione 7 li dichiara o li manda in un seme); firma: D3 |
| **(2)(m)** Cancellazione sicura dei dati, e trasferimento sicuro | **P, TY**: dal 15-11 un reset parziale dal pannello di controllo, che toglie progetti, utenti del dispositivo e abbinamento (`sws-runtime/crates/sws-web/src/control_panel/reset.rs:31-41`); **C**: cancellazione dell'account e cestino | Il reset lascia la chiave TLS, l'audit, i log, le chiavi IA, `smtp.yaml` e l'**istantanea** di un aggiornamento non confermato, che è una copia intera di progetti e utenti (`sws-runtime/crates/sws-web/src/istantanea_dati.rs:7-10`); cancella i file senza sovrascriverli; lo apre il PIN di (b). **TY, N**: la disinstallazione lascia i dati. **C**: la configurazione di un progetto cancellato resta, e un pannello abbinato non si scioglie. **Trasferimento**: l'export con i segreti (`sws-runtime/crates/sws-web/src/router.rs:7093-7102`), i backup e il deploy verso un pannello in chiaro portano utenti e segreti senza cifratura | cancellazione: sessione 4; trasferimento: dichiarato alla sessione 7 |

## 8. Scostamenti dal default del regolamento, motivati

*Da completare con la sessione 7.*

- **L'installazione automatica degli aggiornamenti è spenta di default** (D2). Un HMI che si riavvia da solo durante
  la produzione ferma l'impianto; il regolamento ammette l'eccezione per gli ambienti dove l'aggiornamento automatico
  interferisce con il processo (considerando 56, da rileggere sul testo ufficiale). Restano l'avviso della versione
  nuova, l'installazione da parte di un Admin, la finestra programmata e il «Pilota automatico».
- **Il TLS non è acceso ovunque**: dove il browser dello schermo non si fida del certificato, accenderlo metterebbe
  l'avviso del browser al posto delle pagine dell'impianto.
- **I protocolli di campo in chiaro**: Modbus, S7 ed EtherNet/IP non hanno una forma cifrata nei dispositivi che si
  collegano.
- **`Network=host` e D-Bus nel container, e i comandi che il runtime fa eseguire all'host**: servono a mDNS, alla
  rete, all'ora, allo schermo del pannello e all'installazione di OpenPLC (D3).

## 9. Rischi residui accettati

*Vuoto finché il maintainer non firma.* Qui andranno, con chi li ha accettati e quando, le voci della decisione D3 e
gli scostamenti del §8.

## 10. Registro delle revisioni

| Data | Cosa | Chi |
|---|---|---|
| 17-11-2026 | Prima bozza: ambito, beni, attori, la tabella dell'Allegato I parte I misurata sul codice (sessione 1) | sessione CRA 1 |
| 18-11-2026 | Sessione 2: segreto per container (D6), espressioni in sandbox (D7), `safer_getattr` (D8), pannello di controllo solo sui dispositivi (D9), tetti agli zip. Righe (d), (h), (j), (k) aggiornate | sessione CRA 2 |
| 18-11-2026 | Sessione 2, dopo due revisioni: chiave dei container separata (D10) e token dei pannelli del cloud ancora aperto; controlli sulle espressioni (D7 corretta); tetti degli zip più bassi (D11); CPU dei container rimandata (D12). Righe (b), (d), (h), (j), (k) e la nota sul pannello di controllo aggiornate | sessione CRA 2 |
| 18-11-2026 | Dopo due revisioni: installazioni native come bersaglio, pannello di controllo anche su IDE e cloud, software di terzi separato da come SWS lo usa, beni completati, (f), (l), (m) completati, tre citazioni corrette, ogni buco con chi lo chiude | sessione CRA 1 |

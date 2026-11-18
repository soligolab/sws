← [Indice](MAIN.md) | [← Prestazioni](16_prestazioni.md) | [Successivo → Container e comunicazione](18_container_e_comunicazione.md) →

---

# 17 — Sicurezza

> Il capitolo «Sicurezza» chiesto dal Cyber Resilience Act (piano
> [`2026-10-15-piano-prima-fascia-e-cra.md`](../plans/2026-10-15-piano-prima-fascia-e-cra.md), voce C8). Dice
> **cosa protegge SWS oggi, come si configura e cosa manca ancora**. Si aggiorna a ogni onda del piano: una
> protezione che non è scritta qui, per chi installa SWS, non esiste.
>
> Aggiornato al 18-10-2026 (onde 1 e 2). Misurato sul codice il 20-10-2026.
> Corretto il 17-11-2026 nei punti che non erano più veri (aggiornamenti, TLS, reset, 2FA e LDAP). La riscrittura
> completa è in programma con la sessione 7 del lavoro sul CRA.

## Chi risponde, e come si segnala

| | |
|---|---|
| Fabbricante | **Mauro Soligo**, che pubblica SWS con il nome «Soligonet» |
| Segnalazioni | segnalazione privata di GitHub (preferita) o `security@soligo.net`, in italiano o in inglese |
| Contatti leggibili dalle macchine | ogni runtime serve `/.well-known/security.txt` (RFC 9116), senza credenziali |
| Tempi | conferma entro 3 giorni lavorativi, prima valutazione entro 10, correzione entro 90 |
| Supporto | correzioni di sicurezza per l'ultima release, per 5 anni dalla data dell'ultima release |
| Avvisi | GitHub Security Advisories, distinti dalle Novità che il pannello mostra prima di aggiornare |
| Vulnerabilità sfruttate e incidenti gravi | procedura interna art. 14 (24 h, 72 h, rapporto finale): [`docs/sicurezza/procedura-art14.md`](../sicurezza/procedura-art14.md) |

Il testo completo è in [`SECURITY.md`](../../SECURITY.md).

## Cosa protegge SWS, per default

Le impostazioni qui sotto sono attive **senza configurare niente**. Dove esiste una deroga, è esplicita e si vede.
Fanno eccezione le due installazioni native (Yocto e Linux generico): il loro installatore crea ancora un Admin
`admin`/`admin`, da cambiare subito.

### Accesso

- **Un pannello senza utenti è chiuso.** Mostra un codice di abbinamento (`XXXX-XXXX-XXXX-XXXX`) sullo schermo, nel
  log e nella sua pagina: solo chi lo legge crea il primo amministratore, in rete locale con «Connetti» o dal cloud.
  Vedi il capitolo [09](09_auth_rbac.md).
- **Il pannello di controllo del dispositivo** (rete, Wi-Fi, ora, riavvio, reset) non usa gli utenti del progetto:
  lo apre un **PIN di servizio**. Finché il progetto non ne imposta uno vale quello del dispositivo, le ultime sei
  cifre del MAC, che non è un segreto. **Impostare un PIN del progetto** è la prima cosa da fare (vedi sotto).
- **Password con Argon2id**, mai in chiaro né nel database né nei log. Sessioni con scadenza.
- **Quattro ruoli** (Viewer, Operator, Supervisor, Admin) e **zone** per pagina e per utente (ABAC).
- **Due porte**: il viewer (`7443`) e la gestione (`7444`). Sul pannello la gestione è **ristretta** (`--no-admin`):
  nessuna interfaccia, solo le rotte che l'IDE chiama, autenticate tranne l'abbinamento e il pannello di controllo
  del dispositivo (che chiede il PIN di servizio). Ascolta su **tutte le interfacce**
  (`0.0.0.0`, `sws-runtime/crates/sws-runtime/src/main.rs`), perché l'IDE in rete locale la raggiunge con «Connetti»;
  chi non la vuole raggiungibile la chiude col firewall. Con `--kiosk` è il **viewer** ad ascoltare solo su
  `127.0.0.1`. Porte e flussi: [capitolo 18, §4](18_container_e_comunicazione.md#4-le-porte).
- **`SWS_IP_ALLOWLIST`** (`192.168.1.0/24,10.0.0.0/8`) limita **il login** agli indirizzi elencati; vuota, nessun
  limite.
- **I segreti del progetto** (password delle sorgenti, token) stanno in `secrets.yaml`, permessi `0600`, mai in git e
  mai in un export condiviso.
- **`/metrics` vuole l'accesso**: una sessione, oppure il token `SWS_METRICS_TOKEN` per Prometheus.

### Dati di campo

- **OPC UA**: il certificato del server si memorizza al primo contatto, come `known_hosts`. Un certificato
  **cambiato** non è mai accettato da solo: la sorgente si ferma e lo dice finché non lo si approva dal trust store.
- **Certificati dei pannelli**: un certificato pubblico valido (per esempio quello del cloud) passa con la verifica
  dei browser; un autofirmato vale per impronta, e un'impronta cambiata è rifiutata.
- **Gli script del progetto e le espressioni dei tag calcolati girano nella sandbox** (RestrictedPython). Senza
  sandbox il runtime non li esegue e dice perché. Un'espressione è un sottoinsieme di Python: valori, operatori,
  f-string, `tags["…"]`, `if`/`else` e un elenco fisso di funzioni (`round`, `min`, `max`, `int`, `float`, `str`,
  `len`, `sum`, `format`…); niente `import`, cicli, funzioni, `range`, `pow` o `"…".format()`. Un'operazione che
  darebbe un risultato enorme (`10 ** 10 ** 10`) si rifiuta subito. Un'espressione che dà errore lascia l'ultimo
  valore marcato «Bad». La deroga `SWS_SCRIPT_SENZA_SANDBOX=1` è solo per le macchine di sviluppo.

### Il browser (dal 17-10-2026)

Ogni risposta porta:

| Intestazione | Valore | Perché |
|---|---|---|
| `Content-Security-Policy` | `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors` dalle origini dichiarate | un contenuto iniettato non può far girare script né portare SWS dentro una pagina altrui |
| `X-Content-Type-Options` | `nosniff` | un file caricato non viene interpretato come qualcos'altro |
| `Referrer-Policy` | `same-origin` | gli indirizzi interni non escono verso altri siti |
| `Strict-Transport-Security` | `max-age=31536000`, **solo in HTTPS** | un pannello in HTTP resta raggiungibile |

Le eccezioni alla CSP sono scritte nel codice (`sws-web/src/sicurezza_http.rs`) con il loro perché:
`style-src 'unsafe-inline'` (gli stili dell'interfaccia), `img-src` e `connect-src` aperti a `http:`/`https:`
(immagini esterne nelle pagine, l'IDE che interroga gli altri runtime).

**Mostrare SWS in un iframe** (per esempio dentro Home Assistant): Configurazione → Istanza → Device →
«Incorporamento in iframe», un'origine per riga (`https://casa.example:8123`). Vuoto vuol dire che solo SWS stesso
può incorniciarsi.

### Troppe richieste (dal 18-10-2026)

Ogni indirizzo ha un tetto di richieste alle API, tarato sulle misure del capitolo [16](16_prestazioni.md): letture
500 di fila e 75 al secondo, scritture 100 e 25 al secondo. Oltre il tetto la risposta è `429` con `Retry-After`.
Non si contano i file dell'interfaccia, i dati vivi (WebSocket), `/health` e i processi del pannello stesso.
`SWS_LIMITE_LETTURE` e `SWS_LIMITE_SCRITTURE` (`<raffica>/<al secondo>`, `0` per spegnere) li cambiano, per esempio
per un ufficio con molte persone dietro lo stesso indirizzo.

### Aggiornamenti e catena di fornitura

- **Aggiornamenti**: di default **non si installano da soli**. Un pannello che segue un canale avvisa quando c'è
  una versione nuova; un Admin la installa, la programma per un giorno e un'ora, oppure accende il «Pilota
  automatico», che installa da sé ogni versione nuova nella finestra scelta. Ogni aggiornamento prende prima
  un'istantanea dei dati, e si torna alla versione precedente se il servizio non riparte. Il pacchetto del Tiny TY
  oggi non ha né canale né avviso: si aggiorna a mano.
- **In CI**: `cargo audit` sulle dipendenze Rust (le eccezioni dichiarate una per una in
  `sws-runtime/.cargo/audit.toml`) e una SBOM CycloneDX a ogni build.
- **Registro delle azioni**: autenticazioni, scritture di tag e modifiche del progetto finiscono in un audit log
  JSONL in sola aggiunta.

## I certificati, in un posto solo (dal 25-10-2026)

**Configurazione → Sicurezza → Certificati** (solo Admin) mostra tutto ciò di cui un'istanza si fida, archivio per
archivio. Con un pannello collegato le colonne sono due: **questa istanza** a sinistra, **il dispositivo connesso** a
destra. Servono tutte e due perché gli archivi stanno nella cartella di chi gira: l'IDE nel cloud e il pannello hanno
certificati e impronte diversi, e lo stesso elenco visto da due posti direbbe due cose diverse.

| Archivio | Cosa contiene | Cosa si fa |
|---|---|---|
| **Certificato TLS** | il certificato del server web: soggetto, nomi, validità, impronta | genera, carica, rimuovi |
| **Dispositivi fidati** | le impronte dei pannelli a cui l'IDE si è collegato (fiducia al primo contatto) | **Dimentica** |
| **Broker MQTT** | le impronte dei broker MQTT in TLS | **Dimentica** |
| **Viewer LVGL** | le impronte di cui si fida lo schermo LVGL | sola lettura |
| **Client OPC-UA** | per ogni sorgente, i certificati fidati e rifiutati | **Fidati**, elimina |
| **Server OPC-UA** | il certificato del server OPC-UA e i suoi client | sola lettura |
| **SSH** | `known_hosts` e la chiave di progetto | sola lettura |

**Le righe di porte non più in uso restano visibili.** La chiave del pinning è `host:porta`: dopo il cambio di porte
del 21-10 (8444 → 7444) lo stesso pannello ha due righe, e quella vecchia si toglie con «Dimentica». «Dimentica» vuol
dire che al prossimo collegamento ci si fiderà del certificato che il pannello presenterà, quindi va usato solo quando
il cambio di certificato è atteso. Ogni «Dimentica» finisce nel registro di audit (`cert.forget`).

**L'archivio del viewer LVGL** si vede dal quadlet 7 in poi, che lo monta in sola lettura nel runtime. Con la
configurazione di servizio precedente la riga lo dice; l'aggiornamento della configurazione del servizio, proposto dal
pannello, la porta.

## Cosa manca ancora

Scritto qui perché chi installa SWS sappia cosa deve coprire da sé, finché non arriva.

| | Cosa | Quando |
|---|---|---|
| C4 | **TLS acceso di default sul pannello.** Dal 26-10-2026 il pannello in container genera il certificato e parte in HTTPS da sé, al primo avvio, dove l'installatore trova `certutil` (i pannelli Pixsys): lì il browser dello schermo si fida del certificato e non mostra avvisi. Dove `certutil` manca il pannello resta in chiaro finché un Admin non genera o carica un certificato: un autofirmato farebbe comparire l'avviso del browser sullo schermo. Il Tiny TY e le installazioni native partono in chiaro | parziale: acceso da sé solo dove c'è `certutil` |
| P6 | **2FA e LDAP / Active Directory** | in programma, con una sessione di plan dedicata |
| C5 | **Reset di fabbrica dei dati.** Dal 15-11-2026 c'è un reset **parziale**: Impostazioni dispositivo → Restituire il dispositivo → «Eliminare progetto e abbinamento» toglie i progetti con storico, utenti e segreti, gli utenti del dispositivo e l'abbinamento al cloud. **Tutto il resto resta sul pannello**, in particolare: il certificato e la chiave TLS, il registro di audit, i log, le impostazioni del pannello, rete e Wi-Fi, e l'istantanea dei dati presa prima di un aggiornamento, se quell'aggiornamento non è ancora stato confermato | parziale: il reset completo è in programma |
| C7 | **Firma delle immagini** (cosign) con verifica sul pannello, **SBOM per release**, scansione dell'immagine in CI | in programma |
| — | **Limiti per indirizzo nel cloud**: dietro Traefik rootless ogni visitatore arriva con lo stesso indirizzo interno, quindi il gateway oggi non limita (seme [`2026-10-18-indirizzo-vero-dietro-traefik.md`](../plans/semi/2026-10-18-indirizzo-vero-dietro-traefik.md)) | da decidere |
| C8 | **Valutazione del rischio e fascicolo tecnico** (Allegato VII) | si scrivono man mano: la valutazione del rischio è una bozza interna dal 17-11-2026 (`docs/sicurezza/valutazione-rischio.md`), il fascicolo segue |

## Per chi installa: le cose da fare a mano

1. **Attivare HTTPS** sul pannello se non si è acceso da sé e la rete non è fidata (Configurazione → Sicurezza → Certificati), e accettare il certificato autofirmato nel browser al primo accesso.
2. **Abbinare il pannello** appena acceso: finché non ha utenti è chiuso, ma il codice è sullo schermo.
3. **Impostare un PIN del progetto** per il pannello di controllo del dispositivo: IDE → Istanza → Device →
   «Schermo e accesso» → «Pannello di controllo del dispositivo». Finché manca, vale il PIN del dispositivo, che
   chiunque in rete può leggere. Sulle installazioni native, **cambiare la password di `admin`**.
4. **Non esporre la porta 7444** fuori dalla rete dell'impianto: ascolta su tutte le interfacce, anche sul pannello,
   quindi va chiusa col firewall verso chi non usa l'IDE. Per raggiungere un pannello da fuori c'è il tunnel del
   cloud, che non apre porte in entrata.
5. **Dichiarare le origini iframe** solo se servono, e solo quelle.
6. **Installare le versioni nuove** quando il pannello le segnala, o accendere il «Pilota automatico», e leggere gli
   avvisi di sicurezza su GitHub. Il Tiny TY e le installazioni native non segnalano niente: vanno controllati a
   mano.

---

← [Indice](MAIN.md) | [← Prestazioni](16_prestazioni.md) | [Successivo → Container e comunicazione](18_container_e_comunicazione.md) →

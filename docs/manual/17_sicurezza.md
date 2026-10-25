← [Indice](MAIN.md) | [← Prestazioni](16_prestazioni.md) | [Successivo → Container e comunicazione](18_container_e_comunicazione.md) →

---

# 17 — Sicurezza

> Il capitolo «Sicurezza» chiesto dal Cyber Resilience Act (piano
> [`2026-10-15-piano-prima-fascia-e-cra.md`](../plans/2026-10-15-piano-prima-fascia-e-cra.md), voce C8). Dice
> **cosa protegge SWS oggi, come si configura e cosa manca ancora**. Si aggiorna a ogni onda del piano: una
> protezione che non è scritta qui, per chi installa SWS, non esiste.
>
> Aggiornato al 18-10-2026 (onde 1 e 2). Misurato sul codice il 20-10-2026.

## Chi risponde, e come si segnala

| | |
|---|---|
| Fabbricante | **Soligonet** |
| Segnalazioni | segnalazione privata di GitHub (preferita) o `security@soligo.net`, in italiano o in inglese |
| Contatti leggibili dalle macchine | ogni runtime serve `/.well-known/security.txt` (RFC 9116), senza credenziali |
| Tempi | conferma entro 3 giorni lavorativi, prima valutazione entro 10, correzione entro 90 |
| Supporto | correzioni di sicurezza per l'ultima release, per 5 anni dalla data dell'ultima release |
| Avvisi | GitHub Security Advisories, distinti dalle Novità che il pannello mostra prima di aggiornare |
| Vulnerabilità sfruttate e incidenti gravi | procedura interna art. 14 (24 h, 72 h, rapporto finale): [`docs/sicurezza/procedura-art14.md`](../sicurezza/procedura-art14.md) |

Il testo completo è in [`SECURITY.md`](../../SECURITY.md).

## Cosa protegge SWS, per default

Le impostazioni qui sotto sono attive **senza configurare niente**. Dove esiste una deroga, è esplicita e si vede.

### Accesso

- **Un pannello senza utenti è chiuso.** Mostra un codice di abbinamento (`XXXX-XXXX-XXXX-XXXX`) sullo schermo, nel
  log e nella sua pagina: solo chi lo legge crea il primo amministratore, in rete locale con «Connetti» o dal cloud.
  Vedi il capitolo [09](09_auth_rbac.md).
- **Password con Argon2id**, mai in chiaro né nel database né nei log. Sessioni con scadenza.
- **Quattro ruoli** (Viewer, Operator, Supervisor, Admin) e **zone** per pagina e per utente (ABAC).
- **Due porte**: il viewer (`7443`) e la gestione (`7444`). Sul pannello la gestione è **ristretta** (`--no-admin`):
  nessuna interfaccia, solo le rotte che l'IDE chiama, tutte autenticate. Ascolta su **tutte le interfacce**
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
- **Gli script Python girano nella sandbox** (RestrictedPython). Senza sandbox il runtime non li esegue e dice
  perché. La deroga `SWS_SCRIPT_SENZA_SANDBOX=1` è solo per le macchine di sviluppo.

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

- **Aggiornamenti automatici** per default (`AutoUpdate=registry`), in una finestra scelta da chi gestisce il
  pannello, con istantanea dei dati prima e ritorno alla versione precedente se il servizio non riparte.
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
| C4 | **TLS acceso di default sul pannello.** Oggi il pannello parla HTTP finché qualcuno non attiva HTTPS dall'IDE: in una rete non fidata va attivato a mano | onda 3, serve una sessione di plan |
| P6 | **2FA e LDAP / Active Directory** | onda 3, con C4 |
| C5 | **Reset di fabbrica dei dati** (progetti, storico, utenti, segreti, certificati) | onda 4 |
| C7 | **Firma delle immagini** (cosign) con verifica sul pannello, **SBOM per release**, scansione dell'immagine in CI | onda 5 |
| — | **Limiti per indirizzo nel cloud**: dietro Traefik rootless ogni visitatore arriva con lo stesso indirizzo interno, quindi il gateway oggi non limita (seme [`2026-10-18-indirizzo-vero-dietro-traefik.md`](../plans/2026-10-18-indirizzo-vero-dietro-traefik.md)) | da decidere |
| C8 | **Valutazione del rischio e fascicolo tecnico** (Allegato VII) | si scrivono man mano, a partire da questo capitolo |

## Per chi installa: le cose da fare a mano

1. **Attivare HTTPS** sul pannello se la rete non è fidata (Configurazione → Sicurezza → Certificati), e accettare il certificato da `http://<pannello>:8080`.
2. **Abbinare il pannello** appena acceso: finché non ha utenti è chiuso, ma il codice è sullo schermo.
3. **Non esporre la porta 7444** fuori dalla rete dell'impianto: ascolta su tutte le interfacce, anche sul pannello,
   quindi va chiusa col firewall verso chi non usa l'IDE. Per raggiungere un pannello da fuori c'è il tunnel del
   cloud, che non apre porte in entrata.
4. **Dichiarare le origini iframe** solo se servono, e solo quelle.
5. **Tenere attivi gli aggiornamenti automatici**, o almeno leggere gli avvisi di sicurezza su GitHub.

---

← [Indice](MAIN.md) | [← Prestazioni](16_prestazioni.md) | [Successivo → Container e comunicazione](18_container_e_comunicazione.md) →

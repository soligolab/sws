# I certificati in un posto solo — le decisioni, dopo la sessione di plan

> **Era un seme, dal 22-10-2026 porta le decisioni.** La sessione di plan che il seme chiedeva è
> stata fatta quella notte, misurando il codice. Qui c'è quello che serve a decidere; le misure
> vecchie del seme (15-10 e 21-10) sono in coda, con le correzioni.
>
> Domanda d'origine del maintainer, 15-10-2026: «la gestione dei certificati ha senso gestirla in
> un menù dedicato… qualcosa ispirato a CODESYS Security Agent?».

## Tre cose che la misura ha cambiato

**1. «Serve una dipendenza nuova che parsi i certificati» — falso.** Un parser X.509 completo,
`x509-cert 0.2.5`, è **già compilato dentro il binario**: ci arriva da `async-opcua-crypto`, con le
feature `pem` e `std` attive. Metterlo fra le dipendenze dirette di `sws-web` è **una riga** di
Cargo.toml e **zero crate nuovi da compilare**. E `sws-web` ha già `rustls-pemfile` per passare da
PEM a DER, e `sws_core::pin_tls::impronta_sha256` per l'impronta. Era la frase che faceva sembrare
questo lavoro grande il doppio.

**2. Il trust store OPC-UA non funziona.** Le tre rotte leggono `trusted/certs` e `rejected/certs`;
la libreria — e il nostro stesso plugin — usano `trusted/` e `rejected/`, senza quel livello.
L'elenco è **sempre vuoto**, «Fidati» risponde 204 senza fare niente, «Elimina» risponde 404. E il
messaggio di errore della fiducia al primo contatto dice «fidati del nuovo dal trust store della
sorgente», cioè manda l'utente in una tabella che non può funzionare.

**Ma correggere il percorso non basta**, e questa è la parte che lo scettico ha trovato: il client
`async-opcua` valida e archivia il certificato del server **solo** se la policy non è `None` — e
`None` è il default in **tre posti indipendenti** (il serde di `sws-core`, la sorgente vuota che
crea l'IDE, il template `opcua-demo`). Quindi il ramo corto non è un refuso di quattro righe: è
una domanda sul default della policy.

**3. C'è un sesto archivio che nessuno ha dichiarato.** Il server OPC-UA non ha identità (vero),
ma un trust store ce l'ha: `ServerBuilder::new()` mette `pki_dir = <cwd>/pki` e lo **crea**. In un
container senza `WORKDIR` quella è la radice. Un reset di fabbrica non saprebbe cancellarlo.

## Gli archivi, misurati il 22-10-2026

| Uso | Dove | Interfaccia oggi |
|---|---|---|
| Certificato del server web | `<config>/tls.crt` + chiave | Istanza → Device → Stato → Certificato TLS |
| IDE → dispositivi (TOFU) | `<config>/dispositivi_conosciuti.yaml` | solo «dimentica», dentro un messaggio d'errore |
| Broker MQTT (TOFU) | `<config>/mqtt_broker_conosciuti.yaml` | nessuna |
| OPC-UA client, per sorgente | `<progetto>/opcua-pki/<sorgente>/` | **rotta rotta** (vedi sopra) |
| Viewer LVGL (TOFU) | `/var/sws/viewer/lvgl_tls_conosciuti.yaml` | nessuna, **e il runtime non la vede**: è in un altro container |
| *(sesto, non dichiarato)* | `<cwd>/pki` del server OPC-UA | nessuna |

Più **due archivi di chiavi SSH** che il seme non nominava: `~/.ssh/known_hosts` (col «dimentica»
già fatto) e le chiavi di progetto in `<progetto>/.git/sws-ssh/`.

**Nove rotte** toccano certificati o impronte. `GET /api/system/tls` restituisce **un booleano**:
nessuna rotta, da nessuna parte, dà soggetto, emittente o validità. `ImprontaStore` non sa nemmeno
elencare — manca il metodo, sono quattro righe.

**Su sei operazioni che cambiano un certificato, cinque non finiscono nell'audit.**

---

## Le decisioni — tutte e otto prese il 23-10-2026

| | Scelta |
|---|---|
| **1. Il trust store OPC-UA rotto** | **Tutti e due adesso**: il percorso `trusted/certs` → `trusted` **e** il default della policy di sicurezza |
| **2. La card TLS a dispositivo remoto** | **Si aggiungono le rotte remote** (`/api/remote/system/tls`), perché è il presupposto di C4 |
| **3. Il perimetro della vista** | **Una scheda, due colonne**: «questa istanza» e «dispositivo connesso» |
| **4. L'archivio del viewer LVGL** | **Si monta in sola lettura** nel runtime: quadlet 6 → 7 |
| **5-6. Il certificato del pannello** | **Nome vero e scadenza breve**, con avviso e rinnovo |
| **7. Ruoli e audit** | **Tutto Admin**, e i cinque eventi di audit mancanti si aggiungono qui |
| **8. Le righe morte del pinning** | **Si mostrano**, col loro «dimentica» |

### Cosa discende dalle tre

**«Tutti e due adesso» è la scelta coraggiosa, e va fatta sapendo cosa tocca.** Il default
`security_policy: None` sta in **tre posti indipendenti**: il `serde(default)` di `sws-core`, la
sorgente vuota che crea l'IDE, e il template `opcua-demo`. Cambiarlo non rompe una sorgente che
dichiara `None` di proposito — quella continua a dichiararlo — ma cambia il comportamento di ogni
sorgente che **non lo dichiara**, e quelle sono le più vecchie. Serve la stessa regola di
compatibilità che la Fase 3 ha scritto per Modbus: **un progetto che non ha mai scelto si comporta
come prima**, e solo una scelta esplicita attiva il nuovo. Altrimenti il primo aggiornamento
stacca le sorgenti OPC-UA di chi non ha fatto niente di male.

**Le rotte remote e le due colonne sono la stessa cosa vista due volte.** La decisione 2 chiede
`/api/remote/system/tls`; la decisione 3 chiede `/api/remote/certificati/*`. Conviene disegnarle
insieme: la prima è un caso particolare della seconda, e farle in due giri vuol dire scrivere due
volte lo stesso proxy.

**Il buco della colonna «dispositivo connesso» si chiude con una riga**: l'archivio del viewer
LVGL si monta in sola lettura nel runtime, quadlet 6 → 7, e l'aggiornamento se lo porta dietro da
solo — lo stesso meccanismo appena usato per il journal.

**La scadenza breve è la decisione che fa più lavoro, e non è lavoro della vista.** Oggi il
certificato non scade (1975 → 4096) e nessuno legge una validità, nemmeno al caricamento di un
certificato esterno. Portarlo a uno o due anni vuol dire costruire **avviso e rinnovo**, e decidere
**dove si vede** l'avviso: barra dell'IDE, allarme di sistema, email. È materia di C4, e va
disegnata nella stessa sessione.

**E c'è una domanda che il nome vero si porta dietro**: i certificati già generati non cambiano
finché non li si rigenera, e rigenerare **rompe la fiducia di chi si era già fidato
dell'impronta**. Va deciso se la vista offre «rigenera» e cosa dice a chi lo preme.

**«Tutto Admin» è un cambio di comportamento**: l'elenco dei certificati OPC-UA oggi è Supervisor.
Va in `NOVITA.yaml`. Con lui si chiudono i cinque eventi di audit mancanti — su sei operazioni che
cambiano un certificato, oggi cinque non lasciano traccia.

## Le decisioni, una per una

### 1. Il trust store OPC-UA rotto — **DECISA: percorso e policy, tutti e due adesso**

Non è il refuso che sembrava. Le opzioni:

- **a** — ramo corto ora, **e** la domanda sul default della policy. Senza quella, correggere il
  percorso non riempie nessuna tabella.
- **b** — dentro il ramo della vista unica, all'onda 3. Resta rotto per settimane, e la sessione
  dell'onda 3 partirebbe da un'interfaccia che non ha mai funzionato.
- **c** — insieme alla card TLS remota (decisione 2): sono due difetti della stessa famiglia.

### 2. La card «Certificato TLS» a dispositivo remoto — **DECISA: si aggiungono le rotte remote**

Oggi mostra e modifica **l'istanza locale**, anche con un pannello connesso. Il resto della scheda
usa la variante remota; per il TLS quella rotta non esiste.

- **a** — aggiungere `/api/remote/system/tls` (~80 righe), come già esiste per system, backup,
  database e ritenzione. **È il presupposto di C4**: TLS acceso di default con installer e «Connetti».
- **b** — nascondere la card quando c'è un remoto, e dire «si gestisce dalla vista Certificati».
- **c** — lasciarla e scriverlo nell'etichetta.

### 3. Il perimetro della vista — **DECISA: una scheda, due colonne**

Il problema è reale e misurato: `tls.crt` e `dispositivi_conosciuti.yaml` stanno nella cartella di
configurazione **di chi gira**. Lo stesso schermo mostra archivi diversi a seconda dell'istanza.

- **a** — una scheda, due colonne: «questa istanza» e «dispositivo connesso». Serve una famiglia
  `/api/remote/certificati/*`.
- **b** — solo l'istanza locale; per il pannello ci si collega al pannello.
- **c** — due foglie sotto Sicurezza: Certificati (IDE) e Certificati (Dispositivo).

### 4. L'archivio del viewer LVGL — **DECISA: si monta in sola lettura**

Il runtime **non lo vede**: è montato solo nel container del viewer.

- **a** — una riga nel quadlet del runtime (`Volume=…/viewer:…:ro`), quadlet 6 → 7, e
  l'aggiornamento se la porta dietro da solo. Tutti gli archivi nella vista, e il reset di fabbrica
  sa cosa cancellare.
- **b** — resta fuori, e la vista nasce incompleta proprio sull'archivio che protegge il pannello.
- **c** — lo espone il viewer con un endpoint: un protocollo nuovo fra due container, per un file
  di poche righe.

### 5. Il nome del certificato del pannello — **DECISA: nome vero**

Oggi è **«CN=rcgen self signed cert»**, uguale su ogni pannello: nessuno imposta il
`distinguished_name`. Una colonna «soggetto» mostrerebbe quella stringa a tutti.

- **a** — si lascia.
- **b** — il nome del pannello o l'`instance_id` quando si genera: due righe. Ma i certificati già
  generati non cambiano finché non li si rigenera, e allora va deciso **cosa succede a chi si era
  già fidato dell'impronta vecchia**.

### 6. La scadenza — **DECISA: si accorcia, e gli avvisi si costruiscono (lavoro di C4)**

Il self-signed **non scade mai** (rcgen: 1975 → 4096, e nessuno lo cambia). Nemmeno
`upload_tls_cert` legge la validità di quello che gli si carica.

- **a** — si lascia: «avvisi di scadenza» resta una riga di documentazione, non una funzione.
- **b** — uno o due anni, con avviso e rinnovo. È lavoro di C4, non della vista, e va deciso anche
  **dove si vede** l'avviso: barra dell'IDE, allarme di sistema, email.

### 7. Ruoli e audit — **DECISA: tutto Admin, e l'audit si chiude qui**

- Ruoli: tutta Admin (coerente con le rotte di oggi), oppure due livelli come adesso — l'elenco dei
  certificati OPC-UA è Supervisor, le scritture Admin. **Portare quella rotta a Admin è un cambio
  di comportamento e va in `NOVITA.yaml`.**
- Audit: i cinque eventi mancanti (`tls.generate`, `tls.upload`, `tls.remove`,
  `opcua.cert_trust`, `opcua.cert_delete`) sono **~15 righe**, e chiudono il requisito CRA di
  tracciabilità insieme alla vista invece di lasciarlo aperto nel fascicolo.

### 8. Le righe morte del pinning — **DECISA: si mostrano, col loro «dimentica»**

La chiave del pinning è `host:porta`, quindi per lo stesso pannello ci sono due righe. Il gesto che
le toglie tutte esiste già (`dimentica_host`): manca solo chi lo chiama.

- **a** — si lasciano e si mostrano, col loro «dimentica». Zero codice fuori dalla vista.
- **b** — si puliscono quando scatta il ripiego di porta.
- **c** — un «pulisci le porte non più in uso» dentro la vista.

---

## Quanto costa, quando si parte

- **Il difetto OPC-UA da solo**: mezza sessione — *se* la decisione 1 non apre la domanda sulla
  policy.
- **La vista intera**: ~1 500-2 000 righe su 12-18 file. Due o tre rami annidati, due o tre
  sessioni. Il ramo Sicurezza nell'albero di Configurazione **esiste già**, con una foglia sola
  (`users`): aggiungerne una è una riga più il componente.

**Quando.** Il seme proponeva di progettarlo nella sessione dell'onda 3 (TLS di default + 2FA/LDAP),
e quella proposta regge: C4 cambia proprio il primo archivio e il modo in cui l'IDE si fida del
pannello. Le onde 1 e 2 sono chiuse; C4 e C5 non sono iniziati.

---

## Le misure vecchie del seme (15-10 e 21-10), con le correzioni

Il seme diceva «gli archivi sono cinque, non sei», togliendo il server OPC-UA perché non ha
identità. Sull'identità aveva ragione; sul trust store no — ce l'ha, in `<cwd>/pki`, e nessuno lo
ha mai dichiarato. **Sono sei, ma non quelli che pensava il testo del 15-10.**

Reggono: il doppio modello impronte-contro-PKI; il fatto che il cambio di porte non tocchi il
certificato ma tocchi il pinning; e che non ci fosse un sottoinsieme veloce — quello cade con
`x509-cert`.

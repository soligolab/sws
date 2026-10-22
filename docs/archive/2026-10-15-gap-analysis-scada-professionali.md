# Cosa manca a SWS per stare accanto agli SCADA professionali

> Analisi del 15-10-2026, chiesta dal maintainer: «capire quali funzionalità mancano ancora ad SWS per essere
> equiparabile agli SCADA professionali». **Non è un piano d'esecuzione**: è una mappa per scegliere. Ogni voce che
> diventerà lavoro parte, come da regola, da una sessione di plan dedicata.

## Dove sta questo documento, e cosa è cambiato (22-10-2026)

**Non è un piano, ed è per questo che sta in `docs/archive/`**: è la mappa da cui si sceglie su
cosa investire, e il posto dei referti è qui. Il lavoro che ne discende vive altrove e resta
vivo — [piano prima fascia e CRA](../plans/2026-10-15-piano-prima-fascia-e-cra.md), dove le
voci sono diventate P1-P6 con le loro onde.

Dalla stesura del 15-10-2026 **tre voci di prima fascia sono state fatte**, e la mappa senza
questa nota direbbe il falso:

- **Finestre popup** (§5): fatte sul web il 17-10 e sul pannello LVGL il 22-10 — modali, con
  parametri, e `open_faceplate`. Vedi [finestre modali su LVGL](2026-10-22-finestre-modali-su-lvgl.md).
- **Prestazioni** (§7): la ritenzione automatica dei datastore è uscita in 2.16.0-rc.1, provata
  su 6 milioni di righe.
- **Licenze** (§ relativo): metà fatta — `max_pannelli` si mostra. Quando si **consuma** e
  soprattutto quando si **libera** una licenza resta aperto, ed è un seme suo:
  [quando si libera una licenza](../plans/2026-10-21-quando-si-libera-una-licenza.md).

Il resto della mappa vale ancora. Chi la rilegge per decidere la seconda o la terza fascia
riparta da qui, non dalle righe singole: una mappa misurata su `main 0637bf82` ha ormai qualche
mese di scarto, e le misure vanno rifatte prima di fidarsene.

## Il metro

Confronto con quello che un integratore si aspetta da uno SCADA commerciale di fascia media e alta: Inductive
Automation **Ignition**, Siemens **WinCC** (Unified e OA), AVEVA **InTouch / System Platform**, GE **iFIX / CIMPLICITY**,
COPA-DATA **zenon**, Progea **Movicon.NExT**. Non si confronta con la loro estensione (decenni di moduli), ma con le
**funzioni che un capitolato o un integratore danno per scontate**.

Ogni voce dice cosa fanno loro, **cosa ha SWS oggi, misurato sul codice** (main `0637bf82`), quanto pesa per un
cliente e quanto costa. Legenda: ✅ c'è · 🟡 c'è in parte · ❌ manca. Peso: **A** blocca una vendita / un capitolato,
**M** lo nota un integratore esperto, **B** è un plus. Costo: **S** giorni, **M** settimane, **L** mesi.

## Quello che SWS ha già (e che spesso gli altri fanno pagare a parte)

| Area | Cosa | Dove |
|---|---|---|
| Motore tag | Tag DB in memoria, tipi scalari, strutture e array (UDT), tag calcolati da espressione, generatori di simulazione | `sws-core` (`tipo.rs`, `percorso.rs`, `project.rs`) |
| Protocolli | Modbus TCP/RTU, OPC UA client **e server**, MQTT + Sparkplug B, Siemens S7, EtherNet/IP, Home Assistant | `sws-plugin-*` |
| Storico | Deadband / on-change / periodico; backend **SQLite, PostgreSQL, ODBC**; esportazione | `sws-historian`, `/api/history/export` |
| Allarmi | Macchina a stati ISA-18.2, ACK, shelving, ritardo, inibizione, giornale, escalation dei non riconosciuti, notifiche SMTP e Telegram | `sws-core/alarm.rs`, `sws-web/notifications.rs` |
| HMI | 38 tipi di oggetto, 138 simboli 2.5D con parti vive, tubazioni con bocche e 8 stili, faceplate, multilingua, motore **web e LVGL** con parità verificata | `sws-editor`, `sws-lvgl-viewer` |
| Comandi | 7 modalità del bottone, assegnazioni, simboli che comandano, conferma, **comando critico con password e motivo** | `SvgCanvas.tsx`, `lvgl_render.rs` |
| Sicurezza | Argon2id, RBAC + zone (ABAC), audit **a catena di hash firmato**, abbinamento col codice, aggiornamento con snapshot e rollback | `sws-auth`, `sws-audit`, `sws-identita` |
| Ingegneria | Editor web WYSIWYG, validatore semantico, **GitOps**, ricette, script Python in sandbox con scheduler, import CSV dei tag, assistente IA | `sws-editor`, `sws-pyscript` |
| Parco | IDE cloud, tunnel dei pannelli, deploy remoto, catalogo dispositivi, immagine di boot | `sws-web/remote.rs`, gateway |

Questo è già **più** di quanto offra una parte del mercato HMI/SCADA leggero. Le mancanze sotto sono quelle che
separano SWS dai prodotti di fascia professionale.

## Le mancanze, per area

### 1. Affidabilità e continuità

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **Ridondanza server** (hot standby, failover automatico, sincronizzazione di tag, allarmi e storico) | standard in WinCC, Ignition, zenon, System Platform | ❌ nessuna traccia nel codice | **A** per impianti di processo, M per macchine | **L** |
| **Store-and-forward dello storico** (buffer locale se il DB è irraggiungibile, poi recupero) | Ignition, Historian AVEVA | 🟡 SQLite locale sì; con PostgreSQL/ODBC remoti, da verificare cosa succede a DB giù | **A** se si vende lo storico centrale | M |
| **Timestamp alla sorgente e sequenza degli eventi** (SOE, millisecondi dal PLC) | standard con OPC UA, DNP3, IEC 104 | 🟡 il tag ha `ts`; manca una vista SOE e la garanzia che il timestamp venga dalla sorgente su tutti i driver | M | M |
| **Watchdog dei driver e qualità per tag** coerente su tutti i protocolli | standard | ✅ qualità Good/Bad/Uncertain, stale, stato sorgenti (`/api/sources/stato`) | — | — |

### 2. Storico, analisi e report

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **Report programmati** (giornaliero/turno/mese in PDF o Excel, inviati per email o salvati) | modulo Reporting di Ignition, WinCC Information Server, zenon Report Engine | ❌ c'è solo l'esportazione CSV su richiesta | **A**: è la prima cosa che chiede un capitolato | M |
| **Aggregati e compressione** (min/max/media/integrale per intervallo, swinging door) | tutti gli historian di processo | 🟡 deadband sì; aggregati lato query da verificare; compressione no | M | M |
| **Analisi sui trend**: confronto fra periodi, cursori e differenze, esportazione dal trend, annotazioni | standard | 🟡 trend con pan e zoom; il resto da misurare | M | S–M |
| **KPI di produzione**: OEE, fermi con causali, conteggi di turno | moduli OEE/Downtime (Ignition, zenon, Movicon) | ❌ | M (A nel manifatturiero) | M–L |
| **Batch ISA-88**, genealogia di lotto | Ignition Sepasoft, WinCC Batch, AVEVA Batch | 🟡 ricette sì, batch no | B per il target attuale | L |
| **Gestione energia** (contatori, profili, ripartizione) | moduli energy di zenon, WinCC | ❌ (si può fare a mano con tag e trend) | M nel building, B altrove | M |

### 3. Allarmi (oltre ISA-18.2 base)

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **Notifiche SMS e chiamate vocali, turni di reperibilità** con conferma dal telefono | Ignition Alarm Notification, WIN-911, zenon | 🟡 SMTP e Telegram con escalation; niente SMS/voce né calendari di reperibilità | **A** per impianti non presidiati | M |
| **KPI degli allarmi ISA-18.2** (allarmi/ora per operatore, flood, chattering, allarmi stantii, top 10) | standard nei prodotti recenti | ❌ il giornale c'è, l'analisi no | M | S–M |
| **Raggruppamenti, first-out, soppressione per stato d'impianto** (un trip non genera 50 allarmi) | standard | 🟡 inibizione per tag sì; soppressione per gruppo/stato e first-out no | M | M |
| **Commenti e storico operatore** sull'allarme, con ricerca e filtri avanzati | standard | 🟡 ACK con motivo; ricerca e commenti da verificare | B | S |

### 4. Protocolli e integrazione

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **BACnet/IP** | standard nel building | ❌ | **A** nel building/HVAC (famiglia di simboli già presente) | M |
| **M-Bus / wM-Bus** (contatori) | comune | ❌ | M nell'energia | M |
| **SNMP** (infrastruttura IT, UPS, switch) | comune | ❌ | M | S–M |
| **DNP3, IEC 60870-5-104, IEC 61850** | standard nelle utility (energia, acqua) | ❌ | A solo se si punta alle utility | L |
| **Connettore SQL come sorgente** (tag letti/scritti da query) e **client REST/HTTP** | Ignition (SQL Bridge), WinCC | ❌ | M: è il collante con i gestionali | S–M |
| **OPC UA Alarms & Conditions, Historical Access** lato server | prodotti di fascia alta | 🟡 server OPC UA espone i tag; A&C e HA no | M verso MES/sistemi superiori | M |
| **OPC Classic (DA)** | legacy Windows | ❌ | B (in uscita dal mercato) | — |

### 5. HMI e operatività

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **Finestre popup generiche** (una pagina aperta come finestra modale o non modale, parametrica) | standard | 🟡 popup dei faceplate sì; pagina qualunque come popup no | **A**: è il modo normale di fare un dettaglio | S–M |
| **Client mobile** (layout responsive, notifiche push) | Ignition Perspective, WinCC Unified | 🟡 PWA sì; layout che si adatta al telefono no | M | M |
| **Mappe GIS** (impianti sul territorio) e **video da telecamere** | comuni | ❌ | M (acqua, impianti distribuiti) | S–M ciascuno |
| **Stampa di pagine e report** | standard | ❌ | B | S |
| **Stile ad alte prestazioni ISA-101** come tema di progetto | in crescita | 🟡 volume 0 = piatto già possibile; manca un tema completo con palette e regole | B | S |

### 6. Identità, sicurezza, conformità

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **LDAP / Active Directory** | standard | ❌ dichiarato fuori ambito (`sws-auth/src/lib.rs:13`) | **A** in azienda strutturata | M |
| **SSO OIDC/SAML** | Ignition, WinCC Unified | ❌ | M | M |
| **Autenticazione a due fattori** | in crescita | 🟡 colonna `totp_segreto` riservata, funzione no | M | S |
| **Firme elettroniche e audit trail 21 CFR Part 11** | moduli dedicati | 🟡 comando critico con password e motivo, audit firmato; manca il pacchetto completo (doppia firma, revisione) | M nel farma/alimentare | M |
| **IEC 62443 / CRA** | certificazioni di prodotto | 🟡 vedi [gap analysis CRA](2026-10-05-cra-gap-analysis.md): P0 contatti, P1 TLS di default sul pannello | **A** dal 2027 per il CRA | M |

### 7. Ingegneria e ciclo di vita

| Funzione | Gli altri | SWS | Peso | Costo |
|---|---|---|---|---|
| **Template d'oggetto con istanze che si aggiornano** (cambi il tipo «motore» e cambiano tutti i motori) | UDT + template grafici in tutti i prodotti | 🟡 strutture di tag sì, faceplate sì; da verificare la propagazione delle modifiche alle istanze | **A** sopra le poche centinaia di oggetti | M |
| **Modello d'impianto gerarchico** (ISA-95: sito/area/linea/macchina) usato da allarmi, storico e navigazione | Ignition, System Platform | 🟡 zone e albero delle pagine; nessun modello d'asset unico | M | M–L |
| **Più ingegneri sullo stesso progetto** (lock, merge) | Ignition, WinCC OA | 🟡 GitOps; nessun lavoro concorrente nell'IDE | M | M |
| **Prestazioni dichiarate** (tag per runtime, client contemporanei, misurate) | schede tecniche | ❌ nessun numero misurato e pubblicato | **A**: è la prima domanda di un integratore | S–M (misurare) |
| **Licenze** (per tag, per client, per modulo) | tutti | ❌ | A per vendere, non per il prodotto | M |

## Lettura: dove conviene investire

SWS non deve rincorrere tutto: il suo terreno è **la macchina e il piccolo impianto**, con pannello (web o LVGL),
IDE nel cloud e parco gestito da remoto. Su quel terreno le mancanze che pesano davvero sono poche.

**Prima fascia — senza queste, un integratore lo scarta:**

1. **Report programmati** PDF/Excel via email (2).
2. **Finestre popup** generiche e parametriche (5).
3. **Template d'oggetto** con istanze che seguono le modifiche (7) — da misurare quanto manca davvero.
4. **Notifiche SMS/voce** e reperibilità, o almeno un ponte verso un servizio esterno (3).
5. **Numeri di prestazione** misurati e scritti (7).
6. **LDAP/AD** e **2FA** (6), più il P0/P1 della gap analysis CRA.

**Seconda fascia — allargano il mercato:** BACnet e M-Bus (building ed energia, dove la libreria ha già i simboli),
connettore SQL/REST, KPI degli allarmi, soppressione per stato e first-out, store-and-forward dello storico,
client mobile responsive.

**Terza fascia — solo con una scelta di mercato precisa:** ridondanza server, DNP3/IEC 104/61850, batch ISA-88,
OEE completo, GIS e video.

Dove SWS è **già avanti** e va raccontato: doppio motore web/LVGL con parità verificata, simboli 2.5D con parti vive
e tubazioni con bocche, editor nel browser con assistente IA, GitOps, aggiornamento con rollback, audit firmato.

## Cosa non è verificato

Alcune caselle 🟡 sono da misurare prima di diventare lavoro: il comportamento dello storico remoto a DB giù, gli
aggregati in query, la propagazione delle modifiche alle istanze di faceplate, la ricerca nel giornale allarmi.
**Per ognuna, quando si inizia, il primo passo è una sessione di plan approfondita**, come per ogni seme.

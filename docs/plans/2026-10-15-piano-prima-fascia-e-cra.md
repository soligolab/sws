# Piano d'azione: prima fascia SCADA e punti CRA scoperti, in parallelo

> 15-10-2026, chiesto dal maintainer: «per la prima fascia prova a generare un piano di azione che la inglobi assieme
> ai punti principali ancora scoperti della CRA, così da portare avanti le due cose in parallelo».
> Fonti: [gap analysis SCADA](../archive/2026-10-15-gap-analysis-scada-professionali.md) (prima fascia) e
> [gap analysis CRA](../archive/2026-10-05-cra-gap-analysis.md) §8 (stato al 12-10-2026).

## Come si lavora «in parallelo» senza rompere le regole

Vale «un ramo alla volta» (`CLAUDE.md`). Il parallelo quindi non sta nei rami, sta nel **calendario**: ogni **onda**
abbina un pezzo di prodotto (binario **P**) e uno CRA (binario **C**), fatti uno dopo l'altro nella stessa onda,
ognuno col suo ramo chiuso e mergiato prima del successivo. Le onde sono pensate per una o due sessioni da 3–4 ore.
Dove i due binari toccano gli stessi file, si fanno nello stesso ramo o in rami annidati.

Ogni voce marcata **[plan]** parte, come da regola, da **una sessione di plan dedicata**: qui c'è il cosa e il
perché, non il come.

## Decisioni del maintainer del 25-10-2026 (programma funzioni, gruppo 9)

- **P3 report** — **FATTO il 26-10-2026** (piano [`2026-10-26-report-programmati.md`](2026-10-26-report-programmati.md)): PDF ed Excel, con le tabelle dello storico (per ogni tag scelto min/max/media e i campioni o le
  aggregazioni del periodo, più gli allarmi), per turno/giorno/mese, salvati nel progetto e inviati per email con
  l'SMTP delle notifiche.
- **P4 SMS e voce** — **FATTO il 26-10-2026** (piano [`2026-10-26-sms-voce-reperibilita.md`](../archive/2026-10-26-sms-voce-reperibilita.md)): da un **servizio esterno via API** (niente modem sul pannello) — **Twilio**, SMS e chiamata con
  sintesi vocale; **turni di reperibilità** con escalation al successivo; la **conferma dal telefono** solo per i
  pannelli collegati al cloud (il fornitore deve richiamare un indirizzo pubblico).
- **P2 template d'oggetto**: i faceplate sono già i template (parametri, istanze che seguono la definizione, web e
  LVGL); manca **«Crea faceplate dalla selezione»**, ed è quello che si fa. **FATTO il 25-10-2026**
  (`editor/faceplateDaSelezione.ts`, pulsante nel pannello della selezione multipla, manuale 04).

## I due binari

**P — prima fascia SCADA**

| | Voce | Costo | Note |
|---|---|---|---|
| P1 | Finestre popup generiche e parametriche (una pagina aperta come finestra, con parametri) | S–M | Il faceplate ha già il meccanismo del popup: si generalizza |
| P2 | Template d'oggetto con istanze che seguono le modifiche **[plan]** | M | Prima si misura quanto fanno già faceplate e tipi struttura |
| P3 | Report programmati (turno/giorno/mese) in PDF ed Excel, salvati o inviati per email **[plan]** | M | Riusa storico ed esportazione esistenti e l'SMTP delle notifiche |
| P4 | Notifiche SMS e voce, turni di reperibilità, conferma dal telefono **[plan]** | M | Estende `notifications.rs` (SMTP, Telegram, escalation già presenti) |
| P5 | Prestazioni misurate e pubblicate: tag per runtime, aggiornamenti al secondo, client contemporanei, su TC620 e x86 | S–M | Un banco di prova ripetibile, i numeri nel manuale |
| P6 | Identità: 2FA (TOTP) e LDAP/Active Directory **[plan]** | M | La colonna `totp_segreto` c'è già; LDAP oggi è dichiarato fuori ambito |

**C — CRA, i punti scoperti al 12-10-2026**

| | Voce | Priorità CRA | Costo | Note |
|---|---|---|---|---|
| C1 | Contatti di sicurezza veri (`SECURITY.md`, `security.txt`), periodo di supporto, pagina avvisi | P0 | S | Servono dati che ha solo il maintainer |
| C2 | Procedura art. 14 (24 h / 72 h / 14 gg): referente, registro, piattaforma ENISA | P0 | S | Documento + registrazione, non codice |
| C3 | Sicuri per default, i piccoli: OPC UA `trust_all_certs` → `false` con fiducia esplicita; `/metrics` solo autenticato o su loopback; sandbox Python **obbligatoria** (senza RestrictedPython gli script non partono) | P1 | S | Tre correzioni circoscritte, un ramo |
| C4 | TLS acceso di default sul pannello, con installer, «Connetti» e pinning **[plan]** | P1 | M–L | Misurato il 23-10-2026 → [`2026-10-23-c4-tls-di-default.md`](../archive/2026-10-23-c4-tls-di-default.md). **Pezzo 1 fatto** (lo schema non è più cablato, e il controllo di salute non manda più il pannello in ciclo di riavvio); pezzi 2 e 3 aspettano cinque risposte |
| C5 | Reset di fabbrica dei dati (progetti, storico, utenti, segreti, certificati) | P1 | M | |
| C6 | Header HTTP di sicurezza (CSP, frame-ancestors, HSTS), limiti di richieste e di dimensione sulle scritture | P2 | S–M | I limiti si tarano sui numeri di P5 |
| C7 | Firma delle immagini (cosign) e verifica sul pannello; SBOM per release; scansione dell'immagine in CI con gate (Trivy) **[plan]** | P2 | M | |
| C8 | Valutazione del rischio, fascicolo tecnico (Allegato VII), capitolo «Sicurezza» del manuale | P2 | M | Si scrive man mano: ogni onda aggiunge le sue righe |

## Le onde

| Onda | P | C | Perché insieme |
|---|---|---|---|
| **1** | **P1** popup generici | ✅ **C1 + C2** (`ec630d24`, 15-10-2026) e **C3** (un ramo) | Tutto piccolo e senza dipendenze: si parte chiudendo il P0 CRA, che è già legge, e con la mancanza HMI più visibile |
| **2** | **P5** prestazioni misurate | **C6** header e limiti | I limiti di richieste si decidono sui numeri misurati, non a occhio; lo stesso banco di prova misura anche l'effetto dei limiti |
| **3** | **P6** 2FA e LDAP **[plan]** | **C4** TLS di default **[plan]** | Toccano gli stessi punti (login, primo accesso, «Connetti», certificati): una sola sessione di plan per le due, poi rami annidati |
| **4** | **P3** report **[plan]** + **P4** notifiche **[plan]** | **C5** reset di fabbrica | Report e notifiche condividono invio, destinatari e pianificazione; il reset deve sapere cosa cancellare dei nuovi archivi (report salvati, destinatari) |
| **5** | **P2** template d'oggetto **[plan]** | **C7** firma, SBOM, scansione **[plan]** | Indipendenti: P2 è il pezzo più delicato del prodotto e merita un'onda tranquilla sul lato CRA, che è quasi tutto CI |
| sempre | — | **C8** | Ogni onda aggiunge al fascicolo e al capitolo «Sicurezza» quello che ha cambiato |

L'ordine è una proposta. Due vincoli reggono qualunque riordino: **C1–C2 per primi** (l'art. 14 si applica già) e
**C6 dopo P5** (i limiti si tarano sulle misure).

## Decisioni che servono al maintainer, e quando

| Quando | Decisione |
|---|---|
| Onda 1 | **C1**: indirizzo di sicurezza, chiave PGP sì o no, chi è il referente art. 14, dove si pubblicano gli avvisi (GitHub Security Advisories?) |
| Onda 1 | **P1**: popup modale, non modale o entrambi; più popup aperti insieme; comportamento sul pannello LVGL |
| Onda 3 | **P6**: LDAP solo per l'IDE o anche per i pannelli; 2FA obbligatoria per gli Admin? **C4**: come arriva la fiducia nel certificato del pannello (pinning all'abbinamento?) |
| Onda 4 | **P4**: canale per SMS e voce: un servizio esterno via HTTP (Twilio o simili) oppure un modem GSM sul pannello. **P3**: chi genera il PDF (runtime sul pannello o servizio nel cloud) |
| Onda 5 | **C7**: dove vive la chiave di firma e chi firma le release |

## Cosa si ottiene alla fine

- **Prodotto**: le sei voci che oggi fanno scartare SWS a un integratore sono coperte, e la scheda tecnica ha numeri
  veri.
- **CRA**: P0 chiuso dalla prima onda; P1 chiuso dalla quarta (TLS, OPC UA, `/metrics`, sandbox, reset); P2 avviato
  (firma, SBOM, scansione, header, limiti) con fascicolo e manuale scritti durante il lavoro, non dopo.

## Verifica (per ogni ramo)

La definition of done di sempre: `cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi, la conferma del
maintainer. Per le voci CRA, in più, una **guardia** nuova dove si può (come `check_rotte_preauth.sh`), così il
default sicuro non torna indietro in silenzio. Per P1, P4 e C4 il collaudo sul TC620.

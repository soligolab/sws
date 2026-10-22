# Procedura di segnalazione — CRA, articolo 14

> 15-10-2026, piano [`2026-10-15-piano-prima-fascia-e-cra.md`](../plans/2026-10-15-piano-prima-fascia-e-cra.md),
> onda 1 (C2). Documento interno: dice **chi fa cosa e quando** se una vulnerabilità di SWS è sfruttata davvero o
> se c'è un incidente grave. Gli obblighi dell'art. 14 si applicano dall'**11 settembre 2026**.
> Questo testo è un'organizzazione del lavoro, non un parere legale: le scadenze vanno ricontrollate sul testo del
> regolamento (UE) 2024/2847 alla prima applicazione reale.

## Chi

| Ruolo | Chi |
|---|---|
| Fabbricante | **Soligonet** (decisione del 05-10-2026, [gap analysis CRA](../archive/2026-10-05-cra-gap-analysis.md) §7) |
| Referente per le segnalazioni | **il maintainer**, per Soligonet |
| Contatto pubblico | `security@soligo.net`, segnalazione privata GitHub, `/.well-known/security.txt` |
| Destinatari | il **CSIRT coordinatore** dello Stato del fabbricante (per l'Italia **CSIRT Italia**, ACN) ed **ENISA**, attraverso la **piattaforma unica di segnalazione** |

## Quando scatta

1. **Vulnerabilità attivamente sfruttata** in SWS: c'è evidenza che qualcuno la usa davvero contro un impianto.
2. **Incidente grave** che incide sulla sicurezza di SWS: compromissione del repository, della CI, del registry delle
   immagini (ghcr.io), della chiave di firma, del gateway cloud o del tunnel.

Una vulnerabilità segnalata ma **non** sfruttata segue la gestione normale (`SECURITY.md`): non è un caso art. 14.

## Scadenze

| Entro | Vulnerabilità sfruttata | Incidente grave |
|---|---|---|
| **24 ore** dalla conoscenza | preallarme: cosa, quali prodotti, Stati membri coinvolti se noti | preallarme, e se l'incidente sembra causato da un atto illecito o malevolo |
| **72 ore** | notifica: natura dello sfruttamento, misure correttive o di mitigazione, sensibilità delle informazioni | notifica: natura dell'incidente, valutazione iniziale, misure |
| **14 giorni** dopo che la correzione è disponibile | relazione finale: descrizione, gravità e impatto, chi la sfrutta se noto, aggiornamento che la corregge | — |
| **1 mese** dalla notifica | — | relazione finale |

Il fabbricante informa anche **gli utenti** colpiti (ed eventualmente il pubblico) sulla vulnerabilità o
sull'incidente e sulle misure da prendere: per SWS, avviso GitHub e, se serve, messaggio nell'IDE e sui pannelli.

## Passi

1. **Registrare il caso** nel registro sotto, con l'ora in cui se ne è avuta conoscenza: da lì partono le 24 ore.
2. **Preallarme** sulla piattaforma unica (anche incompleto: meglio in tempo che preciso).
3. **Contenere**: se serve, sospendere il canale degli aggiornamenti (`rc-arm64`/`latest-arm64`), ruotare token e
   chiavi, fermare il gateway.
4. **Correggere** e pubblicare l'aggiornamento; avviso GitHub Security Advisory.
5. **Notifica a 72 ore** e **relazione finale** nei termini.
6. **Chiudere il caso** nel registro con un riassunto e le lezioni.

## Da fare una volta sola

- [x] creare l'alias `security@soligo.net` e verificarne la consegna (fatto, verificato dal maintainer il 15-10-2026);
- [x] attivare «Private vulnerability reporting» nel repository GitHub (fatto dal maintainer il 15-10-2026, da
      Settings → Advanced Security);
- [ ] **rimandato**: registrare Soligonet sulla piattaforma unica di segnalazione ENISA. Decisione del maintainer
      del 15-10-2026: si fa quando il prodotto verrà **immesso sul mercato** e ci sarà l'attività che lo vende; prima
      di allora non serve. Quel giorno, annotare qui **dove** stanno le credenziali, non le credenziali;
- [ ] **rimandato con la registrazione**: verificare chi è il CSIRT coordinatore competente e i suoi contatti, e
      annotarli qui.

## Registro dei casi

| # | Conosciuto il (ora) | Tipo | Prodotti e versioni | Preallarme | Notifica | Relazione finale | Stato |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | nessun caso |

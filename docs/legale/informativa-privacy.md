# Informativa sul trattamento dei dati personali — servizio SWS in cloud

Versione del [DATA]

Questa informativa spiega come trattiamo i dati personali di chi si registra e usa il servizio SWS all'indirizzo
**sws.soligo.net**, ai sensi dell'art. 13 del Regolamento (UE) 2016/679 («**GDPR**»). Il servizio è in fase di sviluppo
ed è offerto gratis a scopo di test (vedi le condizioni d'uso): questo non cambia i tuoi diritti sui dati.

## 1. Titolare del trattamento

**Mauro Soligo**, [RECAPITO POSTALE], che pubblica SWS con il nome «**Soligonet**» («Soligonet», «noi»).
Contatto per la privacy e per esercitare i diritti: **privacy@soligo.net**.

Non abbiamo nominato un Responsabile della protezione dei dati (RPD/DPO), perché la nostra attività non rientra nei
casi in cui è obbligatorio (art. 37 GDPR).

## 2. Quali dati trattiamo

**Dati dell'account**

- l'indirizzo **e-mail**, che è anche il nome con cui si accede;
- la **password**, che non conserviamo mai in chiaro ma solo come impronta (algoritmo Argon2);
- lo **spazio di lavoro personale** creato alla conferma (il suo nome è il tuo indirizzo e-mail) e il ruolo che vi hai;
- la data di registrazione e dell'ultimo accesso; la versione delle condizioni d'uso che hai accettato e quando; la
  data dell'eventuale avviso di inattività e della chiusura dell'account.

**Dati di accesso e sicurezza**

- i **codici di verifica** e i **PIN** inviati via e-mail: restano solo in memoria e valgono 10 minuti;
- le **sessioni**: un gettone casuale, la sua scadenza (8 ore, o 30 giorni con «ricordami») e il momento dell'ultimo uso;
- il **registro delle attività** (chi ha fatto cosa e quando: registrazione, accessi riusciti e falliti, creazione e
  cancellazione di progetti, operazioni di amministrazione): serve a ricostruire gli eventi e a dimostrare chi ha fatto
  cosa;
- i **registri tecnici** del server: data e ora, indirizzo richiesto, esito e indirizzo IP da cui arriva la richiesta;
  nelle righe di registrazione e di accesso compare anche l'indirizzo e-mail. Servono al funzionamento e alla
  sicurezza.

**Dati nei progetti**

I progetti possono contenere dati personali messi dall'utente (destinatari di e-mail, numeri dei reperibili,
identificativi Telegram, utenti dei pannelli). Per questi dati **il titolare è l'utente** e noi li trattiamo per suo
conto, come responsabili: le regole sono al punto 7 delle condizioni d'uso. Questa informativa non li riguarda, se non
per dire dove sono conservati (punto 6).

Non raccogliamo dati da altre fonti, e non chiediamo categorie particolari di dati (art. 9 GDPR).

## 3. Perché li trattiamo, e su quale base

| Finalità | Base giuridica |
|---|---|
| Creare e gestire l'account, farti accedere, erogare il servizio | esecuzione del contratto (art. 6.1.b) |
| Mandarti codici di verifica, PIN e comunicazioni sul servizio (manutenzioni, modifiche delle condizioni, avviso di inattività) | esecuzione del contratto (art. 6.1.b) |
| Ricevere e gestire le tue segnalazioni di difetti, e risponderti | esecuzione del contratto (art. 6.1.b) |
| Proteggere il servizio: limitare i tentativi di accesso, ricostruire gli eventi, prevenire abusi | legittimo interesse alla sicurezza del servizio e degli altri utenti (art. 6.1.f) |
| Rispettare obblighi di legge e richieste delle autorità | obbligo legale (art. 6.1.c) |

**Non** usiamo i dati per pubblicità, non li vendiamo, e non facciamo profilazione né decisioni automatizzate.

Fornire l'indirizzo e-mail e una password è necessario per registrarsi: senza, l'account non si può creare.

## 4. A chi li comunichiamo

I dati sono trattati da noi e da questi fornitori, che agiscono come **responsabili del trattamento** per nostro conto,
con un contratto che li vincola (art. 28 GDPR):

| Fornitore | Cosa fa | Dove |
|---|---|---|
| OVH SAS | ospita il server del servizio | Francia (UE) |
| Infomaniak Network SA | invia le e-mail del servizio (codici, PIN, comunicazioni) | Svizzera |

Non ci sono altri fornitori. Il nome del dominio è gestito da Cloudflare solo come servizio DNS: il traffico del
servizio **non** passa dai suoi server.

I dati possono essere comunicati alle autorità quando la legge lo impone.

**Servizi che attivi tu.** Se nei tuoi progetti configuri servizi di terzi — Twilio (SMS e chiamate), Telegram
(messaggi), il tuo server di posta (SMTP, per le notifiche del progetto), la traduzione automatica (MyMemory,
LibreTranslate o Google Cloud Translation), l'assistente IA (Anthropic o Moonshot/Kimi), i tuoi broker e server — il
servizio manda loro i dati che servono alla funzione che hai scelto. Alcuni richiedono le tue credenziali; la
traduzione con MyMemory o con l'istanza pubblica di LibreTranslate no, ma anche lì i testi da tradurre escono verso
quel fornitore. Il rapporto con quei fornitori è tuo, alle loro condizioni e con le loro informative.

All'assistente IA mandiamo, con la tua chiave e solo quando lo usi, le parti del progetto che servono alla richiesta:
escono verso il fornitore che hai scelto. Senza una tua chiave l'assistente non manda niente a nessuno.

Le risposte dei reperibili che Twilio ci richiama (il tasto premuto in una chiamata, l'SMS di conferma) passano dal
nostro server solo per essere inoltrate al tuo pannello: non le conserviamo, e le trattiamo per tuo conto (punto 7
delle condizioni).

## 5. Trasferimenti fuori dall'Unione europea

Per il servizio noi non trasferiamo dati fuori dall'UE, con un'eccezione: le e-mail passano da Infomaniak, in Svizzera,
paese per cui la Commissione europea ha adottato una **decisione di adeguatezza** (art. 45 GDPR).

I servizi che attivi tu possono comportare trasferimenti fuori dall'UE: per esempio Twilio, Google e Anthropic hanno
sede negli Stati Uniti (dove si applica l'EU-US Data Privacy Framework alle aziende certificate), Telegram negli
Emirati Arabi Uniti, Moonshot/Kimi in Cina (paesi senza decisione di adeguatezza). Valuta questo aspetto prima di
attivarli.

## 6. Per quanto tempo li conserviamo

| Dati | Per quanto |
|---|---|
| Account e progetti | finché l'account esiste. Se lo chiudi, l'account si disattiva subito e, con i progetti, si cancella 30 giorni dopo; entro quei 30 giorni puoi chiederci di riattivarlo |
| Registrazioni non confermate | 30 giorni dalla richiesta, poi l'indirizzo si cancella |
| Account inattivi | dopo **12 mesi** senza accessi ti mandiamo un avviso; se nei **30 giorni** successivi nessuno accede, account e progetti si cancellano |
| Codici di verifica e PIN | 10 minuti, solo in memoria |
| Sessioni | fino alla scadenza (8 ore dall'ultimo uso, o 30 giorni con «ricordami»), o fino all'uscita |
| Registro delle attività | 12 mesi: ogni giorno si tolgono le voci più vecchie |
| Registri tecnici del server | al massimo 12 mesi |
| Copie di sicurezza | una copia automatica al giorno dei dati degli account e dei progetti, sul server stesso, conservata 30 giorni. Un dato cancellato resta nelle copie al massimo 30 giorni, poi sparisce |

Possiamo conservare più a lungo solo quello che serve per obblighi di legge o per difendere un diritto in giudizio.

## 7. Come li proteggiamo

- tutte le connessioni sono cifrate (HTTPS/TLS), comprese quelle con i pannelli collegati;
- le password sono conservate solo come impronta Argon2;
- i tentativi di accesso sono limitati, e una richiesta di PIN non dice se l'indirizzo è registrato;
- ogni spazio di lavoro vede solo i propri progetti, e ogni progetto gira in un contenitore separato;
- il server è in un centro dati dell'Unione europea, con accesso amministrativo riservato.

## 8. I tuoi diritti

Puoi chiedere in ogni momento di **accedere** ai tuoi dati, di **correggerli**, di **cancellarli**, di **limitarne** il
trattamento, di **riceverli** in un formato leggibile (portabilità), e di **opporti** ai trattamenti basati sul
legittimo interesse (artt. 15-22 GDPR). Scrivi a **privacy@soligo.net**: rispondiamo entro un mese.

Se ritieni che il trattamento violi la legge, puoi presentare un **reclamo al Garante per la protezione dei dati
personali** (www.garanteprivacy.it) o all'autorità del paese dell'UE in cui vivi o lavori.

## 9. Cookie e archiviazione nel browser

Il servizio **non usa cookie di profilazione né strumenti di statistica** di terzi. Nel tuo browser conserva solo
quello che serve a farlo funzionare:

- il gettone della sessione, con il tuo indirizzo e-mail e il ruolo, per restare collegato;
- le preferenze dell'interfaccia (tema, lingua, disposizione dei riquadri) e, se colleghi un pannello dall'IDE, il suo
  indirizzo e il nome utente con cui vi accedi — mai la password;
- un identificativo casuale della scheda aperta, che sparisce chiudendola, e una copia della pagina dell'app per
  aprirla più in fretta.

Quando apri lo **schermo di un pannello** dal servizio, usa anche un cookie tecnico (`sws_schermo`), valido solo per lo
schermo di quel pannello e al massimo per 8 ore, non leggibile dagli script della pagina, che ti riconosce mentre lo
guardi.

Sono strumenti tecnici necessari, per cui non serve il consenso.

## 10. Modifiche a questa informativa

Se questa informativa cambia, lo diciamo nel servizio e, se il cambiamento è importante, via e-mail. La data
dell'ultimo aggiornamento è in testa.

# Condizioni d'uso e informativa privacy — note per chi rivede

Due bozze, scritte il 29-10-2026 come base di partenza per l'apertura di **sws.soligo.net** a utenti esterni (ramo C
del piano [`aprire-sws-soligo-net`](../archive/2026-10-26-aprire-sws-soligo-net.md), punto 6). Il 10-11-2026 sono state
confrontate riga per riga con il codice e corrette. **Non sono state riviste da un legale**: vanno fatte vedere a una
persona competente prima di pubblicarle.

- [`condizioni-d-uso.md`](condizioni-d-uso.md)
- [`informativa-privacy.md`](informativa-privacy.md)

**I due file sono il testo che vede l'utente.** Il server li serve così come sono, in testo semplice, da `/condizioni`
e `/privacy` (`sws-web/src/registrazione.rs`, `include_str!`). Per questo non contengono più note per chi rivede:
tutte le note stanno qui.

La prima versione delle condizioni («prova gratuita» con preavviso di 30 giorni per ogni modifica) è nella storia di
Git. Fa fede l'italiano; l'inglese si prepara dopo la revisione.

## Il servizio, in breve

SWS è un software HMI/SCADA. Sul cloud c'è l'ambiente di progettazione: l'utente disegna pagine, configura variabili,
allarmi e notifiche, e può collegare i propri pannelli (runtime SWS installato sul dispositivo) con un tunnel cifrato
che parte dal pannello. Ogni utente che si registra riceve uno spazio di lavoro personale con un massimo di tre
progetti; oggi non c'è una quota di spazio su disco. Il server è un VPS OVH; la posta parte da Infomaniak (Svizzera).

Nessuno strumento di statistica. Un solo cookie tecnico (`sws_schermo`, solo per lo schermo di un pannello aperto dal
cloud). Nel browser: in `localStorage` il gettone di sessione con e-mail e ruolo, le preferenze, l'indirizzo e il nome
utente dei pannelli collegati (mai password); in `sessionStorage` un identificativo della scheda per la chat IA; la
cache del service worker con la pagina dell'app.

## Le scelte del maintainer

**29-10-2026**

1. **Solo imprese e professionisti** (B2B): il Codice del Consumo non si applica, e per questo c'è la dichiarazione al
   punto 3 delle condizioni.
2. **Strumento in fase di sviluppo, offerto gratis a scopo di sviluppo e test**, a chi vuole contribuire a trovarne i
   difetti; nessuna responsabilità sul suo uso e sul suo funzionamento finché la fase di sviluppo non si chiude, nei
   limiti di legge.
3. **Assistente IA solo con la chiave dell'utente**: la piattaforma non manda progetti a un fornitore di IA a proprio
   nome. Anthropic e Moonshot/Kimi compaiono quindi solo fra i servizi che l'utente attiva.
4. **Account inattivi**: avviso dopo 12 mesi senza accessi, cancellazione 30 giorni dopo.
5. **Legge italiana.**
6. **Italiano e inglese**, due pagine pubbliche (`/condizioni`, `/privacy`) raggiungibili senza login; fa fede
   l'italiano. L'inglese si traduce dopo la revisione, per non rivedere due testi.

**10-11-2026**

7. **Il titolare è una persona fisica**: **Mauro Soligo**, che pubblica SWS con il nome «Soligonet». Per ora SWS è il
   progetto di un privato in cerca di sponsor, non di una società. Quindi niente ragione sociale né partita IVA; resta
   da compilare solo **[RECAPITO POSTALE]**. Il GDPR si applica lo stesso: chi offre un servizio al pubblico è titolare
   del trattamento anche se è un privato.
8. **Un solo contatto**: `privacy@soligo.net`, anche per i contatti generali. Per le vulnerabilità vale
   `security@soligo.net`, che il codice pubblica già in `/.well-known/security.txt` e in `SECURITY.md`.
9. **Foro del domicilio del titolare**; nelle condizioni si parla di «nomi» SWS e Soligonet, non di «marchi».
10. **Copie di sicurezza**: una copia automatica al giorno dei dati degli account e dei progetti, sul server stesso,
    conservata 30 giorni (in preparazione sul VPS il 10-11-2026).
11. **Kimi resta**, con l'avviso del trasferimento in Cina; **Telegram** aggiunto fra i trasferimenti.
12. **Registri tecnici**: «al massimo 12 mesi».
13. **Modifiche delle condizioni** (punto 13): valgono dalla data indicata in testa; chi non le accetta può chiudere
    l'account. Non serve una nuova accettazione al primo accesso, che il codice non fa.
14. **La licenza del software va cambiata** (oggi AGPL-3.0): decisione a parte, presa il 10-11-2026 (punto 15).

**10-11-2026, la licenza**

15. **Doppia licenza dalla 2.26.0**: AGPL-3.0-only **oppure** licenza commerciale su contratto (modello MySQL/Qt).
    SWS resta open source secondo l'OSI; chi non vuole gli obblighi dell'AGPL firma la commerciale. Le versioni fino
    alla 2.25.2 restano AGPL-3.0. Titolare unico Mauro Soligo («Soligonet»); contributi esterni con DCO **e** CLA.
    Il ragionamento è nel seme archiviato
    [`2026-10-29-licenza-del-software.md`](../archive/2026-10-29-licenza-del-software.md). Il **punto 10** delle
    condizioni (non 11, come diceva il seme) ora ha il testo vero: le due licenze, dove sta il sorgente, e che il
    servizio lo offre il titolare, che non è licenziatario di sé stesso.
16. **Le richieste di licenza commerciale vanno a `privacy@soligo.net`**, come scritto in `LICENSING.md`, finché non
    esiste una casella dedicata (per esempio `licenze@soligo.net`). Quando nasce, si cambia in `LICENSING.md` e nel
    `CLA.md` (che ci manda le firme inviate per e-mail).

## Cosa è cambiato il 10-11-2026

Confronto con il codice, correzioni applicate:

- tolti i riquadri editoriali in testa ai due testi (finivano davanti all'utente);
- titolare persona fisica, contatto unico, foro del domicilio, «nomi» al posto di «marchi»;
- informativa §2: lo spazio di lavoro si chiama come l'e-mail (l'utente non dà un nome); le date salvate sono quelle
  vere (anche versione delle condizioni accettate, avviso di inattività, chiusura); il registro delle attività
  contiene anche registrazioni e accessi; i registri tecnici contengono l'IP e, nelle righe di accesso, l'e-mail;
- il rimando alle clausole art. 28 ora punta al **punto 7** delle condizioni (prima diceva 8);
- chiusura dell'account: disattivazione subito, cancellazione 30 giorni dopo, riattivabile entro i 30 giorni;
- registrazioni non confermate: cancellate dopo 30 giorni (riga nuova);
- conservazione: registro attività 12 mesi, registri tecnici al massimo 12 mesi, copie giornaliere per 30 giorni;
- servizi che l'utente attiva: aggiunti il suo server SMTP e la traduzione senza chiave (MyMemory, LibreTranslate
  pubblico); le risposte dei reperibili Twilio passano dal nostro server senza essere conservate;
- trasferimenti: aggiunto Telegram;
- cookie e browser: elenco completo di quello che resta nel browser;
- quota: solo i 3 progetti, perché la quota di spazio oggi non è impostata;
- condizioni: oggetto, durata, natura e interessati del trattamento per conto dell'utente (art. 28); preavviso di 15
  giorni sui sub-responsabili; azzerare un progetto vale come istruzione dell'utente; licenza ampia sulle
  segnalazioni; frase sul rischio di chi lo usa su impianti in esercizio.

## Punti da verificare con chi rivede

In tutti i punti il testo è la forma migliore che riusciamo a dare noi. **La verifica legale resta necessaria.**

0. **L'esclusione di responsabilità** (punto 8 delle condizioni). Esclusione totale, salvo dolo e colpa grave (art.
   1229 c.c.). Regge fra professionisti (punto 3), non verso i consumatori. Va bene così? Serve altro, sulla gratuità
   o sulla natura di «programma di test»?
1. **Ruolo per i dati dentro i progetti.** L'utente è titolare e Soligonet responsabile (art. 28), con le clausole al
   **punto 7** delle condizioni invece di un accordo separato. Basta, o serve un DPA a parte?
2. **Approvazione specifica (artt. 1341-1342 c.c.).** Il punto 14 elenca le clausole; alla registrazione c'è una
   seconda casella, distinta da quella di accettazione, e il server rifiuta la registrazione senza tutte e due. Ora la
   casella nomina le clausole una per una (testo sotto). È sufficiente online?
3. **Le segnalazioni** (punto 6): licenza gratuita, non esclusiva, irrevocabile. È formulato bene?
4. **Azzerare progetti e account senza preavviso** (punto 4): il testo dice che l'utente, come titolare, ci istruisce
   a farlo. È compatibile con gli obblighi del responsabile del punto 7?
5. **Servizi che l'utente attiva** (punto 9 delle condizioni, 4 e 5 dell'informativa): le risposte dei reperibili
   passano dal nostro server e sono descritte come dati trattati per conto dell'utente. È corretto?
6. **Moonshot/Kimi in Cina**: resta, con l'avviso. Basta l'avviso? Verificare anche dove Moonshot tratta davvero i
   dati (il codice parla con `api.moonshot.ai`).
7. **Titolare privato.** Un privato che offre gratis un servizio è «professionista» ai sensi del Codice del Consumo?
   La dichiarazione B2B del punto 3 resta utile? Serve un DPO? (Pensiamo di no, art. 37.)

## Il testo della seconda casella (copiato in `it.json` ed `en.json` il 10-11-2026)

Chiave `accesso.approvoClausole` (la seconda casella; poi l'equivalente in `en.json`):

> Approvo in modo specifico, ai sensi degli artt. 1341 e 1342 c.c., le clausole 1 e 4 (servizio in sviluppo, senza
> garanzie, interrompibile e azzerabile), 6 (uso delle segnalazioni), 7 (nessuna garanzia di conservazione dei
> progetti), 8 (esclusione di responsabilità e manleva), 9 (servizi di terzi), 11 (fine della fase di sviluppo), 12
> (sospensione, chiusura e cancellazione), 13 (modifiche e foro esclusivo) delle condizioni d'uso.

## Da fare prima di pubblicare

| Cosa | Dove | Stato |
|---|---|---|
| [RECAPITO POSTALE] del titolare | condizioni §2, informativa §1 | da compilare |
| Casella `privacy@soligo.net` | ovunque | **da creare** |
| Casella `security@soligo.net` | condizioni §5 | da verificare che esista (il codice la pubblica già) |
| Datacenter OVH «Francia (UE)» | informativa §4 | **da confermare dalla console OVH**: nel repo non è scritto |
| Limite del journal a 12 mesi | informativa §6 | `deploy/vps/sistema/90-sws-journal.conf` **va applicato** sul VPS: oggi non lo è. I log di Traefik finiscono nello stesso journal |
| Copie giornaliere per 30 giorni | informativa §6 | **attive dal 10-11-2026** (`deploy/vps/backup-dati.sh`, timer alle 03:15 UTC, `deploy/vps/STATO.md`). Restano da decidere le copie manuali `backup-prima-di-*` sul VPS, che non hanno scadenza: toglierle o farle rientrare nei 30 giorni |
| [DATA] in testa ai due testi | tutti e due | la data di pubblicazione |
| `VERSIONE_CONDIZIONI` | `sws-identita/src/registrazione.rs` | oggi `"2026-10-29"`: va messa uguale alla [DATA], così l'account dice quale testo ha accettato |
| Testo della seconda casella | `it.json`, `en.json` | **fatto il 10-11-2026** |
| Licenza | condizioni §10 | **scritto il 10-11-2026** (doppia licenza, punto 15). Da far vedere a chi rivede insieme a `CLA.md`, che è una bozza |
| Revisione legale | tutti e due | da fare |
| Traduzione inglese | tutti e due | **dopo** la revisione |
| Accendere `--gateway-registrazione` | quadlet del gateway | solo dopo tutto il resto: senza il flag la registrazione è chiusa e `/condizioni`, `/privacy` rispondono 404 |

## Quello che il codice fa già (verificato il 10-11-2026)

Tutto scritto nel ramo C; resta da provare dal vivo sul VPS:

- registrazione con conferma dell'e-mail, accesso con PIN, «ricordami» per 30 giorni (`sws-web/src/registrazione.rs`,
  `sws-identita/src/registrazione.rs`);
- le due caselle alla registrazione, con data e versione delle condizioni salvate nell'account
  (`components/accesso/Registrazione.tsx`);
- l'ultimo accesso per utente, l'avviso a 12 mesi e la cancellazione dopo 30 giorni, solo per chi si è registrato da
  sé e solo se la posta d'installazione è configurata (`sws-identita/src/ciclo_di_vita.rs`, `sws-web/src/ciclo_account.rs`);
- la chiusura dell'account dalle impostazioni, con cancellazione dopo 30 giorni (`components/accesso/ChiudiAccount.tsx`);
- le registrazioni mai confermate cancellate dopo 30 giorni;
- le pagine pubbliche `/condizioni` e `/privacy`, dichiarate in `check_rotte_preauth.sh`;
- il registro delle attività potato a 12 mesi ogni giorno (`sws-audit`, `AuditLog::pota`).

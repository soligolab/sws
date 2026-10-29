# Condizioni d'uso e informativa privacy — note per chi rivede

Due bozze, scritte il 29-10-2026 come base di partenza per l'apertura di **sws.soligo.net** a utenti esterni (ramo C
del piano [`aprire-sws-soligo-net`](../plans/2026-10-26-aprire-sws-soligo-net.md), punto 6). **Non sono state riviste da
un legale**: vanno fatte vedere a una persona competente prima di pubblicarle.

- [`condizioni-d-uso.md`](condizioni-d-uso.md)
- [`informativa-privacy.md`](informativa-privacy.md)

## Il servizio, in breve

SWS è un software HMI/SCADA. Sul cloud c'è l'ambiente di progettazione: l'utente disegna pagine, configura variabili,
allarmi e notifiche, e può collegare i propri pannelli (runtime SWS installato sul dispositivo) con un tunnel cifrato
che parte dal pannello. Ogni utente che si registra riceve un'azienda personale con limiti (tre progetti, una quota di
spazio). Il server è un VPS OVH in Francia; la posta parte da Infomaniak (Svizzera). Nessuno strumento di statistica,
nessun cookie: il browser conserva in `localStorage` il gettone di sessione e alcune preferenze.

## Le scelte del maintainer (29-10-2026)

1. **Solo imprese e professionisti** (B2B): il Codice del Consumo non si applica, e per questo c'è la dichiarazione al
   punto 3 delle condizioni.
2. **Prova gratuita, «così com'è», senza livelli di servizio**, con preavviso di 30 giorni per modifiche e chiusura.
3. **Assistente IA solo con la chiave dell'utente**: la piattaforma non manda progetti a un fornitore di IA a proprio
   nome. Anthropic e Moonshot/Kimi compaiono quindi solo fra i servizi che l'utente attiva.
4. **Account inattivi**: avviso dopo 12 mesi senza accessi, cancellazione 30 giorni dopo.
5. **Titolare**: segnaposto da compilare ([RAGIONE SOCIALE], [SEDE], [P.IVA]).
6. **Contatto privacy**: `privacy@soligo.net`, casella **da creare**.
7. **Legge italiana, foro della sede del titolare.**
8. **Italiano e inglese**, due pagine pubbliche (`/condizioni`, `/privacy`) raggiungibili senza login; fa fede
   l'italiano. L'inglese si traduce dopo la revisione, per non rivedere due testi.
9. **La licenza del software va cambiata** (oggi AGPL-3.0): decisione a parte, seme
   [`2026-10-29-licenza-del-software.md`](../plans/2026-10-29-licenza-del-software.md). Il punto 11 delle condizioni è
   un segnaposto finché non si decide.

## Punti da verificare con chi rivede

1. **Ruolo per i dati dentro i progetti.** Abbiamo scritto che l'utente è titolare e Soligonet responsabile (art. 28),
   con le clausole minime al punto 8 delle condizioni invece di un accordo separato. Va bene così, o serve un DPA a
   parte?
2. **Approvazione specifica (artt. 1341-1342 c.c.).** Il punto 17 elenca le clausole da approvare: alla registrazione
   ci sarà una **seconda casella**, distinta da quella di accettazione. È sufficiente online, o serve altro?
3. **Tetto della responsabilità** (punto 12.3): l'importo è un segnaposto.
4. **Cessione d'uso dei contenuti** (punto 7): è abbastanza stretta, o troppo?
5. **Servizi che l'utente attiva** (punto 9 delle condizioni, punto 4 e 5 dell'informativa): Twilio e il gateway del
   cloud ricevono anche le risposte dei reperibili («premi 1», «OK»). È corretto descriverli solo come servizi
   dell'utente?
6. **Moonshot/Kimi in Cina**: basta l'avviso all'utente, o conviene togliere quel fornitore dal cloud aperto?

## Segnaposto e dati da raccogliere prima di pubblicare

| Dove | Cosa | Stato |
|---|---|---|
| tutti e due | [RAGIONE SOCIALE], [SEDE], [P.IVA], [EMAIL DI CONTATTO] | da compilare |
| condizioni §5 | [EMAIL SICUREZZA] per le segnalazioni di vulnerabilità | da decidere: la stessa di contatto, o `security@` (c'entra anche il CRA) |
| condizioni §4 | numero di progetti e quota di spazio | oggi 3 progetti; la quota è quella della console |
| condizioni §11 | licenza e marchi | dopo la decisione sulla licenza |
| condizioni §12.3 | tetto della responsabilità | da decidere |
| informativa §6 | conservazione del **registro delle attività** | oggi non ha rotazione: va decisa (proposta: 12 mesi) e poi realizzata |
| informativa §6 | conservazione dei **registri tecnici** | oggi il log di Traefik va nel journal del VPS senza un limite esplicito: va fissato (proposta: 30 giorni) |
| informativa §6 | **copie di sicurezza** del server | da verificare cosa si fa oggi sul VPS, e per quanto |
| informativa §1 | casella `privacy@soligo.net` | da creare |

## Quello che il codice deve fare perché i testi siano veri

I testi descrivono il servizio **dopo** il ramo C. Alcune cose ancora non ci sono, e vanno fatte prima di pubblicarli:

- registrazione con conferma dell'e-mail, accesso con PIN, «ricordami» per 30 giorni (ramo C, punti 1-3);
- le due caselle alla registrazione (accettazione, e approvazione specifica), con data e versione delle condizioni
  accettate salvate nell'account;
- la data dell'ultimo accesso per utente, l'avviso di inattività a 12 mesi e la cancellazione dopo 30 giorni;
- la chiusura dell'account dalle impostazioni, con cancellazione entro 30 giorni;
- le pagine pubbliche `/condizioni` e `/privacy`, dichiarate fra le rotte pre-auth (`check_rotte_preauth.sh`);
- la rotazione del registro delle attività e il limite del journal, coi tempi che si decidono sopra.

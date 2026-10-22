# Seme — un dispositivo che si crea utenti propri: chi vince al deploy successivo?

**Stato: seme — decisione.** Estratto il 22-10-2026 da
[identità, utenti e istanze](../archive/2026-09-18-identita-utenti-istanze.md), archiviato quel
giorno: delle sue tre domande, Q56 è stata costruita (`sws-identita`) e Q44 è diventata il piano
cloud e quattro piani archiviati. **Q54 è l'unica rimasta aperta**, e sta qui perché non resti
sepolta in 852 righe che descrivono un mondo che non c'è più.

**Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in Plan
mode, per sviscerarne tutti i dettagli.** Quello che segue è materiale, non un piano d'esecuzione.

## La domanda

Il `users.yaml` di un progetto **viaggia col deploy**: è lì apposta, protegge l'impianto e
l'elenco lo scrive chi disegna il sinottico. Ma se un domani il pannello sapesse creare account
da solo — un capoturno che aggiunge un operatore davanti alla macchina — quegli account vivrebbero
nello stesso file. **Al deploy successivo chi vince?** Il file che arriva dall'IDE li cancella, o
li tiene?

Le due risposte sbagliate si vedono subito: cancellarli vuol dire che un aggiornamento del
sinottico butta fuori chi lavora; tenerli tutti vuol dire che l'elenco dell'IDE non è più la
verità, e due copie dello stesso progetto divergono senza che nessuno lo sappia.

## Cosa c'è oggi, misurato il 22-10-2026

**Mezzo passo è fatto, e copre il caso stretto.** L'Admin che nasce dall'abbinamento del pannello
vive in `<config>/utenti_dispositivo.yaml`, **fuori dalla cartella del progetto**: un deploy non
se lo porta via. Lo gestisce `sws-web/src/router.rs` (cerca `utenti_dispositivo`), e risolve
«l'amministratore del pannello sopravvive all'aggiornamento».

**Quello che non c'è** è la marcatura dentro `users.yaml` — la decisione 21 del piano identità,
opzione 3 della scheda: un campo `origine: dispositivo` che distingua gli account nati sul
pannello da quelli arrivati col deploy, e un deploy che sostituisce i primi e non tocca i
secondi. **Nel codice non esiste nessun campo `origine`.** Resta elencato fra le cose da fare
anche in `2026-10-05-cloud-utenti-aziende-spazi.md`.

**E il caso non è ancora materialmente possibile**: sul pannello non esiste un componente
sinottico «gestione utenti», quindi nessun account nasce lì. È questo che rende la domanda
rimandabile senza rischio — ma anche quello che la farà diventare urgente il giorno in cui quel
componente si disegna.

## Le strade, come le aveva scritte la scheda

1. **Il deploy vince sempre.** Semplice, e il file resta una sola verità; chi nasce sul pannello
   sparisce al primo aggiornamento.
2. **Il dispositivo vince sui propri.** Nessuno viene buttato fuori, ma l'elenco dell'IDE smette
   di descrivere il pannello.
3. **La marcatura `origine`** — la decisione 21: ogni account dichiara da dove viene, e il deploy
   tocca solo i suoi. È la risposta che la scheda indicava, e non è stata costruita.

## Quello che la decisione dovrà toccare

- `sws-auth`: lo schema di `users.yaml` e `swap_store`, che dal 22-10-2026 sa già **tenere le
  sessioni degli utenti invariati** fra un deploy e l'altro (vedi
  [la sessione che non sopravvive a un deploy](../archive/2026-10-22-sessione-che-non-sopravvive-al-deploy.md)):
  quella funzione è il posto naturale dove un `origine` verrebbe letto.
- Il percorso del deploy in `sws-web/src/projects.rs`, e la spunta «Sostituisci anche gli utenti»
  che oggi decide in blocco.
- Il componente «gestione utenti» sul pannello, se e quando si farà: è lui che crea il problema,
  ed è anche l'occasione per risolverlo nello stesso giro.

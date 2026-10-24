# Il gateway non dice chi bussa

> **Seme.** Nato il 23-10-2026 misurando la stabilità del tunnel sul VPS, e scoperto perché la
> misura **non si poteva concludere** su uno dei due pannelli.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita
> per sviscerarne tutti i dettagli.** Quello che segue è la misura di oggi e il problema, non un
> disegno.

## Il problema, in una riga

Il gateway registra `tunnel aperto` e `tunnel chiuso`, e **nient'altro**. Un pannello spento e un
pannello che prova a rientrare e non ci riesce producono lo stesso log: nessuna riga.

## Cosa l'ha fatto vedere

Quattro giorni di journal, due pannelli. Il `wp630-ufficio` ha quattro buchi lunghi — 23h06m,
16h16m, 15h21m, 15h05m — tutti da metà pomeriggio al mattino dopo. Sembrano finestre di pannello
spento, e probabilmente lo sono: le sue interruzioni *brevi* hanno la stessa mediana (29 s) di
quelle del `tc620-garage`, quindi il meccanismo di riconnessione funziona.

**Ma «probabilmente» è esattamente ciò che una misura non dovrebbe produrre.** Per sette ore e
mezza il log è muto, e dal VPS non c'è modo di sapere se in quelle ore qualcuno stesse bussando.
Chiudere quel test ha richiesto di chiedere al maintainer se il pannello fosse alimentato — una
domanda che il sistema dovrebbe saper rispondere da sé.

## Cosa manca, e dove

Una riga di log quando un tentativo di tunnel **arriva e non va a buon fine**: pannello non
dichiarato in `pannelli.yaml`, token che non torna, azienda che non combacia, handshake interrotto.
Oggi `sws-web::tunnel::gateway` logga solo i due esiti felici.

Attenzione a due cose, che sono il motivo per cui serve una sessione e non una riga:

1. **Il rumore.** Un pannello che ritenta ogni pochi secondi per sette ore produrrebbe migliaia di
   righe — e il journal del VPS è già stato un problema una volta (le etichette delle Novità, 22-10).
   Serve un riassunto, o una riga per stato invece che per tentativo: è la stessa forma che
   `con_attesa` usa già nei plugin.
2. **I segreti.** Un tentativo fallito porta un token. Nel log non ci va, e `check_segreti.sh`
   esiste apposta.

## Quanto vale

Poco codice, ma rende **concludibile** una classe di prove che oggi si chiudono interpretando: la
stabilità del tunnel, l'abbinamento di un pannello nuovo, un cliente che dice «non si collega».

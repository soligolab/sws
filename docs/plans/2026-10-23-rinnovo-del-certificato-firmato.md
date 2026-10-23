# Rinnovo automatico del certificato, annunciato firmando con il vecchio

> **Seme.** Nato il 23-10-2026 da una decisione del maintainer: la decisione 6 del piano dei
> certificati («uno o due anni con avviso e rinnovo») è stata sciolta in **due anni con rinnovo
> automatico**, cioè l'opzione che evita il problema ma richiede un meccanismo che oggi non
> esiste.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita
> per sviscerarne tutti i dettagli.** Non è una formula: qui si disegna un **protocollo di
> fiducia**, e un protocollo disegnato mesi prima di scriverlo è un protocollo che mente. Quello
> che segue sono le misure di oggi e i punti duri, non un disegno.

## Il problema, in una riga

Il verificatore confronta **l'impronta SHA-256 del certificato foglia, e basta**
(`sws-core/src/pin_tls.rs`). Quindi **ogni rinnovo rompe il pinning di chiunque si fosse già
fidato**: con una scadenza di due anni, ogni due anni ogni IDE e ogni viewer LVGL del campo
mostra «certificato cambiato» e qualcuno deve premere «dimentica». La scelta del maintainer è che
quel giro non debba esistere: il pannello **annuncia** l'impronta nuova **firmandola con la
vecchia**, e chi si era fidato la accetta da solo.

## Le misure del 23-10-2026

**1. L'archivio non basta, ed è il punto duro.** `Voce` è
`{ impronta: String, visto_il_ms: u64 }` — `sha256:<hex>` e un timestamp. **Da un'impronta non si
verifica una firma**: servirebbe la chiave pubblica, o il certificato intero. Quindi il formato
dell'archivio cambia, e cambia per **tre** consumatori con tre file:
`dispositivi_conosciuti.yaml` (IDE → dispositivi), `mqtt_broker_conosciuti.yaml`,
`lvgl_tls_conosciuti.yaml` (viewer → runtime, in un altro container). Serve una migrazione che
non butti via la fiducia già data.

**2. La chiave vecchia va conservata, o l'annuncio va prodotto al momento del rinnovo.** Oggi il
rinnovo sovrascrive `tls.key`. Firmare «il nuovo con il vecchio» vuol dire o tenersi la chiave
precedente (un segreto in più sul disco, che è esattamente ciò che una rotazione dovrebbe
togliere) o **generare l'attestato nell'istante del rinnovo** e conservare solo quello. La
seconda è quasi certamente la strada giusta, e va verificata.

**3. Un client che resta spento salta più rinnovi.** Un viewer LVGL spento per cinque anni torna
con un'impronta vecchia di due generazioni: serve una **catena** di attestati, non uno solo, e
una regola su quanti se ne tengono.

**4. Cosa non deve succedere.** Un attaccante che intercetta un attestato non deve poterlo
riusare per far accettare un certificato suo; e la catena non deve diventare una strada per
**ri-fidarsi** di un pannello che è stato resettato di fabbrica — dove la chiave vecchia non
c'è più, ed è giusto che la fiducia si rompa. La differenza fra «rinnovo» e «reset» deve restare
visibile.

**5. Il generatore è già uno solo** (`sws_web::system::genera_certificato`, dal 23-10-2026), e
oggi non imposta nessuna scadenza: rcgen mette 1975 → 4096. La scadenza si aggiunge lì, **dopo**
che il rinnovo esiste — mettere due anni prima vuol dire un parco di pannelli che fra due anni
scade senza che niente li rinnovi.

## Dove si vede l'avviso — deciso il 23-10-2026

Tre posti, tutti e tre: **barra dell'IDE**, **allarme di sistema**, **email**. L'email usa
l'invio già configurato per la console ed è quella che arriva a chi l'IDE non lo apre da mesi,
che è esattamente il caso di un certificato con due anni di vita.

## Ordine

Questo lavoro viene **dopo** la prova sul TC620 (domanda 2 di
[`2026-10-23-c4-tls-di-default.md`](2026-10-23-c4-tls-di-default.md)): se il browser del pannello
non sa accettare un autofirmato, cambia il disegno di tutto il resto, scadenza compresa.

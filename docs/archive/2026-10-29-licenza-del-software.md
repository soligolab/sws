# Seme — la licenza del software

> **Seme, non piano d'esecuzione.** Quando questo lavoro comincia, il primo passo è una **sessione di plan
> approfondita** per sviscerarne tutti i dettagli. Una decisione scritta qui oggi, mesi prima del lavoro, rischierebbe
> di non descrivere più il codice.

## L'idea

Il 29-10-2026, rispondendo alle domande per le condizioni d'uso di sws.soligo.net, il maintainer ha detto che **la
licenza va cambiata**. Oggi SWS è pubblicato con **AGPL-3.0-only** (`LICENSE` in radice, `license` nel `Cargo.toml` del
workspace). L'AGPL obbliga chi offre il software come servizio in rete a offrire il codice sorgente a chi lo usa
(sezione 13): con l'apertura del cloud a utenti esterni, quell'obbligo diventa concreto.

## Cosa si è misurato (29-10-2026)

- Il codice è di **Soligonet** (memoria del progetto: autori «Soligo Lab», remote `github.com/soligolab/sws`); Pixsys
  è un cliente, non un titolare.
- Le condizioni d'uso in bozza (`docs/legale/condizioni-d-uso.md`, punto 11) hanno un **segnaposto** per la licenza.
- Il modello di prodotto deciso il 05-10-2026: l'IDE si offre come servizio cloud, il runtime si installa dal cliente,
  il self-host resta possibile (CRA: Soligonet fabbricante del runtime).

## Le domande per la sessione di plan

- Che licenza, per cosa: una sola, o una per il runtime e una per l'IDE?
- Chi altro ha scritto codice nel repository, e serve il suo consenso per cambiare la licenza?
- Le dipendenze di terze parti: le loro licenze sono compatibili con quella nuova (`cargo deny`, l'SBOM)?
- Le versioni già pubblicate restano AGPL: cosa vuol dire per chi le ha già?
- Cosa cambia nelle immagini su ghcr.io, nel README, nelle intestazioni dei file, e nelle condizioni d'uso.

## Deciso il 10-11-2026

La sessione di plan si è appoggiata su un brief preparato lo stesso giorno (tre letture del checkout: licenze delle
dipendenze, punti del repo che nominano la licenza, opzioni dalla più aperta alla meno aperta). Le risposte del
maintainer:

- **«Open» vuol dire open source secondo l'OSI**: SWS deve poter continuare a dirsi open source.
- **Cosa impedire a un terzo**: l'uso commerciale senza un accordo, e un cloud che faccia concorrenza a sws.soligo.net.
- **Le aziende firmano**: chi usa SWS per lavoro e non vuole gli obblighi della licenza libera, firma un contratto.
- **Da quando**: dalla **2.26.0**. Le versioni fino alla 2.25.2 restano AGPL-3.0, e lo si scrive e basta.
- **Titolare unico**: Mauro Soligo, persona fisica, che pubblica SWS con il nome «Soligonet» (niente società). Il nome
  «Soligo Lab» sparisce dove indicava il titolare.
- **Contributi esterni**: DCO **e** CLA.

**La scelta: doppia licenza, `AGPL-3.0-only OR LicenseRef-SWS-Commercial`** (modello MySQL/Qt). `LICENSE` resta il
testo AGPL; `LICENSING.md` spiega le due vie; `CLA.md` è una bozza di accordo individuale da far rivedere; il testo
commerciale non è pubblico, è un contratto su richiesta.

**Perché i limiti voluti arrivano solo come spinta, non come divieto.** Una licenza approvata dall'OSI non può vietare
l'uso commerciale né il servizio ospitato: la libertà di usare il programma per qualunque scopo è nella definizione
stessa di open source. L'AGPL-3.0 è già la licenza OSI con più obblighi: chi distribuisce SWS deve dare il sorgente, e
chi offre in rete una versione modificata deve darlo ai suoi utenti (sezione 13). Quindi un concorrente **può** offrire
SWS come servizio, e un'azienda **può** usarlo per lavoro senza firmare nulla, se accettano quegli obblighi. La doppia
licenza non li toglie: rende la licenza commerciale l'unica strada per chi non vuole pubblicare le proprie modifiche.
Il limite vero, «nessuno senza accordo», si ottiene solo uscendo dall'open source (Elastic, BSL, PolyForm); il
maintainer ha preferito restare open source.

Due correzioni al testo qui sopra, misurate il 10-11-2026: il segnaposto delle condizioni d'uso era al **punto 10**,
non 11; e il motivo vero del cambio non era la sezione 13 (il titolare non è licenziatario di sé stesso, e può offrire
il cloud con qualunque licenza), ma limitare cosa possono fare gli altri.

Restano fuori, in un seme a parte ([avvisi delle dipendenze](../plans/semi/2026-11-10-avvisi-delle-dipendenze.md)),
i lavori che valgono con qualunque licenza: il fascicolo degli avvisi delle dipendenze nell'immagine e nella SPA, il
testo OFL accanto ai font del browser, `cargo deny` con le licenze ammesse.

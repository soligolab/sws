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

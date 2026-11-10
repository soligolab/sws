# Licenze di SWS — SWS licensing

[Italiano](#italiano) · [English](#english)

---

## Italiano

SWS (Soligo Web SCADA) è di **Mauro Soligo**, che lo pubblica con il nome **«Soligonet»**.

**Dalla versione 2.26.0** SWS si può usare con una di due licenze. Sceglie chi lo usa:

1. **GNU Affero General Public License v3.0** (`AGPL-3.0-only`): gratis. Il testo completo è in [`LICENSE`](LICENSE).
2. **Licenza commerciale** (`LicenseRef-SWS-Commercial`): un contratto firmato con il titolare.

SWS resta **software open source**: l'AGPL-3.0 è una licenza approvata dall'OSI.

### Con l'AGPL: gratis, per tutti

Chiunque (persona, azienda, scuola, ente) può usare, copiare, modificare e ridistribuire SWS, anche per lavoro e anche
facendosi pagare, **senza chiedere nulla a nessuno**. In cambio deve rispettare queste regole:

- **se distribuisce SWS** (per esempio installato sui pannelli che vende, o come immagine da scaricare) deve dare a chi
  lo riceve il **codice sorgente completo**, comprese le sue modifiche, sotto la stessa licenza AGPL-3.0;
- **se offre in rete una versione modificata di SWS** (un servizio cloud, un portale che altri usano dal browser) deve
  offrire il **sorgente delle modifiche** agli utenti di quel servizio;
- deve lasciare gli avvisi di copyright e di licenza, e consegnare il testo dell'AGPL.

Chi usa SWS sui propri impianti, senza modificarlo e senza distribuirlo ad altri, non ha altri obblighi.

### Quando serve la licenza commerciale

Quando gli obblighi dell'AGPL non vanno bene. Per esempio, per:

- vendere pannelli o prodotti con una versione modificata di SWS **senza pubblicare le modifiche**;
- mettere SWS, o parti di SWS, dentro un prodotto che non è distribuito con l'AGPL;
- offrire una versione modificata di SWS come servizio in rete **senza dare il sorgente** a chi la usa;
- avere un contratto con condizioni proprie (garanzie, assistenza, responsabilità).

Il testo della licenza commerciale **non è pubblico**: è un contratto che si prepara su richiesta, caso per caso.
Per chiederla scrivere a **privacy@soligo.net** (oggetto «Licenza commerciale SWS»).

### Cosa non cambia

- **Le versioni fino alla 2.25.2 restano AGPL-3.0**, e chi le ha tiene per sempre i diritti di quella licenza.
- **I componenti di terze parti** inclusi in SWS restano sotto le loro licenze (vedi [`third-party/`](third-party/README.md)),
  anche nella copia con licenza commerciale: per esempio i file sotto MPL-2.0 restano MPL-2.0.
- **Il servizio cloud sws.soligo.net** lo offre il titolare: è regolato dalle condizioni d'uso del servizio, non da
  queste licenze. Allo stesso modo le **licenze di pannello** (quanti pannelli un'azienda collega al cloud) riguardano
  il servizio, non il codice.
- **I nomi «SWS» e «Soligonet»** sono di Mauro Soligo: le licenze riguardano il codice, non i nomi.

### Chi contribuisce

Per poter offrire anche la licenza commerciale, il titolare deve avere i diritti su tutto il codice. Per questo ogni
contributo esterno richiede il `Signed-off-by:` (DCO) **e** l'accordo di contribuzione [`CLA.md`](CLA.md). Dettagli in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## English

SWS (Soligo Web SCADA) is owned by **Mauro Soligo**, who publishes it under the name **"Soligonet"**.

**From version 2.26.0** SWS is available under one of two licenses, at the user's choice:

1. **GNU Affero General Public License v3.0** (`AGPL-3.0-only`): free of charge. The full text is in [`LICENSE`](LICENSE).
2. **Commercial license** (`LicenseRef-SWS-Commercial`): a contract signed with the copyright holder.

SWS remains **open source software**: AGPL-3.0 is an OSI-approved license.

### Under the AGPL: free, for everyone

Anyone (individual, company, school, public body) may use, copy, modify and redistribute SWS, including for work and
for a fee, **without asking anyone**. In return they must follow these rules:

- **if they distribute SWS** (for example installed on panels they sell, or as a downloadable image) they must give the
  recipients the **complete source code**, including their changes, under the same AGPL-3.0 license;
- **if they offer a modified version of SWS over a network** (a cloud service, a portal others use from a browser) they
  must offer the **source of their changes** to the users of that service;
- they must keep the copyright and license notices, and provide the AGPL text.

Using SWS on your own plants, without modifying it and without distributing it to others, carries no other obligation.

### When you need the commercial license

When the AGPL obligations do not suit you. For example, to:

- sell panels or products with a modified version of SWS **without publishing the changes**;
- put SWS, or parts of it, inside a product that is not distributed under the AGPL;
- offer a modified version of SWS as a network service **without giving the source** to its users;
- have a contract with its own terms (warranties, support, liability).

The commercial license text is **not public**: it is a contract prepared on request, case by case.
To ask for one, write to **privacy@soligo.net** (subject "SWS commercial license").

### What does not change

- **Versions up to 2.25.2 remain AGPL-3.0**, and whoever has them keeps the rights of that license forever.
- **Third-party components** included in SWS stay under their own licenses (see [`third-party/`](third-party/README.md)),
  also in a commercially licensed copy: for example, files under MPL-2.0 remain MPL-2.0.
- **The sws.soligo.net cloud service** is offered by the copyright holder: it is governed by the service's terms of use,
  not by these licenses. Likewise, **panel licenses** (how many panels a company connects to the cloud) are about the
  service, not the code.
- **The names "SWS" and "Soligonet"** belong to Mauro Soligo: the licenses cover the code, not the names.

### Contributors

To be able to offer the commercial license too, the copyright holder must hold the rights to all the code. This is why
every external contribution requires the `Signed-off-by:` trailer (DCO) **and** the contributor agreement
[`CLA.md`](CLA.md). Details in [`CONTRIBUTING.md`](CONTRIBUTING.md).

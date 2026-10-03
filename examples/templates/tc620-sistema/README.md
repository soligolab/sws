# Ruolo di questo template

**Esempio di tipo struttura su un prodotto reale.** Una sola variabile, `tc620`, di tipo `host`,
raccoglie tutto ciò che il protocollo Host legge da un Pixsys TC620; le pagine ne mostrano le
foglie, una tipologia per pagina:

| Pagina | Cosa mostra |
|---|---|
| Panoramica | CPU, RAM, temperatura CPU, disco progetti; trend CPU/RAM e temperature |
| CPU | CPU totale, istogramma dei 6 core, carico 1/5/15 min, trend dei core |
| Memoria | RAM e swap in %, MB usati/disponibili/totali, trend |
| Temperature | le quattro sonde (cpu, gpu, scheda 1 e 2), trend |
| Dischi | `/` e `/var/sws/projects`: usato %, libero GB, trend |
| Rete | `ethernet0` ed `ethernet1`: byte/s ricevuti e trasmessi, trend |

Su tutte le pagine la testata porta l'orologio (ora locale del pannello) in alto a sinistra,
modello, numero di serie, nome di rete e tempo di accensione, e il navigatore delle pagine.

## Il metro con cui giudicarlo

- La variabile è **una**: aggiungere un TC620 al progetto vuol dire un'istanza in più del tipo
  `host`, non trentuno variabili.
- Ogni foglia mappata deve essere Good su un TC620. Su un altro dispositivo i parametri
  (zone termiche, mount, interfacce) vanno riletti dal catalogo Host, e quelle che non
  esistono restano Bad — è il comportamento atteso, non un difetto del template.
- Solo widget che il motore LVGL disegna.

_Creato il 2026-10-03 su richiesta del maintainer._

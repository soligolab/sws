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

Su tutte le pagine la cornice (`cornici/testata.yaml`) porta in testata l'ora e la data del
pannello in alto a sinistra, modello, numero di serie, nome di rete, tempo di accensione e il
nome della pagina; nel piede il navigatore delle pagine.

I gruppi che si ripetono sono faceplate (`faceplates/`): `interfaccia` e `disco` prendono come
parametro un membro della struttura (`tc620.ethernet1`, `tc620.disco_progetti`), `carico` e
`valore` un tag. Un'interfaccia in più è un membro in più nel tipo `host`, le sue due
mappature nella sorgente e un'istanza in più del faceplate.

## Il metro con cui giudicarlo

- La variabile è **una**: aggiungere un TC620 al progetto vuol dire un'istanza in più del tipo
  `host`, non trentuno variabili.
- Ogni foglia mappata deve essere Good su un TC620. Su un altro dispositivo i parametri
  (zone termiche, mount, interfacce) vanno riletti dal catalogo Host, e quelle che non
  esistono restano Bad — è il comportamento atteso, non un difetto del template.
- Solo widget che il motore LVGL disegna.

_Creato il 2026-10-03 su richiesta del maintainer._

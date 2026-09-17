# Ruolo di questo template

**Banco di prova di un protocollo** — client OPC-UA: subscription a nodi di un simulatore
(node-opcua/Prosys). Punto di partenza da modificare (endpoint `opc.tcp://...`) per collegarsi
a un server vero.

## Il metro con cui giudicarlo

Il punto è **la sorgente dati**, non il disegno: pochi nodi rappresentativi, una pagina con
Trend + Gauge + LED + tabella valori per mostrarli. Pochi oggetti sono corretti così — non
vanno riempiti per farlo sembrare più ricco, sarebbe rumore che nasconde cosa il template vuole
davvero far vedere: come si sottoscrive un nodo OPC-UA e lo si mostra.

Non giudicarlo con il metro dell'inventario (copertura tipi) né con quello di
un'applicazione realistica (numero di pagine, scenari d'uso): un banco di prova di protocollo
che avesse bisogno di 5 pagine per dimostrare che il protocollo funziona sarebbe un banco di
prova mal riuscito, non uno più completo.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._

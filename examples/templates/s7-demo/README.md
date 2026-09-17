# Ruolo di questo template

**Banco di prova di un protocollo** — Siemens S7 (S7-1200/1500, o S7-300/400). Punto di
partenza da modificare (IP del PLC) per collegarsi a un impianto vero.

## Il metro con cui giudicarlo

Il punto è **la sorgente dati**, non il disegno: pochi tag rappresentativi da DB1 (REAL, BOOL,
INT), lettura e write-back, una pagina che li mostra. Poche pagine e pochi oggetti sono
corretti così — non vanno riempiti per farlo sembrare più ricco, sarebbe rumore che nasconde
cosa il template vuole davvero far vedere: come si legge e scrive un tag S7.

Non giudicarlo con il metro dell'inventario (copertura tipi) né con quello di
un'applicazione realistica (numero di pagine, scenari d'uso): un banco di prova di protocollo
che avesse bisogno di 5 pagine per dimostrare che il protocollo funziona sarebbe un banco di
prova mal riuscito, non uno più completo.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._

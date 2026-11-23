# Ruolo di questo template

**Banco di prova della sorgente `plx800_io`**: il modulo I/O di un Pixsys PLX800, che PixsysOS pubblica nella memoria
condivisa `/dev/shm/qmb800_registers`. Gli otto ingressi, i sei DIP, le otto uscite, il LED A1, la temperatura e le
tensioni della scheda diventano tag e si guardano su una pagina sola.

## Il metro con cui giudicarlo

Il punto è **la sorgente dati**: come un punto del modulo diventa un tag, e come lo si comanda. La sorgente ha
`writes: true`, quindi SWS prova a diventare l'**unico scrittore** del modulo: se un altro programma tiene il lock
(OpenPLC, le librerie di riferimento) resta in sola lettura; se qualcuno scrive senza lock (CODESYS, forse LogicLab),
SWS se ne accorge e non ne cancella i comandi. Quando la sorgente si ferma, le uscite e il PWM tornano spenti e il LED
RUN torna al sistema; il PoE non si tocca.

Fuori da un PLX800 il modulo non c'è e i punti restano Bad. Sul PC si prova col simulatore del progetto di riferimento
(`qmb800_sim.py --loopback`, che rimanda OUT0..7 su IN0..7).

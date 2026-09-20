# Ruolo di questo template

**Banco di prova della sorgente «host»**: le risorse del dispositivo (CPU, RAM, temperatura, disco,
carico, nome, numero di serie e modello della scheda) diventano tag e si guardano con indicatori e trend.

## Il metro con cui giudicarlo

Il punto è **la sorgente dati**: come si mappa una risorsa di sistema su un tag. La pagina è
volutamente minima. Da adattare: il nome della zona termica (`cpu-thermal` sul TC620; l'elenco vero
sta in Configurazione → Sorgenti → Host) e il mount del disco (`/var/sws/projects` nel container).

Il numero di serie e il modello si leggono dal device-tree della scheda (ARM); su x86 il seriale
viene dal DMI e il modello resta vuoto (tag di qualità Bad).

# Note di rilascio

Versione sintetica del `CHANGELOG.md`, pensata per essere letta in un paio di minuti: cosa cambia
per chi usa il prodotto, non i dettagli implementativi. Per l'elenco tecnico completo vedi
`CHANGELOG.md`.

## 2.0.1 — 2026-08-18

### Novità

- **Motore LVGL quasi completo**: la copertura widget passa da 16 a 31 tipi su 32 — mancano solo
  le immagini raster, per un vincolo tecnico della libreria grafica usata sui pannelli embedded.
- **Gestione database (Config → Datastore)**: ora si può scaricare e caricare il file dello
  storico, sia per il progetto su cui si sta lavorando sia — quando connessi — per il dispositivo
  remoto. Utile per archiviare i dati o spostarli tra macchine.
- **Backup più flessibili (Config → Backup)**:
  - l'intervallo di backup automatico si imposta ora per singolo progetto, non solo all'avvio del
    programma;
  - si può scaricare un backup specifico;
  - quando si è connessi a un dispositivo remoto, ora si possono creare, scaricare, ripristinare
    ed eliminare i suoi backup direttamente dall'editor, in una sezione dedicata e separata da
    quella del progetto locale.
- **Anteprima live dei Faceplate**: modificando un faceplate se ne vede subito il risultato,
  senza dover salvare.
- **"Cerca runtime" mostra il nome del dispositivo**, non solo l'indirizzo IP — più facile
  riconoscere quale pannello è quale.
- **Scelta guidata dell'immagine container** durante l'installazione su dispositivo aarch64
  (versione generica o ottimizzata per l'hardware Pixsys).

### Corretto

- **Grafico storico (trend)**: il pulsante "Tutto" a volte mostrava meno dati del pulsante "24h"
  — ora mostra sempre l'intero storico disponibile. Aggiunta anche la data sul grafico quando il
  periodo visualizzato supera un giorno.
- **Connessione MQTT che si interrompeva dopo pochi minuti** in alcune configurazioni.
- **Notifiche di allarme** (email/Telegram): valori e orari erano a volte illeggibili — ora sempre
  in formato leggibile.
- **Storico allarmi mancante** sui dispositivi che aprono il progetto da soli all'avvio.
- **Pulsante "Deploy" e stato di connessione** in Configurazione → Runtime potevano disallinearsi
  in diverse situazioni — sistemato.
- **Log del dispositivo remoto**: il pannello dedicato non funzionava; i log remoti sono ora
  integrati nel visualizzatore log già esistente.
- **Scoperta dei dispositivi in rete (mDNS)** poteva mostrare indirizzi di rete interni non
  raggiungibili invece di quello reale.
- Corretti alcuni difetti minori sui widget grafici (barra allarmi compatta, tubazioni, colori).

### Cambiato

- **Barra/campanella allarmi non più fisse**: ora compaiono solo se piazzate esplicitamente in
  pagina come oggetti — più flessibile, ma i progetti/template esistenti potrebbero aver bisogno
  di aggiungerle a mano dove servono ancora.

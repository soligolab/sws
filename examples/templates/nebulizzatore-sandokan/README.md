# Ruolo di questo template

**Applicazione realistica**, scala piccola: una singola presa smart Zigbee2MQTT che alimenta
un nebulizzatore antizanzare, letta via MQTT (json_path multipli sullo stesso topic), con
storico SQLite, tre trend separati e due allarmi pronti per Telegram.

## Come è fatta la pagina

- **Una cornice** (`cornici/cornice.yaml`, regola R6): in testata il nome della pagina, tradotto,
  con la data e l'ora. Una pagina sola, quindi niente piede di navigazione.
- **Tre riquadri in alto**: il serbatoio e la pompa, col tubo animato quando la pompa lavora, e
  lo stato della presa; le letture della presa (potenza, corrente, tensione, energia, segnale
  Zigbee); la potenza a lancetta.
- **Tre trend dell'ultima ora**: sono tre istanze del faceplate `faceplates/trend_ora.yaml`
  (regola R8), con il titolo, la variabile e il colore della linea come parametri.
- **In fondo gli allarmi**: la campanella, con lo storico e la sospensione, e la striscia
  dell'allarme attivo.

La pagina non ha comandi: la presa si legge soltanto. La sorgente MQTT sa anche scriverne lo stato
(`publish_topic`), per chi vuole aggiungere un bottone.

## Il metro con cui giudicarlo

Deve somigliare a un caso reale piccolo e completo: una pagina sola è corretta, perché
l'impianto vero è un dispositivo solo — il punto è mostrare il giro intero (lettura → storico →
allarme → notifica) su un caso minimo, non riempire pagine.

Non giudicarlo con il metro dell'inventario (non deve coprire ogni tipo di oggetto) né con
quello di un banco di prova di protocollo puro: qui MQTT è il mezzo, non il soggetto — il
soggetto è il dispositivo e il suo ciclo acceso/spento.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._

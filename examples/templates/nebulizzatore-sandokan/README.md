# Ruolo di questo template

**Applicazione realistica**, scala piccola: una singola presa smart Zigbee2MQTT che alimenta
un nebulizzatore antizanzare, letta via MQTT (json_path multipli sullo stesso topic), con
storico SQLite, tre trend separati e due allarmi pronti per Telegram.

## Il metro con cui giudicarlo

Deve somigliare a un caso reale piccolo e completo: una pagina sola è corretta, perché
l'impianto vero è un dispositivo solo — il punto è mostrare il giro intero (lettura → storico →
allarme → notifica) su un caso minimo, non riempire pagine.

Non giudicarlo con il metro dell'inventario (non deve coprire ogni tipo di oggetto) né con
quello di un banco di prova di protocollo puro: qui MQTT è il mezzo, non il soggetto — il
soggetto è il dispositivo e il suo ciclo acceso/spento.

_Revisione template, 2026-09-15 (`docs/plans/2026-09-14-revisione-template.md`, passo 2)._

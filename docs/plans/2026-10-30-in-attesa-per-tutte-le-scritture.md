# Seme — lo stato «in attesa» per tutte le scritture

**Seme, non piano d'esecuzione.** Nato il 30-10-2026 dalla revisione dello slider
([piano](2026-10-30-revisione-slider.md)). **Quando si comincia questo lavoro, il primo passo è una sessione di
plan approfondita per sviscerarne tutti i dettagli.**

## L'idea

Quando un operatore comanda qualcosa, il valore nuovo si vede solo quando torna dal tag. Fra il comando e il ritorno
l'oggetto mostra ancora il valore vecchio, e non dice che sta aspettando. Se il comando si perde, l'unico segnale è
un toast sul web; su LVGL si vede solo il 401/403, il resto va su stderr.

Lo slider avrà il suo stato «in attesa» nella fase 1 del piano: il cursore resta dove l'ha lasciato l'operatore,
col bordo tratteggiato, finché il tag non arriva o per 3 s. Gli altri oggetti che scrivono — bottone, setpoint,
checkbox, radio — non lo hanno.

## Cosa c'è oggi (30-10-2026)

- Tutte le scritture web passano da `guardedWrite` in `SvgCanvas.tsx`, che gestisce conferma, comando critico e
  motivo. Gli errori arrivano col toast `sws:write-failed`.
- Su LVGL le scritture vanno in un canale (`TagCommand`) senza risposta per l'oggetto.
- Il piano archiviato `2026-08-21-scada-widgets.md` aveva la voce F3.7 («stato in attesa / ok / errore»): è stata
  fatta solo come toast.

## Le domande da sciogliere

- È un effetto generico del wrapper di pagina (e di `effects.rs`), come la qualità e lo stale, o ogni tipo lo
  disegna a modo suo?
- Quando la conferma è «arrivata»: il tag ha il valore scritto, o il valore cambia comunque? E con una deadband del
  PLC?
- Su LVGL serve una risposta dal runtime per ogni scrittura: oggi il canale va in un senso solo.

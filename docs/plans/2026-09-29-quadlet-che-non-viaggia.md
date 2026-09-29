# Il quadlet non viaggia con l'aggiornamento — seme

> Nato il 28-09-2026 collaudando la finestra dell'aggiornamento sul TC620, dal piano
> [aggiornamento runtime e bus utente](2026-09-27-aggiornamento-runtime-e-bus-utente.md), dove era una sezione.
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita per
> sviscerarne tutti i dettagli.** Qui ci sono l'idea e ciò che è stato misurato adesso.

## L'idea

`podman auto-update` sostituisce l'**immagine**; il quadlet (`~/.config/containers/systemd/sws-runtime.container`)
resta quello scritto dall'installer. Una riga nuova del quadlet arriva su un pannello solo reinstallando:
- il 28-09 `Timezone=local` (Fase 2): il TC620 aggiornato dal registry è rimasto in UTC finché non è stato reinstallato;
- la Fase 1 ha aggiunto il bus utente, `AutoUpdate`, `Notify=healthy`, `SWS_IMAGE`: un pannello installato prima non si
  aggiorna da solo affatto;
- la Fase 4 si appoggia al bus utente: un quadlet precedente al 27-09 dà «errore» nella commutazione.

## Misurato

- Il runtime non vede il proprio quadlet (è un file dell'host, non montato).
- Il runtime ha il bus utente: può leggere lo stato delle unit, ma riscrivere il quadlet vorrebbe dire scrivere
  sull'host — contro il vincolo «nell'host non si tocca niente» dei Pixsys (24-09).

## Opzioni visibili

- **Il runtime si accorge del quadlet vecchio** (una variabile `SWS_QUADLET_VERSIONE` scritta dall'installer) e lo dice,
  nell'IDE e nelle Novità di compatibilità: «reinstalla dall'Installazione».
- **Il runtime aggiorna il quadlet da sé**, montando la cartella dei quadlet: niente reinstallazioni, ma il container
  scrive sull'host.
- **Le righe che servono si spostano dal quadlet all'immagine**, dove si può (per esempio `Timezone` come variabile
  d'ambiente letta dal runtime): meno righe nel quadlet, meno righe da far viaggiare.

Nel frattempo: ogni rc che cambia il quadlet lo scrive nella sua voce `compatibilita` di `NOVITA.yaml`.

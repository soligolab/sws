# I file dei marchi sono leggibili da chiunque, e un marchio è di un cliente

> **Seme.** Quando questo lavoro comincerà, il primo passo è una sessione di plan dedicata per
> sviscerarne tutti i dettagli: fra la domanda e il lavoro passa troppo tempo, e un disegno
> scritto mesi prima è un disegno che mente.
>
> Nato l'08-10-2026 chiudendo la prima metà della Fase 3c.

## L'idea

Dall'08-10-2026 il marchio **segue l'azienda** di chi entra: `GET /api/identita/marchio` dice
quale, e l'IDE ricarica il tema dopo l'accesso. Ma i **file** di un marchio — logo, favicon,
`brand.json` con il suo catalogo di dispositivi — li serve la rotta `/branding/:marchio/:file`,
che è **pre-auth** e lo deve restare: la schermata di accesso ha bisogno di un logo prima che
esista una sessione.

Conseguenza: chi conosce (o indovina) l'identificativo di un marchio altrui ne scarica logo e
`brand.json`. Nel cloud quei marchi sono di **clienti diversi**, e `brand.json` non è solo
aspetto — porta il catalogo dei dispositivi di quel cliente (decisione 43).

## Cosa è stato misurato l'08-10-2026

1. `/branding/:marchio/:file` è pre-auth e dichiarata tale in `check_rotte_preauth.sh`: è una
   delle otto del gruppo `open`.
2. L'elenco dei marchi (`GET /api/amministrazione/marchi`) **è** confinato dallo stesso giorno:
   chi amministra un'azienda vede solo il suo. Quindi gli identificativi altrui non si
   *elencano* — ma si indovinano, e sono i nomi dei clienti.
3. Un marchio è di una sola azienda (vincolo in `aggiorna_azienda`): non c'è un marchio
   «condiviso» a parte quello standard, che è di tutti e non è un segreto.

## Le opzioni che si intravedono, da non decidere adesso

- **Lasciare com'è, dichiarandolo**: un logo non è un segreto, e il catalogo dei dispositivi
  nemmeno. Costo zero, ma va scritto da qualche parte invece di scoprirlo.
- **Separare ciò che serve prima del login** (solo il marchio dell'installazione) da ciò che
  serve dopo (quello dell'azienda, dietro `require_auth`). Due rotte invece di una.
- **Nomi non indovinabili**: l'identificativo sul filo diventa opaco. Risolve il problema e
  rende illeggibili i log e i percorsi.

## Una seconda domanda, minore, dallo stesso giorno

Un utente che appartiene a **due aziende con marchi diversi** oggi riceve il primo per id. Un
IDE mostra un marchio solo, quindi una scelta va fatta; se debba essere stabile (com'è ora),
sceglibile dall'utente, o legata al **progetto aperto** invece che alla persona, è parte della
stessa sessione di plan.

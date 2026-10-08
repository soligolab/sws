# Fase 3c — i ruoli confinano, e le quote contano

> Dettaglio della **Fase 3c** del [tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md).
> 3a e 3b sono chiuse e in archivio. **Questo piano non è ancora approvato**: le domande in fondo
> vanno risposte dal maintainer prima di scrivere codice.

## Da dove nasce

Richiesta del maintainer, 07-10-2026: «una configurazione dei ruoli degli utenti, per esempio
potrei voler definire per una azienda un amministratore che vede solo la sua azienda e può
approvare nuovi utenti».

Il pezzo che manca **non è il ruolo**: è il confinamento. La stessa console, aperta da un
amministratore d'azienda, deve mostrare la sua azienda e nient'altro.

## Misurato nel codice l'08-10-2026

1. **I due ruoli non governano niente.** `membri.ruolo` è `amministratore | sviluppatore`
   (decisione 18), ma `auth_user_da_identita` (`router.rs`) li mappa **tutti e due** su
   `Role::Admin`. Fu una scelta dichiarata: l'editor non ammette meno di Admin per lavorare.
2. **La console è aperta solo all'amministratore di piattaforma**:
   `.route_layer(middleware::from_fn(require_amministratore_piattaforma))` su tutto
   `amministrazione.rs`. Non c'è nessuna via di mezzo fra «vedi tutto» e «non entri».
3. **Gli endpoint restituiscono tutto**: `elenca_aziende` dà tutte le aziende, `elenca_utenti`
   tutti gli utenti con le loro appartenenze. Nessuno filtra per chi guarda.
4. **Il confinamento dei progetti invece esiste già**, ed è la 3b: `visibilita()` decide, e
   `risolvi_progetto` la applica a ogni indirizzo. La console è l'ultimo posto che mostra ancora
   tutto a chiunque ci entri.
5. **Le quote sono colonne inerti** dal 07-10: `max_progetti`, `max_pannelli`, `max_byte` esistono
   su `aziende` e nessun conteggio le guarda. La console le mostra dicendo che non fanno niente.

## La forma probabile del lavoro

- Una guardia nuova accanto a quella esistente: entrare nella console non richiede più
  *piattaforma*, ma **piattaforma oppure amministratore di almeno un'azienda**. Chi è solo
  sviluppatore resta fuori, come oggi.
- Ogni endpoint della console filtra per le aziende di chi guarda — la stessa idea di
  `visibilita`, applicata a utenti e aziende invece che a progetti. **Una funzione sola**, come si
  è già fatto per l'elenco e per l'indirizzo: due regole da tenere d'accordo divergono.
- Le sezioni che non sono di nessuna azienda — **Posta** e **Questa installazione** — restano
  all'amministratore di piattaforma, e per gli altri non compaiono affatto (non «compaiono e
  danno 403»).
- Le quote: un conteggio al momento della creazione, e un rifiuto che dice **quale** limite è
  stato raggiunto e qual è.

## Le domande da risolvere prima di scrivere codice

1. **Un amministratore d'azienda può creare utenti**, o solo gestire quelli che già ci sono? Se
   può crearli, un'azienda può riempirsi di account senza che la piattaforma lo sappia — a meno
   che la quota non conti anche quelli.
2. **Può togliere e mettere le persone nella sua azienda**? Metterle vuol dire poter aggiungere un
   indirizzo qualunque, cioè invitare: e l'invito è Fase 5.
3. **Vede le quote della sua azienda** (quanto ha usato su quanto) o sono un fatto della
   piattaforma che a lui non riguarda?
4. **Chi sceglie il marchio di un'azienda**: la piattaforma, o l'azienda stessa? La decisione 43
   lo assegna all'azienda, ma non dice chi lo decide.
5. **Cosa succede al superamento di una quota**: si rifiuta e basta, o si avvisa prima di
   arrivarci?

**L'approvazione dei nuovi utenti** che il maintainer nomina nella richiesta **non è qui**: nasce
con la registrazione libera, che è Fase 5. In 3c si confina il ruolo; il pulsante «approva»
compare quando ci sarà qualcuno da approvare.

# Le credenziali e il CRA — quando il cambio password può aspettare (seme)

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è una sessione di plan
> approfondita dedicata, per sviscerarne tutti i dettagli. Quello che segue è l'idea e le misure
> del 07-11-2026, non un progetto.

## Da dove nasce

Collaudo del 07-11-2026 sul TC620 di casa. Il deploy di CasaDomotica dal cloud, con la casella
«Sostituisci anche gli utenti» attiva (è il default), ha portato sul pannello l'unico utente del
progetto: `admin`, creato il 12-10 con `must_change_password: true`. Nel cloud nessuno entra con
quell'utente (si entra con la mail, dal gateway), quindi il segno era rimasto lì per un mese. Sul
pannello invece `admin` è quello che sblocca «Aggiorna ora» nel viewer: il primo accesso ha imposto
il cambio, e il deploy ha sostituito in silenzio gli account che il pannello aveva prima.

## Cosa ha chiesto il maintainer

- un caso «C»: la richiesta di cambio compare, ma si può rimandare («Più tardi»);
- se esiste una deroga del CRA (Reg. UE 2024/2847) per cui il «più tardi» possa diventare «per
  sempre».

## Cosa si sapeva il 07-11-2026 (da verificare con chi fa conformità)

- Il CRA non scrive «la prima password va cambiata». Chiede *secure by default* (Allegato I, parte
  I; unica eccezione esplicita: il prodotto su misura concordato con un utente business) e
  protezione dagli accessi non autorizzati. L'obbligo viene dalle norme usate per la presunzione di
  conformità: ETSI EN 303 645 (niente password predefinite universali), IEC 62443-4-2 CR 1.5
  (credenziali predefinite cambiate all'installazione); le norme armonizzate CRA erano in
  preparazione. Gli obblighi principali del CRA si applicano dall'11-12-2027.
- Il bersaglio delle norme è la password **nota**: uguale su tutti i dispositivi, o comunicata da
  qualcun altro. SWS non ha una password di fabbrica universale (`sws-auth` rifiuta di partire
  senza `SWS_ADMIN_PASSWORD` o una password scelta).

## Le opzioni già visibili

1. «Più tardi» per tutti: la richiesta torna a ogni accesso.
2. «Non chiedere più» solo per un Admin, dopo un avviso esplicito, scritto nell'audit, annullabile
   col ripristino. Il default resta sicuro; la scelta di spegnerlo è di chi gestisce l'impianto.
3. Il segno resta obbligatorio quando la password l'ha decisa un altro (un admin che crea l'account
   di un operatore).
4. Il deploy che sostituisce gli utenti lo dice prima, nominando quelli col cambio obbligatorio.

Il punto 4 e il «Più tardi» possono anticipare questo seme (rc.3 della 2.26.0); il «per sempre» e
la lettura delle norme sono decisione di prodotto.

# Il dispositivo ricordato per progetto — un difetto, con il rischio del deploy sbagliato

> Seme del 20-11-2026, dal maintainer: «Quando cambio progetto chiudendo e riaprendo uno nuovo la connessione rimane
> sul dispositivo precedente col rischio concreto di caricare il progetto sul dispositivo sbagliato. Ogni progetto deve
> ricordare a che dispositivo era connesso l'ultima volta che è stato chiuso e, all'apertura, chiedere se ci si vuole
> riconnettere a quel dispositivo specifico.»
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita e dedicata**, per sviscerarne
> tutti i dettagli.

## Il difetto
Nell'IDE locale (PC del cliente, `start_editor.sh`) si chiude un progetto e se ne apre un altro: il collegamento al
pannello resta quello di prima. «Deploy» manda il progetto nuovo al pannello del progetto vecchio. Niente lo dice,
a parte l'indicatore in alto (`DispositivoCollegato`).

## Cosa c'è nel codice (misurato il 20-11-2026, su `main`)
- **Il collegamento è dell'istanza, non del progetto.** `AppState.remote_target` (`sws-web/src/router.rs:199`) è uno
  solo per tutto l'IDE: lo scrive `connect_remote` (`remote.rs:498`), lo toglie solo `disconnect_remote`
  (`remote.rs:1194`). L'apertura di un progetto (`projects.rs`, `open_project`) non lo tocca.
- **Il browser ricorda un solo indirizzo**, non uno per progetto: `sws.runtime.targetUrl` e `sws.runtime.targetUser`
  in `localStorage` (`RuntimeConnectionTab.tsx:106`). Il pulsante «Deploy» in alto lo usa per il «riconnetti» a un
  clic (`App.tsx:1011`). La password non si salva nel browser (09-09-2026).
- **Nel cloud il ricordo per progetto esiste già**: ogni progetto ha il suo container, e `config/dispositivo.yaml`
  (`DispositivoRicordato`, `remote.rs:805`) tiene indirizzo, utente e password del pannello di quel progetto; il
  container si ricollega da solo (`ripristina_se_serve`). In locale non si scrive, perché lì `config/` è dell'istanza.
  Il difetto è quindi dell'IDE locale.
- C'è anche l'elenco dei dispositivi registrati (`config/dispositiviRegistrati.ts`, `DevicesTab.tsx`): un indirizzario,
  non un collegamento.

## Le domande per la sessione di plan
1. **Dove sta il ricordo**: nel progetto (`project.yaml`, viaggia con git, backup ed export), in un file accanto al
   progetto fuori da git, o in `config/` dell'istanza con una voce per progetto. E la password: i segreti del progetto
   viaggiano già nei backup e negli export (decisione del maintainer), ma questa è una credenziale del pannello, non
   del progetto; nel cloud sta fuori dal progetto, in `config/`.
2. **Alla chiusura o al cambio di progetto il collegamento si chiude sempre?** Sembra il minimo per togliere il
   rischio, anche prima della domanda all'apertura.
3. **All'apertura**: la domanda «Ricollegarsi a `<nome>` (`<indirizzo>`)?» con sì/no; con gli utenti sul pannello serve
   la password, che il browser non tiene: il modulo di accesso già compilato?
4. **Il deploy verso un pannello che ha un altro progetto**: il pannello sa quale progetto ha (nome nel deploy?). Un
   avviso prima di sovrascrivere un progetto diverso darebbe una seconda difesa, anche col collegamento giusto.
5. Il comportamento nel cloud (già per progetto) e quello locale si allineano, o restano due strade?

## Regola da ricordare
Per la regola del 09-11-2026 («un'anomalia che rovina l'uso passa davanti») un deploy sul pannello sbagliato è del
tipo che passa davanti: il maintainer l'ha chiesto come seme il 20-11-2026, e decide lui quando aprirlo.

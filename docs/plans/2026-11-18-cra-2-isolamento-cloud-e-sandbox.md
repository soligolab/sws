# CRA, sessione 2: isolamento nel cloud e sandbox delle espressioni

> Piano della sessione 2 delle [sessioni CRA](2026-11-17-cra-sessioni-e-decisioni.md), approvato dal maintainer il
> 18-11-2026 («ok» alla proposta). Ramo `fix/cra-2-cloud-isolation-sandbox`, **annidato** su
> `docs/cra-1-true-statements`. Misurato sul codice del ramo.
>
> **Fatto il 18-11-2026, da validare** insieme alla sessione 1. Le due revisioni hanno cambiato tre cose del piano:
> la chiave dei container (D10), i controlli sulle espressioni (D7 corretta) e il tetto di CPU, rimandato (D12).
> Vedi «Dopo la revisione» in fondo.
>
> **Scopo**: nel cloud un progetto non deve valere tutti i progetti; un'espressione o uno script non devono arrivare
> all'ambiente del processo; un archivio zip non deve poter riempire la memoria. In più, anticipato dalla sessione 3
> su proposta accettata: il pannello di controllo esiste solo dove c'è un dispositivo.

## I fatti

| Tema | Oggi | Dove |
|---|---|---|
| Segreto del gateway | Il gateway passa il suo segreto principale a ogni container di progetto, e lo manda in `X-SWS-Gateway` a ogni richiesta inoltrata. Il container crede all'utente in `X-SWS-Utente` (come Admin) se il segreto torna. Dallo stesso segreto il gateway ricava i token dei pannelli e le chiavi di ritorno | `sws-web/src/gateway/progetti.rs:659`; `gateway/rotte.rs:219`, `:233-247`; `gateway/inoltro.rs:123-131`; `router.rs:2697`; `tunnel/abbinati.rs:58`; `gateway/ritorno.rs:57` |
| Container vecchi | Un container di un'immagine diversa da quella del gateway non si riadotta: si rifà alla prossima apertura | `gateway/progetti.rs:316-339` |
| Pannello di controllo | Le rotte stanno nel gruppo aperto di tutti e tre i router; il router completo serve anche l'istanza IDE, il gateway e i container di progetto. L'IDE chiama `/api/control-panel` su sé stesso solo per leggere la luminosità, e ignora l'errore | `router.rs:1542`, `:2100`, `:2251`; `sws-editor/src/editor/DeviceScreenSettings.tsx:328` |
| Espressioni dei tag | Python normale: `exec` con tutti i builtin, senza sandbox. Le 29 espressioni dei 24 progetti di questa macchina (template e `~/sws_projects`) usano solo `tags[...]`, `if`/`else`, `round`, `max`, `int`, `abs`, `min`, `sum`, `len`. Una, nel template `s7-demo`, usa `tags.read(...)`, che oggi non funziona: `tags` è un dizionario | `sws-pyscript/src/lib.rs:1119-1155`; `examples/templates/s7-demo/project.yaml:60` |
| Script in sandbox | `_getattr_` è `getattr`: con `"…".format(…)` uno script arriva agli attributi nascosti e all'ambiente del processo. Nessuno script dei progetti di questa macchina usa `.format(` | `sws-pyscript/src/lib.rs:348` |
| Zip | Quattro letture di voci senza tetto: un archivio di pochi MB può diventare gigabyte in memoria | `projects.rs:3329-3345`, `router.rs` (logica PLC), `logica_plc.rs`, `boot.rs` |

Le espressioni e gli script dei progetti del cloud (CasaDomotica e gli altri sul VPS) sono stati misurati dopo, il
18-11, quando il maintainer ha dato l'accesso: 37 espressioni e 13 script e funzioni in 16 progetti, tutti a posto
con le regole nuove.

## Le decisioni (nel registro, «Sessione 2»)

- **D6 — Ogni container di progetto ha un segreto suo**, `HMAC(segreto del gateway, "container:" + <azienda>/<progetto>)`.
  Il gateway lo ricalcola quando inoltra; il segreto principale non esce più dal gateway.
- **D7 — Le espressioni dei tag sono un sottoinsieme di Python, nella sandbox**: espressioni, assegnazioni e `if`;
  niente `import`, cicli, funzioni, lambda, classi, `try`, `with`, comprensioni. Senza cicli un'espressione finisce
  sempre, quindi non serve il controllo del tempo degli script (che costa CPU sul Tiny TY). Un'espressione che usa
  altro dà un errore che lo dice.
- **D8 — Negli script in sandbox `getattr` è quello sicuro di RestrictedPython** (`safer_getattr`): niente
  attributi che cominciano con `_`, niente `str.format`. Le f-string restano.
- **D9 — Il pannello di controllo esiste solo dove c'è un dispositivo**: non sull'istanza IDE, non sul gateway, non
  nei container di progetto.

## I passi

1. **Segreto per container** (D6). `gateway/ritorno.rs`: `container_secret(chiave, riferimento)` (nome definitivo, D10). `progetti.rs`:
   l'ambiente del container riceve quello. `rotte.rs`: l'inoltro manda quello. Test: il segreto di un container è
   rifiutato da un altro; il segreto principale non è più nell'ambiente; token dei pannelli e chiavi di ritorno non
   cambiano. Il commento di `ritorno.rs` scritto nella sessione 1 («today that does not hold») si corregge.
2. **Pannello di controllo solo su un dispositivo** (D9). Le tre `merge` passano da una funzione che dice se
   l'istanza è un dispositivo (`!ide_only && regia.is_none() && segreto_gateway.is_none()`). Test: sull'IDE e sul
   gateway `/api/control-panel` risponde 404.
3. **Tetti agli zip**. Una funzione sola che legge una voce con un tetto (`Read::take`), usata dalle quattro letture;
   tetto al totale e al numero di voci dove si legge un archivio intero. Messaggio chiaro. Test con uno zip che si
   gonfia.
4. **Espressioni nella sandbox** (D7). `EVAL_HARNESS`: dopo l'iniezione di `__sws_result__`, un controllo dei nodi
   ammessi, poi `compile_restricted` sull'albero, con le guardie degli script e `safer_getattr`. Con la deroga
   `SWS_SCRIPT_SENZA_SANDBOX=1` (solo sviluppo) resta il Python normale, come per gli script. Il codice compilato resta
   in cache. Il template `s7-demo` passa a `tags['pump1.speed']`. Test: tutte le espressioni dei template danno lo
   stesso valore; `__import__('os')`, un ciclo, un attributo con `_` sono rifiutati con un messaggio.
5. **`safer_getattr` negli script** (D8). Test: `"{0.__class__}".format(x)` rifiutato; f-string e metodi normali
   (`.upper()`, `.append()`) funzionano.
6. **Documenti**: valutazione del rischio (righe (d), (h), (k)), capitolo 17 dove una frase cambia, CHANGELOG, Novità
   (riga di compatibilità per D7 e D8), collaudi.

## Cosa può andare storto

| Rischio | Come si evita |
|---|---|
| Un tag calcolato di un progetto vero smette di valere dopo l'aggiornamento | Il messaggio d'errore dice cosa non è ammesso; la riga di compatibilità nelle Novità; il maintainer controlla i progetti del cloud prima del rilascio |
| La CPU del Tiny TY risale | Nessun `settrace`; compilazione in cache come oggi. Misura sul TY570 come voce di collaudo |
| Nel cloud un container acceso col segreto vecchio | Un container di un'altra immagine non si riadotta (`progetti.rs:316-339`): col gateway nuovo si rifanno tutti |
| Un pannello senza RestrictedPython | È già obbligatoria per gli script dal 15-10: le espressioni seguono la stessa regola |

## Verifica

- Automatica: `cargo test` del workspace (pyscript, web, runtime), `clippy`, `fmt`, `check_static.sh`, `check_templates`.
- Sul TY570: CPU con la pagina degli 8 LED, contro il 6 % del 17-11.
- Nel cloud, dopo il rilascio: un progetto di un'azienda non raggiunge il container di un'altra; il pannello di
  controllo non risponde su `sws.soligo.net`.
- Dal maintainer: le espressioni e gli script dei progetti del cloud (CasaDomotica compresa) passano.

## Dopo la revisione (18-11-2026)

Due revisioni indipendenti sul ramo. Quello che hanno trovato, e cosa è cambiato:

| Rilievo | Cosa si è fatto |
|---|---|
| Il segreto del gateway è stato nell'ambiente dei container fino a oggi: con la D6 chi l'ha letto ricalcola il segreto di ogni container | Chiave nuova, solo per i container (D10). Resta aperto il token dei pannelli: decide il maintainer |
| Un container nato col segreto vecchio si riadotta se l'immagine è la stessa | Etichetta con l'impronta della chiave; senza, il container si rifà |
| `10 ** 10 ** 10`, `'x' * 10 ** 9`, `round(5, -10 ** 7)`, una larghezza di formato enorme: un'espressione blocca l'interprete o riempie la memoria | Controlli su `**`, `<<`, `*`, `%`, `round`, `format` e f-string; via `range` e `pow`; via i metodi che allungano un testo (D7 corretta) |
| Un'espressione può cambiare i valori annidati che legge la successiva | Strutture e array di sola lettura |
| Un'espressione rifiutata si ricompila a ogni cambio, e il registro si riempie | Anche l'errore resta in cache; il registro lo dice una volta; il tag diventa «Bad» |
| `safer_getattr` dà `None` per un attributo che non c'è | Un `AttributeError` col nome, negli script e nelle espressioni |
| Uno zip da 32 MB può dichiarare centinaia di migliaia di voci, e la lettura dell'indice le costruisce tutte | Il conteggio dichiarato si legge prima di aprire l'archivio; tetti più bassi (D11) |
| Un'immagine di boot troppo grande si espande prima di essere scartata | Si scarta dalla misura dichiarata |
| Un container può usare tutta la CPU del VPS | Rimandato alla sessione 3 (D12) |

## Il rilascio (decisione D10 del maintainer, 18-11-2026)

Il segreto del gateway si cambia, perché fino a questa sessione stava nell'ambiente di ogni container. Dopo il cambio
i token dei tre pannelli abbinati al cloud non valgono più, e i pannelli vanno riabbinati. Si fa in quest'ordine:

1. **Prima del rilascio, mentre il tunnel funziona ancora**: il backup del database del TC620 di casa
   (`tc620-garage`, CasaDomotica, circa 540 MB di storico). Dall'IDE nel cloud collegato al pannello: Configurazione
   → Datastore → «Scarica il database dal dispositivo remoto». Oppure da casa, copiando il file.
2. **Il gateway** passa all'immagine nuova come sempre. In più, **prima di riavviarlo**, il segreto vecchio si mette
   da parte: `mv ~/sws-vps/gateway-config/segreto_gateway ~/sws-vps/gateway-config/segreto_gateway.vecchio-<data>`.
   All'avvio il gateway ne crea uno nuovo, e crea anche `container_key`. Il file vecchio si cancella a riabbinamento
   finito.
3. **Ogni pannello**: dal suo `abbinamento.json` (nella configurazione del runtime) si tolgono `tunnel_nome` e
   `tunnel_token`, e si riavvia il runtime. Il codice di abbinamento resta lo stesso. Il pannello si presenta al
   gateway in attesa; la console lo segna «da riabbinare» (stessa scatola, stessa riga); si inserisce il suo codice
   nell'IDE nel cloud. Serve l'accesso SSH a ogni pannello, da chiedere al maintainer con l'indirizzo. Il TC620 sta a
   casa: si riabbina da lì, o da una sessione sulla macchina `ufficio`.
4. **Le verifiche**: le voci della sessione 2 in `docs/COLLAUDI_IN_SOSPESO.md`.

Finché il passo 3 non è fatto, i tre pannelli lavorano normalmente in locale, ma il cloud non li raggiunge.


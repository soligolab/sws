# La sorgente LogicLab a memoria diretta (`kind: logiclab`)

> **Piano del 23-11-2026**, sessione di plan col maintainer su `elitedesk`, dopo una lettura in parallelo del manuale
> LLExec, degli header dei plugin, della toolchain e del codice SWS, due proposte indipendenti e una revisione critica.
> Richiesta arrivata a Pixsys: un driver SWS che legga e scriva le variabili di un PLC LogicLab **senza passare dai
> protocolli**, accedendo all'area di memoria dove il runtime le tiene, e che le mappi **da solo** da
> `/data/logiclab/PLC.sym.xml`, il file che l'IDE LogicLab scrive a ogni download. Tutti i dispositivi con LogicLab:
> arm64 (WP630, TC620, PLX800) e arm32 (TY570/RV1106).
>
> **Decisioni del maintainer**: plugin nostro dentro LLExec e modifica di `LLExecLinux.conf` ammessi; schema **(B)**
> «copia e casella di posta» in **due tempi** (prima senza agganci al ciclo real-time, poi la copia a fine ciclo e le
> scritture a inizio ciclo); lettura e scrittura; **dopo** [il PLX800 in SWS](2026-11-23-plx800-sws-e-modulo-io.md);
> CODESYS dopo ([seme](semi/2026-11-23-codesys-memoria-diretta.md)). Il materiale di Axel sta in `tmp/LogicLab/`
> (manuale SP10013, `PluginHeaders_2.22.61.zip`, `Toolchain.zip`) e non si committa. 10–13 sessioni.

## Cosa è stato misurato sul PLX800 (23-11-2026, sola lettura)

- **LLExec 3.2.29** (gli header sono **2.22.61**: rischio di ABI), da root, `logiclab.service`
  (`WorkingDirectory=/data/logiclab`, `ExecStartPre=/usr/lib/logiclab/setup-logiclab.sh`, `Restart=on-abort`),
  `mlockall` attivo (VmLck 1,1 GB), capability piene, niente seccomp.
- `LLExecLinux.conf` è un symlink verso `configs/RK3399/PLX800/LLExecLinux.conf`, creato da `setup-logiclab.sh` **solo
  se manca**. Conf: dati 1 MB, ritentivi 4 KB, codice 4 MB; task Fast io 5 ms, Slow 10 ms, Background; datablock memo
  1–4, 100 (sola lettura), 101; 17 plugin Axel (fra cui `LLSymbolsServer`, OPC-UA, WebServer, MQTT).
- **Le variabili sono in mapping anonimi privati** di LLExec: DATA+RETAIN `0x7f7571000000-0x7f7571101000`, codice
  `0x7f7579…`, datablock `0x7f7581000000-0x7f758102a000`. Il container SWS è rootless: da fuori non si arriva.
- **`PLC.sym.xml`** (162 KB): `<LLSymbolTable CodeId DataRelocation="none" is64bit isBigEndian …>`; `GlobalVars/Var`
  con `Name`, `Type`, `Addr` assoluto; per le variabili sui datablock `DataBlockType`, `DataBlockNumber`,
  `DataBlockIndex`, `Access` (1 sola lettura, 3 lettura/scrittura); `Dims`, `length` per le stringhe; `Structures/Stru`
  con offset relativi `0x0[n]`; `Enums`; `DataBlocks/DBlock` (65009 = DATA, 65010 = RETAIN, i blocchi della conf, i
  blocchi di sistema anche su heap). Il progetto di prova ha tre variabili utente: `cnt` nell'area dati, `ProvaInt` e
  `ProvaBool` sul blocco 101.

## Architettura

### Il plugin `LLXPlugin_SwsBridge.so`
C99, cartella `llexec-plugin/` in cima al repo, circa 900 righe. Gli header Axel non si committano: `llx_abi.h`
ridichiara il sottoinsieme minimo con `_Static_assert` (passo di `LLEXEC_FUNDEF` 48 B LP64 / 40 B ILP32).
- Esporta solo `InitializePlugin`, `DestroyPlugin`, `GetFunctionDefs`, `GetDataBlockDefs` (zero blocchi).
  **Restituisce sempre TRUE**: al minimo dubbio resta inerte con un motivo, e LLExec parte comunque.
- Della API usa solo il **membro #0, `LLGetDataBlockAddress`**, e i callback. Il resto (il `codeID` in
  `LLGetRuntimeData`, indice 37) solo dietro una lista di build-id di LLExec validati in laboratorio.
- `LLFUNCT_INIT_L0`: avvia un **thread helper SCHED_OTHER** (nice 10, segnali bloccati) e risolve i datablock elencati
  nei parametri (base, passo, estensione, tutto dentro mapping `rw` di `/proc/self/maps`; mai 65007/65008/65013 né
  codice).
- `LLFUNCT_RTNOTIFY`: a STARTRT, STOPPLC, PLC_ENDLOAD, WARM/HOTRESTART, STOPPING/STOPPEDRT incrementa la generazione e
  aspetta che l'helper esca dalla sezione d'accesso (al massimo 50 ms, altrimenti scritture bloccate fino al riavvio).
- **v1, senza agganci al ciclo I/O**: l'helper copia a parole allineate (nessuno strappo sul singolo scalare; nessuna
  coerenza fra variabili diverse, come la watch di LogicLab) e scrive con store atomici; stringhe con la sequenza
  vecchio → "" → nuovo; bit con fetch_or/fetch_and.
- **v2 (fase 4), il (B) completo**: copia in `LLFUNCT_POST_IO` in un doppio buffer privato e scritture applicate in
  `LLFUNCT_IO`, dopo le misure della v1.
- Guardie: contatore di avvii in `/run/sws-llx/` (2 avvii sporchi in 10 minuti → inerte); preflight `dlopen` in un
  processo a parte prima di LLExec.

### Il canale
- `AF_UNIX SOCK_SEQPACKET` astratto `\0sws-llx-0`: il container ha già `Network=host`, quindi nessun `Volume=`.
  Credenziali del peer controllate nei due sensi.
- Messaggi: HELLO/WELCOME (stato, generazione, datablock con basi); GET_SYM (il plugin passa **l'fd** di
  `PLC.sym.xml`: niente mount, niente percorsi diversi sul TY570); SUBSCRIBE (intervalli **relativi**
  `(db_type, db_id, offset, len)`, mai indirizzi assoluti); READ/DATA; WRITE/WRITE_RESULT (con generazione, `CodeId` e
  scadenza); EVENT (battito a 1 Hz e ciclo di vita).
- **Scritture**: doppio interruttore — `write=1` nei parametri del plugin nella conf LLExec (lo decide chi gestisce il
  PLC) **e** `writes: true` nella sorgente; whitelist dei datablock (DATA, RETAIN, memo RW della conf; mai I/Q, il
  100, i 6xxxx); senza un'identità del codice verificabile, niente scritture.

### La sorgente SWS: crate `sws-plugin-logiclab`
Circa 1600 righe: `transport.rs` (socket, SCM_RIGHTS, `AsyncFd`), `sym.rs` (roxmltree in `spawn_blocking`; rifiuta
big-endian, `is64bit` diverso, `DataRelocation` ≠ none), `layout.rs` (variabile → intervallo, strutture e array,
scrivibilità da `Access`), `codec.rs` (IEC → tipi SWS; TIME e DATE_AND_TIME da misurare in fase 0), `source.rs`
(macchina a stati, poll 100 ms, 200 sul TY570, in `ingest` solo i valori cambiati). Qualità: Good; Uncertain (PLC
fermo, breakpoint, ri-sottoscrizione); Bad (socket chiuso, battito oltre 3 s, basi o `CodeId` diversi, simbolo
sparito).

### La mappatura automatica
Endpoint sul pannello `GET /api/logiclab/symbols` e il proxy `/api/remote/…`; nell'IDE una finestra che crea TypeDef
→ TagDef → mappature come il catalogo Modbus. Le mappature salvano il **nome** del simbolo (globali per nome, locali
`MAIN.x`, foglie `.membro` e `[i]`), risolto a ogni cambio del sym: un download con gli stessi nomi non chiede un nuovo
deploy di SWS.

### Installazione del plugin
Root e finestra di manutenzione (il PLC si ferma qualche secondo): `.so` in `/data/logiclab/lib`; drop-in
`logiclab.service.d/50-sws-llx.conf` con `ExecStartPre=llx-ensure.sh`, che inserisce o toglie **una** riga
`<plugin>` fra marcatori nel file di conf risolto, con la copia dell'originale; rollback di una riga. Se `configs/` non
è scrivibile, un file vero al posto del symlink (`setup-logiclab.sh` non lo ricrea).

### Build
armhf con la Linaro 6.5 di Axel (glibc 2.23, flag di `setenvRV1106.sh`); aarch64 con una toolchain a glibc vecchia
(Linaro 6.5 aarch64 o `zig cc … gnu.2.17`) finché non arriva l'SDK arm64. Guardia nuova `scripts/check_llx_plugin.sh`
(GLIBC ≤ 2.23, `DT_NEEDED` ⊆ libc/libpthread, quattro simboli esportati).

## Fasi
0. **Prova sul PLX800** (2 sessioni; artefatti in `sws/tmp/logiclab/`; ogni passo col via del maintainer e la conf
   originale salvata). Inventario (maps fra due riavvii, thread, build-id, formato `<plugin>` e passo di
   `LLEXEC_FUNDEF` da un plugin Pixsys, scrivibilità di `configs/` e `/etc`); lettura da root via `/proc/PID/mem` per
   confermare indirizzi, `DataBlockIndex × DataSize`, layout di STRING, array e TIME, e dove sta il `CodeId`; banco dei
   guasti con un plugin vuoto (`.so` mancante, simbolo irrisolto, FALSE, SIGSEGV in INIT_L0 e nell'helper); plugin
   sonda che registra INIT_Lx e ogni RTNOTIFY (thread, politica) attraverso stop/start, download a caldo e a freddo,
   modifica online, riavvio, spegnimento; prototipo dell'helper letto dal container rootless per 30 minuti senza
   overtime. **Esiti che decidono**: un guasto iniettato che lascia il PLC fermo senza rimedio automatico → ci si ferma
   e si chiede a Pixsys; basi che si spostano col ciclo di vita → si ri-risolve a ogni STARTPLC; STOPPLC che non arriva
   prima del reset, o nessuna identità del codice → la v1 resta in sola lettura.
1. **Lettura end-to-end** (3–4 sessioni): plugin con HELLO/GET_SYM/SUBSCRIBE/READ/EVENT, sorgente SWS con i tag scritti
   a mano. Fatto quando 50 globali sono Good a 10 Hz, Bad entro 1 s se LLExec muore, Uncertain a PLC fermo, di nuovo
   Good 1–2 s dopo un download, e zero overtime.
2. **Scritture e importazione nell'IDE** (3–4 sessioni): WRITE con le guardie, `TagWriteBus`, foglie di strutture e
   array; endpoint e finestra; banco di 1000 download con scritture continue e **zero scritture fuori posto**.
3. **Flotta** (2–3 sessioni): TY570 armhf (`/data/plcsys`, `runLLExec.sh`, single core), WP630/TC620, installatore,
   24 h di prova; l'esempio nel template `plx800-io`.
4. **Il (B) completo**, agganciato al ciclo, quando le misure della v1 lo giustificano.

## Domande per Axel / Pixsys (da mandare all'avvio della fase 0)
- L'SDK 3.2.x arm32/arm64, e se `LLEXEC_API` cresce solo in coda (il manuale del 2025 fa pensare a inserimenti in mezzo).
- Licenza e supporto per un plugin di terzi (`TRG_USER_PLUGINS`); una procedura d'installazione concordata; se gli
  aggiornamenti riscrivono `configs/` o `/etc`.
- Se `LLGetDataBlockAddress` risolve 65009, 65010 e 60000 da un thread del plugin, anche durante un download.
- Se le aree vengono mai riallocate (`bDynAreaAlloc`, attributo `addr` della conf).
- Dove leggere il `codeID`, e se cambia a una modifica online.
- Se STOPPLC arriva prima di `ResetPlcIEC`, e da quale thread.
- Se il servizio di ritenzione salva le scritture fatte da un plugin.
- Sul TY570: la versione di LLExec, i percorsi sotto `/data/plcsys`, come parte `runLLExec.sh`.

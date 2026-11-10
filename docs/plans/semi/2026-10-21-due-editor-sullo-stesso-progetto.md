# Due persone sullo stesso progetto: lock, presenza, o niente — seme

> Nato il 21-10-2026 da una prova del maintainer: ha aperto lo **stesso progetto** e si è
> collegato allo **stesso pannello** da due browser in due sedi diverse, e si aspettava che il
> secondo trovasse il progetto bloccato. Non succede.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui c'è la domanda e le misure di oggi, non un progetto.

## Cosa c'è oggi, misurato

**Nessun lock di utente.** I tre `Mutex` del runtime — `project_write_lock`,
`project_switch_lock`, `deploy_lock` (`sws-web/src/router.rs:208-238`) — sono **dentro un solo
processo** e servono a un'altra cosa: impedire che due scritture in volo insieme partano dallo
stesso stato e si sovrascrivano a metà file. Non sanno niente di *chi* scrive, e non dicono
niente al secondo che arriva.

**C'è invece un accorgimento, ed è a posteriori.** `useProjectWatcher`
(`sws-editor/src/ws/projectWatcher.ts:37`) chiede l'impronta del progetto
(`GET /api/project/fingerprint`, SHA-256 di `project.yaml` più tutti i sinottici) **ogni tre
secondi**; se cambia, l'IDE mostra «il progetto sul runtime è cambiato».

**E l'accorgimento ha un buco di venti secondi.** `App.tsx:669-672`:

```
useProjectWatcher(() => {
  if (Date.now() - lastLocalSaveAt.current < 20_000) return; // è stato un nostro salvataggio
  setProjectChangedOutside(true);
});
```

L'attribuzione è **a tempo, non a identità**: qualunque cambio d'impronta nei venti secondi dopo
un nostro salvataggio viene creduto nostro. Se B salva entro venti secondi da un salvataggio di
A, l'IDE di A **tace**, A continua a lavorare su una base vecchia, e al salvataggio dopo
sovrascrive B senza che nessuno dei due abbia visto un avviso. La finestra esiste per una ragione
buona — senza, l'avviso comparirebbe a ogni `Ctrl+S` — ma il prezzo è questo.

**Il materiale per fare di meglio c'è già.** Dal 20-10 il gateway sa, per ogni progetto aperto,
**quanti sono collegati** (`Aperto.collegati`, `gateway/progetti.rs`), e la console lo mostra. È
il dato che servirebbe a una presenza, e non lo guarda nessuno fuori dalla console.

## Le strade che si vedono già

1. **Presenza, non lock**: l'IDE mostra «ci sono altri N collegati a questo progetto», con i nomi.
   Non impedisce niente, toglie la sorpresa. È la più piccola e usa un dato che esiste.
2. **Lock consigliato**: il secondo che apre entra in sola lettura con un «prendi il controllo»
   esplicito. Serve decidere cosa succede quando il primo chiude il browser senza rilasciare —
   cioè una scadenza, cioè un battito.
3. **Salvataggio con impronta attesa**: il salvataggio porta l'impronta da cui è partito e il
   server rifiuta con 409 se nel frattempo è cambiata. Non blocca nessuno e rende **impossibile**
   la sovrascrittura silenziosa, che è il danno vero. Si può fare da sola, prima delle altre due.
4. **Niente**: si dichiara che il progetto è di una persona alla volta, e lo si scrive nel
   manuale.

## Domande per la sessione di plan

- Il danno da evitare è la sovrascrittura silenziosa o la sorpresa di trovarsi in due? Le strade
  3 e 1 rispondono a due domande diverse e non si escludono.
- Se un lock c'è, chi lo può strappare, e dopo quanto scade? Un lock che non scade è un progetto
  bloccato dal browser che qualcuno ha chiuso in treno.
- La finestra dei venti secondi si toglie comunque? Con un'impronta attesa sul salvataggio
  l'attribuzione a tempo non serve più: si sa chi ha scritto.
- Vale anche fuori dal cloud? Due IDE in LAN sullo stesso runtime hanno lo stesso problema, e lì
  non c'è nessun gateway che conti i collegati.

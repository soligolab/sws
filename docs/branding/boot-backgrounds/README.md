# Boot/login backgrounds — pannelli Pixsys

Cartella di atterraggio per gli sfondi di boot/login generati esternamente a partire dal prompt in
`../BRAND_SWS.md` (sezione "Sfondi di boot/login per pannelli Pixsys").

**Non c'è alcuna integrazione con questo repo**: nessun codice in `sws-editor/`, `sws-runtime/` o
`deploy/yocto/` referenzia questi file. Sono destinati al provisioning OS-level dei pannelli Pixsys
(boot splash del device), un meccanismo che oggi non esiste in questo codebase — vedi
`docs/OPEN_QUESTIONS.md` Q13.

## File attesi

Master a 1920×1080, poi un export per ciascuna risoluzione target:

- `480x272.png`
- `800x480.png`
- `1280x768.png`
- `1280x800.png`
- `1366x768.png`
- `1920x1080.png`

Quando arrivano, questa cartella resta il riferimento fino a quando non si decide (Q13) dove e come
consegnarli al provisioning reale dei device.

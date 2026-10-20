# Laboratorio OpenPLC v4 — la prova del 20-10-2026

Il materiale della misura descritta nel [piano del manuale](../../2026-10-19-manuale-rifatto.md), §«La misura, fatta
il 20-10-2026». **Non è ancora il laboratorio del tutorial**: è quello che il T01 porterà in `examples/laboratorio/`
con uno script di avvio. Sta qui perché la prova è stata fatta su una macchina sola e deve viaggiare con git.

- `impianto/` — il progetto dell'Editor OpenPLC v4: `pous/programs/main.st` (pompa, serbatoio, allarme di livello) e
  `devices/servers/{modbus,s7,opcua}.json` (i tre server). La cartella `build/` non c'è: la rifà `compile`.
- `cli.sh` — lancia la CLI dell'Editor senza testa. Va messo accanto all'AppImage estratto
  (`OpenPLC-Editor-4.3.2.AppImage --appimage-extract`), e toglie `ELECTRON_RUN_AS_NODE` dall'ambiente.
- `mb.py` (Modbus a socket nudi, porta 1502) e `incrocio.py` (OPC UA scritto, S7 letto; vuole `asyncua` e
  `python-snap7` in un venv).

Il giro che ha funzionato:

```bash
./cli.sh compile "$PWD/impianto" --target "OpenPLC Runtime v4"
(cd "impianto/build/OpenPLC Runtime v4/src" && zip -qr ../../../../program.zip .)
podman run -d --name oplc-prova -p 18443:8443 -p 1502:502 -p 10102:102 -p 14840:4840 \
  ghcr.io/autonomy-logic/openplc-runtime:latest
# poi, su https://127.0.0.1:18443 (IPv4: su ::1 l'handshake cade):
#   POST /api/create-user, POST /api/login → JWT, POST /api/upload-file (program.zip),
#   GET /api/compilation-status fino a SUCCESS, GET /api/start-plc
```

Mappa degli indirizzi: `%QX0.0` comando_marcia, `%QX0.1` pompa_in_marcia, `%QX0.2` allarme_livello (coil 0-2, DB2
bit 0-2); `%QW0` livello, `%QW1` soglia_alta, `%QW2` portata (holding 0-2, DB1 byte 0/2/4); OPC UA
`ns=2;s=impianto.<variabile>`.

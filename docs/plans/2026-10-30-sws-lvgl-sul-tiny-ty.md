# SWS solo LVGL sui Tiny TY (RV1106, 256 MB)

**Piano d'analisi, da iniziare dopo il 04-11-2026** (indicazione del maintainer). Nato il
30-10-2026 da una richiesta del maintainer: «cosa dovremmo fare per avere una versione di SWS solo
LVGL (non può girare un browser sul device) che possa girare su questo dispositivo». Le misure qui
sotto sono state prese quel giorno su un TY570-1AD-P1 in ufficio (`pixsys@192.168.1.65`, indirizzo
che cambia: chiedere prima di entrare).

I passi 1-3 sono abbastanza chiari da costruire. I passi 4 e 5 hanno decisioni aperte: **quando si
arriva lì, il primo passo è una sessione di plan dedicata a quel punto.**

## La famiglia

Pagina prodotto: <https://www.pixsys.net/solutioni-oem/tiny-ty-hmi-soft-plc>. Stesso processore
per tutti i modelli, cambiano schermo e porte.

| Modello | Schermo | Seriale | Ethernet |
|---|---|---|---|
| TY550-1AD-P1 | 5" capacitivo 800×480 | RS485 + CAN su morsetto | 1 |
| TY750-1AD-P1 | 5" resistivo 800×480 | RS485 + CAN su morsetto | 1 |
| TY750-2AD-P1 | 5" resistivo 800×480 | RS485 su RJ45 | 1 |
| TY570-1AD-P1 | 7" capacitivo 1024×600 | RS485 + CAN su morsetto | 2 |
| TY770-1AD-P1 | 7" resistivo 1024×600 | RS485 + CAN su morsetto | 2 |
| TY770-2AD-P1 | 7" resistivo 1024×600 | RS485 su RJ45 | 1 |

Tutti: 12-24 VDC, 6 VA, Rockchip single-core 1,2 GHz, 256 MB, una USB 2.0.

## Com'è fatto il dispositivo (misurato il 30-10-2026)

| Cosa | Valore |
|---|---|
| SoC | **RV1106G3** (`rockchip,rv1106g3`, scheda `Pixsys_TYx70`), un core **Cortex-A7**, `armv7l` hard-float con NEON |
| RAM | 235 MB visibili, **179 MB disponibili** a riposo; swap 100 MB in `/userdata/swapfile` |
| Sistema | **Ubuntu 22.04.5 armhf** — glibc 2.35, systemd 249, kernel 5.10. Non è Yocto né PixsysOS |
| Disco | rootfs ext4 scrivibile, 4,5 GB liberi; `/oem` 400 MB, `/userdata` 120 MB |
| Strumenti | `apt`, `gcc`, `sudo` senza password, `python3.10` con `libpython3.10.so`. **Niente podman** |
| Schermo | DRM `card0`, connettore `DPI-1` 1024×600 collegato; `/dev/fb0` 32 bpp, stride 4096 |
| Touch | ILITEK USB HID multitouch (`event0`); driver TSC2007 resistivo caricato (`event2`); `ts_calibrate` in `/usr/local/bin` |
| Campo | `/dev/ttyCOM1` → `ttyS4` (RS485), `can0`, `eth0` + `eth1` |
| Pixsys | CODESYS, LogicLab (`LLExec`), server OPC-UA `alopcuas`: installati, **spenti** quel giorno. `tyx_panelcontrol` sempre acceso |

**`tyx_panelcontrol` è un'app LVGL 9** statica, che disegna su `/dev/fb0`, con 7,6 MB di RSS. LVGL
su questo chip è già provato, da Pixsys. Parte da `/etc/rc.local`: se all'avvio si tocca lo
schermo parte con `gui` (setup); se no parte senza argomenti, ma tiene aperto `/dev/fb0` lo stesso.

## Il verdetto

- **La RAM basta.** Sul WP630 il runtime occupava 9,8 MB e il viewer 19 MB (STATUS, 10-09-2026).
  Anche con un progetto vero e gli script Python si resta intorno a 50-70 MB su 179. Da misurare
  con CODESYS acceso.
- **Il limite è la CPU**: un core lento, da dividere con il PLC quando il cliente lo usa.

## Il collo di bottiglia: la copia sullo schermo

Il ciclo DRM del viewer (`sws-lvgl-viewer/src/main.rs`, intorno alla riga 1640) copia e converte
**tutto lo schermo a ogni giro di 16 ms, anche fermo**: LVGL disegna in RGB565 (`LV_COLOR_DEPTH
16`), `sws_flush_cb` converte in un buffer RGB888, `copy_frame_rgb888` lo copia, e
`DrmDisplay::flush_rgb888` lo riscrive in XRGB8888 un byte alla volta. Sul WP630 la copia costava
già 23 ms su 35 per fotogramma ([dove se ne va il
tempo](../archive/2026-10-26-dove-se-ne-va-il-tempo.md); il rimedio è in `Appunti.txt`).

Misura sul TY570 con un programma C `-O2`, 1024×600, media su 30 giri:

| Passo | ms per fotogramma |
|---|---|
| RGB565 → RGB888 (il flush di LVGL) | 7,0 |
| memcpy di 1,8 MB (`copy_frame_rgb888`) | 2,7 |
| RGB888 → XRGB byte per byte, in RAM | 9,0 |
| RGB888 → XRGB byte per byte, su `/dev/fb0` | 6,7 |
| memcpy di 2,4 MB su `/dev/fb0` | 3,1 |

Così com'è oggi, il viewer spenderebbe **10-12 ms ogni 16 solo per stare fermo**: il 60-70 % del
core, prima che LVGL disegni e prima del runtime e del PLC. Qui il rimedio non è più rimandabile.

## Cosa fare

1. **Compilare per armv7.** Target `armv7-unknown-linux-gnueabihf` e un builder nuovo con il
   sysroot di **Ubuntu 22.04 armhf**. Non si copia il builder aarch64
   (`deploy/container/Containerfile.aarch64-cross.builder`): usa Ubuntu 24.04, glibc 2.39, e un
   binario costruito lì non parte su glibc 2.35. Servono un `PYO3_CONFIG_FILE` per python3.10 armhf
   e il bindgen di LVGL e libdrm con `--target=armv7`. `ring` e `rusqlite` reggono armv7. Le
   sorprese a 32 bit (`usize`, `time_t` a 32 bit su glibc 2.35) si vedono solo compilando. Primo
   passo concreto: provare la build in un worktree.

2. **Rifare la copia sullo schermo nel viewer** (`drm_display.rs`, `lvgl_display.rs`):
   `LV_COLOR_DEPTH 32`, così il formato è già quello del buffer DRM; `flush_cb` scrive solo le
   zone cambiate, direttamente nel buffer DRM; via il buffer intermedio RGB888 (3,6 MB); se LVGL
   non ha disegnato, niente copia e un sonno più lungo. Atteso: CPU quasi a zero a pagina ferma.
   Ne guadagnano anche il WP630 e gli altri pannelli LVGL. Misurare sul TY570 con CasaDomotica.

3. **Installare con systemd, senza container.** Partire da `deploy/generic-linux/install.sh`,
   adattato ad armhf. Podman di Ubuntu 22.04 (3.4) non ha i quadlet e costerebbe RAM. Nelle unit:
   **il PLC deve vincere** — `CPUWeight` e `Nice` più bassi del PLC, `OOMScoreAdjust` più alto per
   SWS (sotto pressione si sacrifica SWS, non CODESYS), un `MemoryMax` per runtime e viewer.

4. **Aggiornamenti senza registry** *(decisione — sessione di plan)*. Oggi l'aggiornamento legge i
   tag del registry (`versioni_dopo` in `sws-web/src/aggiornamento.rs`) e `NOVITA.yaml` viaggia
   come etichetta dentro l'immagine. Senza container non c'è né l'uno né l'altro. Serve un
   pacchetto (tarball o `.deb`) che porti dentro le sue note, e un modo per sapere quali versioni
   esistono.

5. **Chi possiede lo schermo** *(decisione — con Pixsys)*. `tyx_panelcontrol` tiene `/dev/fb0`
   sempre. Proposta: SWS disegna l'applicazione, il panelcontrol resta per il setup all'avvio. Serve
   un aggancio da parte di Pixsys, come il launcher D-Bus su PixsysOS; senza, i due programmi si
   contendono il DRM.

6. **Il touch.** Sul capacitivo si legge l'ILITEK: `touch_indev.rs` legge `ABS_X`/`ABS_Y`, va
   solo scalato a 1024×600 (usare `/dev/input/by-path`, non `eventN`). Sui resistivi (TY750,
   TY770; TSC2007) serve la calibrazione tslib: `ts_calibrate` c'è, `ts-uinput` da verificare.

7. **Piccole cose.** Fra viewer e runtime, in locale, HTTP semplice invece di TLS (con un core è un
   costo inutile; oggi il default è `https://127.0.0.1:7443`). Nell'editor, preset di risoluzione
   800×480 e 1024×600. Per leggere il PLC che gira accanto bastano Modbus TCP su localhost o l'OPC-UA
   di LogicLab.

## Cosa non cambia

L'architettura dell'[ADR 0002](../adr/0002-lvgl-rendering-engine.md) regge: viewer e runtime
restano due processi che parlano via WebSocket. Unirli (opzione B) si riconsidera solo se le misure
sul dispositivo lo chiedono. Il viewer web resta raggiungibile da PC o telefono sulla 7443.

## Ordine

1. Prova di build armv7 in un worktree.
2. Copia sullo schermo rifatta, misura della CPU sul TY570.
3. Installazione systemd con le priorità rispetto al PLC.
4. Domanda a Pixsys sullo schermo.
5. Canale di aggiornamento senza registry.

Stima: i passi 1-3 in 2-3 sessioni; il 5 è un piano a sé.

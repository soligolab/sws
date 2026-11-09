# L'occhio sui campi password, in tutti gli ambienti

> **Stato: fatto il 09-11-2026, in collaudo nella 2.26.0-rc.10** (sezione «Stato» in fondo). Era
> previsto **dopo** il [viewer leggero](2026-11-09-viewer-leggero.md), che passava davanti per la
> regola «un'anomalia che rovina l'uso passa davanti» (`CLAUDE.md`); il ramo è annidato su quello.

## Cosa ha chiesto il maintainer

«Nei campi password servirebbe il pulsante dell'occhio per commutare tra hide e show della
password.» E sul dove: «serve anche sul viewer davanti al pannello, perché è proprio con l'uso del
touch e della tastiera a schermo che è facile sbagliare password. È l'utente che fa show quando è in
condizioni di sicurezza. E anche su LVGL: l'esigenza è unificata a tutti gli ambienti.»

## Decisioni (09-11-2026)

- **Ovunque**: IDE, console, viewer web del pannello, viewer LVGL. Stesso comportamento.
- **Nascosta all'inizio.** L'occhio la mostra, un secondo tocco la nasconde. Chiusa la finestra,
  la volta dopo riparte nascosta.
- **Un valore già salvato e mascherato dal server** (per esempio «••••» di una chiave) resta quello:
  l'occhio mostra solo quello che si è scritto.
- **L'aspetto**: un'icona dell'occhio (aperto / barrato) dentro il campo, a destra, grande
  abbastanza per il dito sul touch; la stessa icona su web e LVGL (scelta del maintainer, 09-11).
- **Il collaudo** è nella 2.26.0-rc.10, insieme al viewer leggero (scelta del maintainer, 09-11).

## La misura (09-11-2026)

- **Web**: 33 `type="password"` scritti a mano in 22 file, più i tre `type={…}` di
  `FinestraAvviso.tsx:207` (i campi password di `chiedi`/`modulo`, per esempio la password dei
  comandi critici del viewer), di `LoginScreen.tsx` e degli altri moduli. I più fitti:
  `NotificationsTab.tsx` (4), `ChangePasswordScreen.tsx` (3).
- **LVGL**: due posti in `sws-lvgl-viewer/src/lvgl_render.rs` — la tastiera a schermo con il campo
  password (`apri_tastiera`, :8199, `lv_textarea_set_password_mode` a :8220) e la finestra di login
  (`campo(y, true, "")`, :8423-8433 e :8497). Da verificare se i font del pannello hanno i simboli
  `LV_SYMBOL_EYE_OPEN`/`EYE_CLOSE`; altrimenti un'icona disegnata.

## I passi

1. **`CampoPassword`** in `sws-editor/src/components/`: l'`input` più il bottone dell'occhio dentro
   il campo, a destra; `aria-label` e `title` tradotti («Mostra la password» / «Nascondi la
   password»), `aria-pressed`; il bottone non ruba il fuoco al campo e non invia il modulo (è
   `type="button"`). Le stesse prop di un `input`, così la sostituzione è meccanica.
2. **La sostituzione** nei 22 file e in `FinestraAvviso` (il campo di `chiedi` con `password`).
3. **La guardia** `scripts/check_campi_password.sh` (nel modello di `check_campi_numerici.sh`): un
   `type="password"` fuori da `CampoPassword` fa fallire `check_static.sh`.
4. **LVGL**: un bottone con l'occhio accanto al campo password, nei due posti; il tocco commuta
   `lv_textarea_set_password_mode`. Il campo torna nascosto quando la finestra si chiude.
5. **Test**: il componente (parte nascosto, l'occhio commuta, Invio invia ancora il modulo, il tasto
   non è un submit); un test per LVGL sulla commutazione, se il banco LVGL lo permette.
6. CHANGELOG, NOVITA (it/en), il manuale dove descrive il login. CasaDomotica: si vede da sé al
   primo login.

## Collaudo

- IDE: login, cambio password, utenti, connessione al dispositivo: l'occhio c'è e commuta.
- Viewer sul pannello (touch e tastiera a schermo): login per l'aggiornamento e password di un
  comando critico.
- LVGL sul pannello: login e password con la tastiera di LVGL.

Le voci, una per una, sono in `docs/COLLAUDI_IN_SOSPESO.md`, «L'occhio sulle password (09-11-2026)».

## Stato (09-11-2026)

**Fatto**, ramo `feat/occhio-password` annidato su `fix/ridisegno-mirato`: `6017a2cb` (`CampoPassword`
e le sue prove), `a833caec` (l'occhio LVGL sulla tastiera e sul login), `6b152483` (i 36 campi in 22
file e la guardia); poi le correzioni delle due revisioni avversarie: `0bfa610b` (si richiude
all'invio del modulo e quando il valore si svuota; via `aria-pressed`), `5a109698` (la guardia vede
apici singoli, template literal, attributo a capo e `type:` negli oggetti di prop, e si prova da sé
su otto evasioni), `dfba9833` (LVGL: i raster dell'occhio una volta per misura, prima ~6 KB persi a
ogni login). In collaudo nella 2.26.0-rc.10.

Rispetto ai passi: il passo 1 prevedeva `aria-pressed`, tolto in revisione — per un mostra/nascondi
si tiene l'etichetta che cambia **oppure** `aria-pressed`, non tutt'e due; il passo 4 vale per il
login, mentre la tastiera LVGL in modalità password oggi non ha chiamanti e il suo occhio dal
pannello non si vede; il manuale (passo 6) non è stato toccato. CasaDomotica: si vede da sé al primo
login, niente da aggiungere al progetto.

**Cosa guardare a schermo**: l'occhio a destra dentro il campo, grigio `#94a3b8`, aperto quando la
password è nascosta e barrato quando si legge; 40×40 px anche sui campi bassi, dove sporge sopra e
sotto senza fondo; il testo si ferma prima dell'occhio; su LVGL un fondo scuro mentre il dito preme.

**Punti aperti, da decidere col maintainer**

- L'occhio sta nell'ordine del Tab, e Invio su di lui commuta invece di inviare il modulo. È il
  comportamento normale di un bottone; se si preferisce che Tab passi dal campo al pulsante del
  modulo, basta `tabIndex={-1}` sull'occhio (resta raggiungibile col mouse e col dito).
- La sentinella «********» (`MASCHERA_SERVER`, otto asterischi) è la stessa con cui il server
  maschera un segreto salvato: una password vera di otto asterischi verrebbe presa per mascherata e
  avrebbe l'occhio spento. È lo stesso caso di confine che il server ha già.
- Un campo nuovo senza `width` nello stile esce ~32 px più largo dei vicini (il contenitore si
  stringe sul campo, che ha 40 px di padding a destra): oggi non succede, tutti i 36 hanno `width`
  o `flex: 1`, ed è scritto nel docstring del componente.

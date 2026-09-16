# T-71 — un selettore di caratteri speciali, con le emoji vere anche su LVGL

## Contesto

Richiesta del maintainer, nata mentre collaudava il multilingua (15-09-2026): nelle stringhe di
progetto compaiono spesso simboli come 🏠 ☀ ⚡ 🔐, e un utente inesperto deve poterli scrivere
senza importare un'immagine. Misurato lo stesso giorno: il pannello LVGL disegna col font
DejaVu Sans, che copre il Piano Multilingue di Base (☀ U+2600, ⚡ U+26A1 — si vedono) ma non le
emoji vere da U+1F300 in su (🏠, 🔐 — **non si vede niente**, LVGL senza glifo non disegna un
placeholder). Il 16-09-2026 il maintainer ha scelto esplicitamente: le emoji vere devono
funzionare **anche sul pannello**, non solo sul web — la strada più semplice (selettore che
avvisa "questo non si vede su LVGL") è stata scartata.

Tre pezzi, in quest'ordine — un ramo alla volta, chiudi-mergia-elimina prima del successivo:

## Fase B (per prima) — un secondo font per LVGL, con fallback automatico

**La scoperta che semplifica tutto**: LVGL supporta nativamente il fallback fra font — il campo
`fallback` di `lv_font_t` (`vendor/lvgl-sys-0.6.2/vendor/lvgl/src/font/lv_font.h:80`, risolto
ricorsivamente in `lv_font.c:92`) è già nei binding vendorizzati. Non serve costruire una
sostituzione di glifo a mano: si carica un secondo font FreeType e lo si aggancia come fallback
del primo. `lv_freetype_init(8, 8, 32*1024)` (`lvgl_font.rs:80`) apre già fino a 8 facce — oggi
ne usa una sola (DejaVu, a più corpi via `PER_CORPO`/`at_size`), quindi c'è spazio.

**Il font da usare è "Noto Emoji" (monocromo/outline), non "Noto Color Emoji"**: LVGL/FreeType
qui disegna contorni, non bitmap a colori — un font emoji a colori non renderebbe affatto.
Vantaggio collaterale misurabile: la variante monocroma pesa qualche MB, non le "decine di MB"
temute in `STATUS.md` (quella stima era per la versione a colori) — su un pannello industriale
monocromatico va bene comunque.

**Cosa cambia in `lvgl_font.rs`**:
- Nuova funzione `load_emoji(size_px)`, stesso schema esatto di `load()` (righe 73-106): stessa
  `lv_ft_info_t`, path candidati diversi (font vendorizzato nel repo, vedi sotto).
- `at_size(px)` (righe 134-170) apre oggi una sola faccia DejaVu per corpo; deve aprirne anche
  una emoji allo stesso corpo e collegarla: `(*(font as *mut lv_font_t)).fallback = emoji_font`,
  prima di restituire il font DejaVu a chi chiama. Stesso raw-pointer pattern già in uso, non un
  meccanismo nuovo.
- Se il font emoji non si trova (percorso assente): nessun fallback agganciato, comportamento
  identico a oggi (niente regressione) — stesso schema di degradazione già usato per DejaVu
  assente → Montserrat.

**Font vendorizzato nel repo**: `sws-runtime/crates/sws-lvgl-viewer/assets/fonts/
NotoEmoji-Regular.ttf` (licenza OFL, da github.com/googlefonts/noto-emoji) — stesso principio dei
font di test già vendorizzati in `lvgl-sys` (`arial.ttf` 311 KB, `korean.ttf` 3.3 MB), quindi
coerente con quanto il repo già porta. Percorso aggiunto sia ai candidati locali (per test su
questa macchina, nessun device) sia a un percorso device (`deploy/yocto/install.sh` lo copia,
stesso trattamento di quanto già installato lì) — più `SWS_LVGL_EMOJI_FONT` come override,
speculare a `SWS_LVGL_FONT`.

**Verifica senza hardware**: `sws-lvgl-viewer` gira già in locale via SDL2
(`--backend sdl2`, il default — `Cargo.toml:33`, `main.rs:51-55`), quindi il fallback si collauda
con uno screenshot della finestra SDL su questa macchina, senza toccare un pannello reale.

## Fase A — proteggere i simboli scelti dalla traduzione automatica

`sws-core::traduzione` (Fase 3/4 del multilingua) già isola i segnaposto di formato
(`segnaposti()`, riga 18; `segmenta()`, riga 74; `Pezzo::Testo`/`Pezzo::Segnaposto`) perché un
fornitore di traduzione automatica può alterarli o perderli — esattamente il rischio di
un'emoji scelta dall'utente dentro una frase ("Pompa 🔧 avviata"), non protetta oggi.

- Estendere `segnaposti()` a riconoscere anche i caratteri del catalogo (Fase C) come un
  `Pezzo::Segnaposto` a sé, non mandato al traduttore (`da_mandare()`, riga 96) — stesso
  meccanismo, non uno nuovo.
- Nessun equivalente TS esiste oggi (`resolveMsg` in `projectI18n.ts` gestisce solo `{{key}}`):
  la protezione riguarda solo la traduzione automatica (Rust), la resa a schermo non serve
  toccarla.
- Test nuovi in `sws-core` (stesso file dei test di `traduzione.rs`): un'emoji del catalogo dentro
  una frase sopravvive a `segmenta()`/`da_tradurre()` intatta.

## Fase C — il selettore nell'editor

**Riuso, non invenzione**: `SymbolGallery`/`SymbolPickerModal` in `EditorShell.tsx` (righe 78-149,
151-198) sono già il pattern esatto — griglia cliccabile in overlay, tastiera (Enter/Esc),
conferma/annulla. Si costruisce un `CharacterPickerModal` sullo stesso schema, non un componente
nuovo da zero.

**Catalogo curato, non tastiera Unicode libera** — coerente con l'indicazione del maintainer
("raggruppati per uso... non per blocco Unicode") e con la richiesta di semplicità PoC: un elenco
fisso in `sws-editor/src/i18n/catalogoCaratteri.ts` (nuovo file), raggruppato per categoria
(stati, allarmi, energia, frecce, misure, +una categoria "altro" per i simboli BMP come ☀/⚡ già
in uso oggi). Punto di partenza: i 18 emoji già misurati nei template (🌀🌙🌡🍳🎨🏠💡💧📈🔋🔌🔍
🔐🔒🗂🤖🦟🪟, dalla misura del 16-09) più i simboli BMP esistenti (☀ ⚡ ⚠ ⚙) — tutti garantiti dal
font emoji scelto in Fase B, quindi **niente avviso "non si vede su LVGL" per voce**: il catalogo
è per costruzione quello che i due motori sanno disegnare insieme.

**Aggancio a `CampoTestoTradotto.tsx`**: oggi è un `<input>` nudo (righe 107-123), nessuno slot
per un bottone accanto — va avvolto in un contenitore (`<div style={{display:"flex"}}>`) con
l'input + un'icona che apre il modal. L'inserimento avviene alla posizione del cursore
(`selectionStart`/`selectionEnd` sul ref dell'`<input>`), non in coda — un utente che sceglie un
simbolo a metà frase se lo aspetta lì.

**Test nuovi** in `sws-editor/tests/`: apertura del modal, selezione di una voce, inserimento a
cursore (non in coda), e che il valore risultante passi comunque dalla pipeline esistente di
`CampoTestoTradotto` (i 7 test attuali in `campoTestoTradotto.test.tsx` restano tutti verdi).

## File coinvolti, per fase

- **B**: `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_font.rs`, nuovo asset
  `sws-lvgl-viewer/assets/fonts/NotoEmoji-Regular.ttf`, `deploy/yocto/install.sh`.
- **A**: `sws-runtime/crates/sws-core/src/traduzione.rs` e i suoi test.
- **C**: nuovo `sws-editor/src/i18n/catalogoCaratteri.ts`, nuovo `CharacterPickerModal` in
  `sws-editor/src/editor/EditorShell.tsx` (o file dedicato se cresce), `CampoTestoTradotto.tsx`,
  nuovi test in `sws-editor/tests/`.

## Verifica, per ogni fase

Ciclo pieno di `CLAUDE.md`: branch dedicato, `cargo check/test/clippy/fmt --workspace` **e**
`pnpm build/test` **e** `./scripts/check_static.sh` verde, conferma esplicita del maintainer,
squash-merge, verifica `main^{tree}` == `<ramo>^{tree}`, `git branch -D`. Push solo su richiesta
esplicita.

- **B**: screenshot della finestra SDL2 locale (`sws-lvgl-viewer --backend sdl2`) con un progetto
  di prova che porta un'emoji del catalogo in un `text` — deve disegnarsi, non restare vuoto.
  Nessun test automatico nuovo previsto (rendering visivo): la guardia è lo screenshot.
- **A**: `cargo test -p sws-core` — nuovo caso con emoji dentro frase, verificato non tradotto.
- **C**: `pnpm test` — nuovi casi del modal, più i 7 esistenti di `CampoTestoTradotto` invariati.

## Cosa NON fare in questa sessione

- Non un selettore Unicode libero/completo — solo il catalogo curato.
- Non il font a colori (Noto Color Emoji) — non renderebbe su LVGL/FreeType, si usa la variante
  monocroma.
- Non toccare `restore_symbols_on`/i simboli privati di `lv_keyboard` (righe 189-213) — restano
  come sono, non è lo stesso problema.
- Non aumentare `lv_freetype_init`/`LV_FREETYPE_CACHE_SIZE` preventivamente — solo se la verifica
  di Fase B mostra che serve (misurare, non ipotizzare, come nel resto di questa sessione).
- Se emerge una decisione architetturale non prevista: non deciderla, annotarla in
  `docs/OPEN_QUESTIONS.md` e proseguire col default PoC dichiarato qui.

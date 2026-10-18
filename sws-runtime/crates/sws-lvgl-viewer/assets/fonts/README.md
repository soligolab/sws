# Font vendorizzati per il pannello LVGL

## `NotoEmoji-Regular.ttf`

Font emoji **monocromo/outline** (non "Noto Color Emoji", che LVGL/FreeType
non renderebbe — qui si disegnano contorni, non bitmap a colori). Usato come
`fallback` di DejaVu Sans in `../src/lvgl_font.rs` per far apparire le emoji
vere (U+1F300 e oltre) sul pannello fisico — T-71, 2026-09-16.

- **Fonte**: [github.com/google/fonts](https://github.com/google/fonts),
  `ofl/notoemoji/NotoEmoji[wght].ttf` (font variabile, asse `wght`).
- **Licenza**: SIL Open Font License 1.1 — testo completo in
  `NotoEmoji-OFL.txt`, scaricato dallo stesso percorso.
- **Non è un pacchetto apt** (a differenza di `fonts-dejavu-core`, installato
  via `apt-get` nel Containerfile): va vendorizzato e imbarcato a mano nel
  container LVGL, vedi `scripts/build_container.sh` e
  `deploy/container/Containerfile.aarch64`.

## I font dell'elenco (18-10-2026)

L'elenco dei font di SWS è `tests/fixtures/font.json`, uguale nel browser e sul pannello. Sans, Mono e Serif sono i
DejaVu di `fonts-dejavu-core`, già nell'immagine; qui ci sono solo quelli che apt non porta.

| File | Famiglia | Fonte | Licenza |
|---|---|---|---|
| `DSEG7Classic-Regular.ttf`, `DSEG7Classic-Bold.ttf` | `segmenti7` | [keshikan/DSEG](https://github.com/keshikan/DSEG) v0.46, `fonts-DSEG_v046.zip` | SIL OFL 1.1, `DSEG-LICENSE.txt` |
| `DSEG14Classic-Regular.ttf`, `DSEG14Classic-Bold.ttf` | `segmenti14` | come sopra | come sopra |
| `DotGothic16-Regular.ttf` | `matrice` | [google/fonts](https://github.com/google/fonts), `ofl/dotgothic16/` | SIL OFL 1.1, `DotGothic16-OFL.txt` |

DotGothic16 è **ridotto** ai caratteri latini, alla punteggiatura e ai simboli tecnici (da 2 MB a 125 KB) con
`pyftsubset`; l'originale porta migliaia di ideogrammi che un pannello non usa. Gli stessi intervalli Unicode valgono
per i `.woff2` del browser in `sws-editor/public/fonts/`:

    U+0020-007E,U+00A0-00FF,U+0100-017F,U+0391-03C9,U+2010-205E,U+20A0-20CF,U+2100-214F,
    U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2500-25FF,U+2600-26FF,U+2700-27BF

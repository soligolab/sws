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

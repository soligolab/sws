# SWS symbol library — vendored SVG attribution

Files in this directory are loaded by the editor at runtime when an
object's `symbol_id` resolves to a `SymbolMeta` with `kind: "vendored"`.
Vite copies the whole `public/symbols/` tree into `dist/` at build time
so the production bundle ships them too.

For every file we keep one record below: the author, the source, and
the license. **Drop new SVGs into this directory and add a matching
record** — without one the editor will still render them, but the
project loses its right to redistribute under the file's licence.

## Currently shipped

| File                  | Author / source                              | Licence  |
| --------------------- | -------------------------------------------- | -------- |
| `heat_exchanger.svg`     | SWS project (original, drawn for this PoC)                             | CC0 1.0     |
| `separator.svg`          | SWS project (original, drawn for this PoC)                             | CC0 1.0     |
| `reactor.svg`            | SWS project (original, drawn for this PoC)                             | CC0 1.0     |
| `filter.svg`             | SWS project (original, drawn for this PoC)                             | CC0 1.0     |
| `solar-panel.svg`        | Pictogrammers / MaterialDesign — `mdi-solar-panel` — downloaded 2026-05-16 from github.com/Templarian/MaterialDesign | Apache 2.0 |
| `solar-power-variant.svg`| Pictogrammers / MaterialDesign — `mdi-solar-power-variant` — downloaded 2026-05-16 | Apache 2.0 |
| `battery-charging-high.svg` | Pictogrammers / MaterialDesign — `mdi-battery-charging-high` — downloaded 2026-05-16 | Apache 2.0 |
| `transmission-tower.svg` | Pictogrammers / MaterialDesign — `mdi-transmission-tower` — downloaded 2026-05-16 | Apache 2.0 |
| `home-lightning-bolt.svg`| Pictogrammers / MaterialDesign — `mdi-home-lightning-bolt` — downloaded 2026-05-16 | Apache 2.0 |
| `garage-open-variant.svg`| Pictogrammers / MaterialDesign — `mdi-garage-open-variant` — downloaded 2026-05-16 | Apache 2.0 |
| `window-open-variant.svg`| Pictogrammers / MaterialDesign — `mdi-window-open-variant` — downloaded 2026-05-16 | Apache 2.0 |
| `roller-shade.svg`       | Pictogrammers / MaterialDesign — `mdi-roller-shade` — downloaded 2026-05-16 | Apache 2.0 |

## Adding files from third-party sources

When importing from Wikimedia Commons or similar repositories:

1. **Confirm the file's licence** is one of the AGPL-3.0-compatible set:
   CC0, CC-BY (any version, attribution required), Apache-2.0, MIT, BSD,
   the WTFPL, or public-domain dedications. Reject CC-BY-NC, CC-BY-ND,
   "free for personal use", and anything proprietary.
2. **Record the source URL, the author, and the licence** in the table
   above. CC-BY requires attribution to be ship-with-the-binary — that's
   why this file exists in `public/` and not in `docs/`.
3. **Strip any embedded fonts or external `xlink:href`** so the SVG
   renders without a network round-trip.

## Why we don't tint vendored SVGs

The canvas treats vendored symbols as immutable images and paints a
small coloured badge over the top-right corner to convey state
(`state_tag` / `alarm_tag` on the object). Tinting the source via CSS
filters or DOM surgery would constitute a derivative work in some
licence interpretations (notably some CC-BY-SA cases) and the PoC
prefers the simpler contract.

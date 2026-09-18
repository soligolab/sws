# SWS symbol library — vendored SVG attribution

Files in this directory are loaded by the editor at runtime when an
object's `symbol_id` resolves to a `SymbolMeta` with `kind: "vendored"`.
Vite copies the whole `public/symbols/` tree into `dist/` at build time
so the production bundle ships them too.

For every file we keep one record below: the author, the source, and
the license. **Drop new SVGs into this directory and add a matching
record** — without one the editor will still render them, but the
project loses its right to redistribute under the file's licence.

**2026-09-13 (Q40)**: every file once listed here was retired and removed.
`state_on_color` had no effect on any of them (measured, both engines): a
static raster can't recolour with state. The four SWS-original files
(`heat_exchanger`, `separator`, `reactor`, `filter`) and the seven MDI
icons (`solar-panel`, `battery-charging-high`, `transmission-tower`,
`home-lightning-bolt`, `garage-open-variant`, `window-open-variant`,
`roller-shade`) are now `kind: "builtin"` JSX in `library.tsx` — stylised
redraws for the seven MDI ones (their compound paths, with cutouts/holes,
weren't a same-afternoon faithful port), one-part-recolours-for-real for
the four SWS ones. `symbols/library.tsx` and `sws-runtime/…/svg_assets.rs`
both carry the "Q40" note where these moved.

**Confirmed by the maintainer, 2026-09-15** (template review, question that
implementation-time judgment alone couldn't settle): the seven MDI-derived
redraws are original stylised icons, not traced from the source — not
derivative works, so no MDI attribution is owed for them. `casa-locale/
CREDITS.md`, the template that used to carry that attribution, was
rewritten accordingly — and on 2026-09-18 that template left the park
altogether (it was the maintainer's own house; it lives on as his local
project). The decision stands on its own here. An eighth pre-Q40 file this attribution once covered,
`solar-power-variant.svg`, was never converted and had become an orphan
(unreferenced by any `symbol_id`) — removed in the same pass.

## Currently shipped

Nothing, as of 2026-09-13 — `VENDORED` (`svg_assets.rs`) and every
`kind: "vendored"` entry in `library.tsx` are both empty. This file and
its licence-tracking rule stay: the day a symbol arrives that nobody wants
to hand-draw (a faithful brand logo, a complex third-party pictogram), it
lands here again, vendored, with a row below.

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

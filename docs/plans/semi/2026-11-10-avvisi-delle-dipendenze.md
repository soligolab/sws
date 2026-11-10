# Gli avvisi delle dipendenze, nell'immagine e nella SPA (seme)

> **Stato: seme — decisione.** Nato il 10-11-2026 dalla decisione sulla licenza (doppia, AGPL-3.0 o commerciale,
> seme archiviato [`2026-10-29-licenza-del-software.md`](../../archive/2026-10-29-licenza-del-software.md)). Il brief
> preparato per quella sessione elencava alcuni lavori che **non dipendono dalla licenza scelta**: valgono già oggi, con
> qualunque licenza, e non sono stati fatti insieme al cambio. **Quando questo lavoro comincerà, il primo passo è una
> sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.**

## Cosa c'è (10-11-2026)

- Dalla 2.26.0 l'immagine porta `LICENSE` e `LICENSING.md` in `/usr/share/sws/licenza/`. **Non porta** gli avvisi delle
  dipendenze: né `third-party/licenses/` (Apache-2.0, CC0, MIT), né le licenze dei crate Rust e dei pacchetti npm
  compilati dentro il binario e la SPA. La SPA servita dal cloud non ne porta nessuno.
- Le licenze delle dipendenze sono tutte permissive, tranne 10 crate **MPL-2.0** (`async-opcua` ×9, `serialport`):
  copyleft per file, compatibile con le due licenze di SWS, ma il testo MPL e l'indicazione di dove sta il loro sorgente
  vanno consegnati. MDI è Apache-2.0: vuole il suo `NOTICE`.
- `NotoEmoji-Regular.ttf` sta in `sws-editor/public/fonts/` senza il suo `NotoEmoji-OFL.txt` accanto (c'è solo nel
  percorso del pannello).
- `DotGothic16` che usiamo è un **sottoinsieme** del font, cioè un font modificato: va verificato se ha un Reserved Font
  Name che ci obbliga a cambiargli nome.
- Il `Cargo.toml` vendorizzato di `s7` non dichiara `license` (il codice è BSD-3-Clause).
- Si genera un SBOM, ma nessuno lo legge; nessuna guardia ferma una dipendenza con una licenza non ammessa. La specifica
  promette anche un SBOM per npm.

## L'idea

Un fascicolo degli avvisi (`THIRD-PARTY-NOTICES` o simile) generato a ogni build per Rust e npm, che viaggia
nell'immagine accanto a `LICENSE` e dentro `dist/` della SPA; i testi OFL accanto a ogni font; `cargo deny` (o
`cargo about`) con l'elenco delle licenze ammesse, nella CI e in `check_static.sh`. Domande per la sessione di plan:
quale strumento, dove si pubblica il fascicolo nel cloud (una pagina `/licenze`?), e come si tiene allineato a ogni
aggiornamento di dipendenze.

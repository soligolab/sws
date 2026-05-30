# Third-party assets and licenses

This directory documents all external assets bundled with SWS that originate
from third-party projects. Every file here corresponds to one upstream library
and lists: source URL, version/commit pinned, license, and which SWS files
contain that library's content.

## Quick reference

| Library | License | SWS path | Doc |
|---------|---------|----------|-----|
| Material Design Icons (Pictogrammers) | Apache 2.0 | `sws-editor/public/images/mdi/` | [mdi.md](mdi.md) |
| Equinor Engineering Symbols | MIT | `sws-editor/public/images/equinor/` | [equinor.md](equinor.md) |
| Tabler Icons | MIT | `sws-editor/public/images/tabler/` | [tabler.md](tabler.md) |
| Electrical Symbol Library (basverdoes) | CC0 1.0 | `sws-editor/public/images/electrical/` | [electrical.md](electrical.md) |

For the vendored process-engineering *symbols* used by the Symbol widget
(not the Image widget), see `sws-editor/public/symbols/ATTRIBUTION.md`.

## Adding new third-party content

1. Confirm the license is permissive (MIT, Apache 2.0, CC0, CC-BY, BSD).
   Reject CC-BY-NC, CC-BY-ND, GPL, AGPL, and "free for personal use" terms.
2. Create a `third-party/<library>.md` file following the structure of the
   existing ones.
3. Copy the license text to `third-party/licenses/<SPDX-ID>.txt` if not
   already present.
4. Add a row to the table above.
5. Include attribution in the binary if the license requires it (Apache 2.0
   requires NOTICE; CC-BY requires author credit). The `third-party/` folder
   ships with the repository and satisfies this requirement when the repo is
   the distribution medium.

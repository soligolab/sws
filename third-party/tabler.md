# Tabler Icons

| Field | Value |
|-------|-------|
| Project | Tabler Icons |
| Maintainer | Paweł Kuna (@codecalm) and contributors |
| Repository | https://github.com/tabler/tabler-icons |
| Home page | https://tabler.io/icons |
| License | MIT License |
| License file | [licenses/MIT.txt](licenses/MIT.txt) |
| Version pinned | `master` branch, downloaded 2026-05-29 |
| SPDX identifier | `MIT` |

## Files included in SWS

Image catalog: all SVG files are in `sws-editor/public/images/tabler/`.
They are served at runtime under `/images/tabler/<filename>.svg`.

A curated UI subset was downloaded (outline style): arrows, alerts, status
indicators, play/pause/stop controls, settings, lock, eye, bell, refresh, etc.

## IDE icons of the sober style

`sws-editor/src/editor/iconeIde.ts` (registry `ICONE_IDE`) holds the icons the
IDE draws in place of its emoji when the person picks the sober style. They are
copied as strings from the outline set of **Tabler Icons 3.31.0** (npm
`@tabler/icons@3.31.0`, downloaded 2026-11-16): only the ones the IDE uses, one
per line, each with its upstream name in a `// tabler: <name>` note. The MIT
licence text of that release is next to the registry, in
`sws-editor/src/editor/iconeIde.LICENSE.txt`.

## Modifications

Image catalog: none. Files are used as-is from the upstream `icons/outline/`
directory.

IDE icons: the content of each SVG is copied without its outer `<svg>` tag and
without the invisible bounding path (`<path stroke="none" d="M0 0h24v24H0z"
fill="none"/>`); the drawing itself is unchanged.

## Attribution requirement (MIT)

MIT only requires the copyright notice and license text to be included.
Both are present in `third-party/licenses/MIT.txt`.

## Copyright notice

Copyright (c) 2020-2024 Paweł Kuna

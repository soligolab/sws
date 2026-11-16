// The icons of the IDE in the sober style (plan docs/archive/2026-11-14-stile-sobrio.md,
// session 3, 16-11-2026). In the colourful style the IDE keeps its emoji; in the
// sober one `<Icona>` (components/Icona.tsx) draws these line icons instead.
//
// Same format as `iconeAttivita.ts` and `iconeStrumenti.ts`: the content of an
// SVG on a 24×24 viewBox, stroke only, colour from `currentColor`. Where a
// concept already has an activity-bar icon, that icon is reused. The others
// are copied from Tabler Icons 3.31.0 (MIT, https://tabler.io/icons, outline
// set, unchanged but for the invisible bounding path): only the ones used here.
// Each comes from
//   https://cdn.jsdelivr.net/npm/@tabler/icons@3.31.0/icons/outline/<name>.svg
// where <name> is the one in the `// tabler:` note at the end of its line; a
// new icon is added the same way, from the same version, never drawn by hand.
// Licence: `iconeIde.LICENSE.txt` next to this file, and third-party/tabler.md.

import { ICONE_ATTIVITA } from "./iconeAttivita";

/** The icons by concept name. */
export const ICONE_IDE: Record<string, string> = {
  // ── Tabler Icons (MIT) ──
  adjustments: '<path d="M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M6 4v4"/><path d="M6 12v8"/><path d="M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M12 4v10"/><path d="M12 18v2"/><path d="M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M18 4v1"/><path d="M18 9v11"/>', // tabler: adjustments
  antenna: '<path d="M20 4v8"/><path d="M16 4.5v7"/><path d="M12 5v16"/><path d="M8 5.5v5"/><path d="M4 6v4"/><path d="M20 8h-16"/>', // tabler: antenna
  archive: '<path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10"/><path d="M10 12l4 0"/>', // tabler: archive
  assistant: '<path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z"/><path d="M9.5 9h.01"/><path d="M14.5 9h.01"/><path d="M9.5 13a3.5 3.5 0 0 0 5 0"/>', // tabler: message-chatbot
  brush: '<path d="M3 21v-4a4 4 0 1 1 4 4h-4"/><path d="M21 3a16 16 0 0 0 -12.8 10.2"/><path d="M21 3a16 16 0 0 1 -10.2 12.8"/><path d="M10.6 9a9 9 0 0 1 4.4 4.4"/>', // tabler: brush
  build: '<path d="M11.414 10l-7.383 7.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l7.407 -7.385"/><path d="M18.121 15.293l2.586 -2.586a1 1 0 0 0 0 -1.414l-7.586 -7.586a1 1 0 0 0 -1.414 0l-2.586 2.586a1 1 0 0 0 0 1.414l7.586 7.586a1 1 0 0 0 1.414 0z"/>', // tabler: hammer
  certificate: '<path d="M15 15m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M13 17.5v4.5l2 -1.5l2 1.5v-4.5"/><path d="M10 19h-5a2 2 0 0 1 -2 -2v-10c0 -1.1 .9 -2 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -1 1.73"/><path d="M6 9l12 0"/><path d="M6 12l3 0"/><path d="M6 15l2 0"/>', // tabler: certificate
  chart: '<path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 20h14"/>', // tabler: chart-bar
  chat: '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z"/>', // tabler: message
  clock: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>', // tabler: clock
  cloud: '<path d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878"/>', // tabler: cloud
  container: '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/>', // tabler: box
  cpu: '<path d="M5 5m0 1a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1z"/><path d="M9 9h6v6h-6z"/><path d="M3 10h2"/><path d="M3 14h2"/><path d="M10 3v2"/><path d="M14 3v2"/><path d="M21 10h-2"/><path d="M21 14h-2"/><path d="M14 21v-2"/><path d="M10 21v-2"/>', // tabler: cpu
  cube: '<path d="M21 16.008v-8.018a1.98 1.98 0 0 0 -1 -1.717l-7 -4.008a2.016 2.016 0 0 0 -2 0l-7 4.008c-.619 .355 -1 1.01 -1 1.718v8.018c0 .709 .381 1.363 1 1.717l7 4.008a2.016 2.016 0 0 0 2 0l7 -4.008c.619 -.355 1 -1.01 1 -1.718z"/><path d="M12 22v-10"/><path d="M12 12l8.73 -5.04"/><path d="M3.27 6.96l8.73 5.04"/>', // tabler: cube
  database: '<path d="M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0"/><path d="M4 6v6a8 3 0 0 0 16 0v-6"/><path d="M4 12v6a8 3 0 0 0 16 0v-6"/>', // tabler: database
  devices: '<path d="M13 9a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-10z"/><path d="M18 8v-3a1 1 0 0 0 -1 -1h-13a1 1 0 0 0 -1 1v12a1 1 0 0 0 1 1h9"/><path d="M16 9h2"/>', // tabler: devices
  disc: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M7 12a5 5 0 0 1 5 -5"/><path d="M12 17a5 5 0 0 0 5 -5"/>', // tabler: disc
  done: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M9 12l2 2l4 -4"/>', // tabler: circle-check
  door: '<path d="M14 12v.01"/><path d="M3 21h18"/><path d="M6 21v-16a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v16"/>', // tabler: door
  download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>', // tabler: download
  eraser: '<path d="M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3"/><path d="M18 13.3l-6.3 -6.3"/>', // tabler: eraser
  euro: '<path d="M17.2 7a6 7 0 1 0 0 10"/><path d="M13 10h-8m0 4h8"/>', // tabler: currency-euro
  events: '<path d="M18 4l3 3l-3 3"/><path d="M18 20l3 -3l-3 -3"/><path d="M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5"/><path d="M21 7h-5a4.978 4.978 0 0 0 -3 1m-4 8a4.984 4.984 0 0 1 -3 1h-3"/>', // tabler: arrows-shuffle
  factory: '<path d="M4 21c1.147 -4.02 1.983 -8.027 2 -12h6c.017 3.973 .853 7.98 2 12"/><path d="M12.5 13h4.5c.025 2.612 .894 5.296 2 8"/><path d="M9 5a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1"/><path d="M3 21l19 0"/>', // tabler: building-factory
  fit: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M4 8v-2a2 2 0 0 1 2 -2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2 -2v-2"/>', // tabler: focus-centered
  flask: '<path d="M9 3l6 0"/><path d="M10 9l4 0"/><path d="M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"/>', // tabler: flask
  git: '<path d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 8l0 8"/><path d="M9 18h6a2 2 0 0 0 2 -2v-5"/><path d="M14 14l3 -3l3 3"/>', // tabler: git-branch
  home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>', // tabler: home
  hourglass: '<path d="M6.5 7h11"/><path d="M6.5 17h11"/><path d="M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1z"/><path d="M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1z"/>', // tabler: hourglass
  image: '<path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z"/><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5"/><path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3"/>', // tabler: photo
  key: '<path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z"/><path d="M15 9h.01"/>', // tabler: key
  language: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/>', // tabler: world
  link: '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>', // tabler: link
  lock: '<path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>', // tabler: lock
  mail: '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z"/><path d="M3 7l9 6l9 -6"/>', // tabler: mail
  menu: '<path d="M4 6l16 0"/><path d="M4 12l16 0"/><path d="M4 18l16 0"/>', // tabler: menu-2
  moon: '<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>', // tabler: moon
  package: '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/><path d="M16 5.25l-8 4.5"/>', // tabler: package
  panel: '<path d="M5 4a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1v-16z"/><path d="M11 17a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/>', // tabler: device-tablet
  pause: '<path d="M6 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M14 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/>', // tabler: player-pause
  pencil: '<path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/>', // tabler: pencil
  phone: '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>', // tabler: phone
  pin: '<path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>', // tabler: pin
  "plan-window": '<path d="M12 3c-3.866 0 -7 3.272 -7 7v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1v-10c0 -3.728 -3.134 -7 -7 -7z"/><path d="M5 13l14 0"/><path d="M12 3l0 18"/>', // tabler: window
  play: '<path d="M7 4v16l13 -8z"/>', // tabler: player-play
  pointer: '<path d="M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563z"/>', // tabler: pointer
  polygon: '<path d="M12 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M19 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M5 11m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M15 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M6.5 9.5l3.5 -3"/><path d="M14 5.5l3 1.5"/><path d="M18.5 10l-2.5 7"/><path d="M13.5 17.5l-7 -5"/>', // tabler: polygon
  python: '<path d="M12 9h-7a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h3"/><path d="M12 15h7a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-3"/><path d="M8 9v-4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v5a2 2 0 0 1 -2 2h-4a2 2 0 0 0 -2 2v5a2 2 0 0 0 2 2h4a2 2 0 0 0 2 -2v-4"/><path d="M11 6l0 .01"/><path d="M13 18l0 .01"/>', // tabler: brand-python
  recipe: '<path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"/><path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/><path d="M9 12l.01 0"/><path d="M13 12l2 0"/><path d="M9 16l.01 0"/><path d="M13 16l2 0"/>', // tabler: clipboard-list
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>', // tabler: refresh
  robot: '<path d="M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"/><path d="M12 2v2"/><path d="M9 12v9"/><path d="M15 12v9"/><path d="M5 16l4 -2"/><path d="M15 14l4 2"/><path d="M9 18h6"/><path d="M10 8v.01"/><path d="M14 8v.01"/>', // tabler: robot
  save: '<path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2"/><path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M14 4l0 4l-6 0l0 -4"/>', // tabler: device-floppy
  script: '<path d="M17 20h-11a3 3 0 0 1 0 -6h11a3 3 0 0 0 0 6h1a3 3 0 0 0 3 -3v-11a2 2 0 0 0 -2 -2h-10a2 2 0 0 0 -2 2v8"/>', // tabler: script
  security: '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12l0 2.5"/>', // tabler: shield-lock
  settings: '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>', // tabler: settings
  square: '<path d="M3 3m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/>', // tabler: square
  star: '<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>', // tabler: star
  stopwatch: '<path d="M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0z"/><path d="M14.5 10.5l-2.5 2.5"/><path d="M17 8l1 -1"/><path d="M14 3h-4"/>', // tabler: stopwatch
  sun: '<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/>', // tabler: sun
  symbols: '<path d="M4 19h5v-1a7.35 7.35 0 1 1 6 0v1h5"/>', // tabler: omega
  target: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0"/><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/>', // tabler: target
  "to-back": '<path d="M4 20l16 0"/><path d="M12 14l0 -10"/><path d="M12 14l4 -4"/><path d="M12 14l-4 -4"/>', // tabler: arrow-bar-to-down
  "to-front": '<path d="M12 10l0 10"/><path d="M12 10l4 4"/><path d="M12 10l-4 4"/><path d="M4 4l16 0"/>', // tabler: arrow-bar-to-up
  tool: '<path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5"/>', // tabler: tool
  trash: '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>', // tabler: trash
  types: '<path d="M14.828 14.828a4 4 0 1 0 -5.656 -5.656a4 4 0 0 0 5.656 5.656z"/><path d="M9.172 20.485a4 4 0 1 0 -5.657 -5.657"/><path d="M14.828 3.515a4 4 0 0 0 5.657 5.657"/>', // tabler: dna
  unlock: '<path d="M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M8 11v-5a4 4 0 0 1 8 0"/>', // tabler: lock-open
  upload: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4l0 12"/>', // tabler: upload
  user: '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>', // tabler: user
  wall: '<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M4 8h16"/><path d="M20 12h-16"/><path d="M4 16h16"/><path d="M9 4v4"/><path d="M14 8v4"/><path d="M8 12v4"/><path d="M16 12v4"/><path d="M11 16v4"/>', // tabler: wall
  // ── the activity-bar icons, same concept ──
  background: ICONE_ATTIVITA.sfondo,
  bell: ICONE_ATTIVITA.allarmi,
  faceplate: ICONE_ATTIVITA.faceplate,
  folder: ICONE_ATTIVITA.progetto,
  frame: ICONE_ATTIVITA.cornice,
  layers: ICONE_ATTIVITA.oggetti,
  logic: ICONE_ATTIVITA.logica,
  monitor: ICONE_ATTIVITA.dispositivo,
  page: ICONE_ATTIVITA.pagina,
  palette: ICONE_ATTIVITA.aspetto,
  plug: ICONE_ATTIVITA.comunicazione,
  report: ICONE_ATTIVITA.report,
  search: ICONE_ATTIVITA.cerca,
  sparkles: ICONE_ATTIVITA.ia,
  tag: ICONE_ATTIVITA.tag,
  toolbox: ICONE_ATTIVITA.strumenti,
  users: ICONE_ATTIVITA.utenti,
  window: ICONE_ATTIVITA.finestra,
};

/** The concept each emoji written in the IDE stands for: `<Icona emoji="🏷" />`
 *  finds its icon without a name. An emoji with two meanings (🔀 is both the
 *  notification events and git) gets an explicit `nome` where it is used. */
export const EMOJI_ICON_NAMES: Record<string, string> = {
  "⚙": "settings",
  "🏷": "tag",
  "🧬": "types",
  "🔌": "plug",
  "🔔": "bell",
  "🐍": "python",
  "📑": "report",
  "📋": "recipe",
  "✉": "mail",
  "💬": "chat",
  "📞": "phone",
  "🔀": "events",
  "🎨": "palette",
  "🌐": "language",
  "🗄": "database",
  "👤": "user",
  "👥": "users",
  "🔏": "certificate",
  "⏱": "stopwatch",
  "📦": "package",
  "💾": "save",
  "📊": "chart",
  "💶": "euro",
  "🖥": "monitor",
  "📇": "devices",
  "🔗": "link",
  "⬇": "download",
  "⬆": "upload",
  "🧱": "container",
  "🏗": "build",
  "🔑": "key",
  "🎯": "target",
  "📜": "script",
  "🎛": "adjustments",
  "📟": "panel",
  "🧪": "flask",
  "📁": "folder",
  "🗃": "archive",
  "🔐": "security",
  "✨": "sparkles",
  "🛠": "tool",
  "🏠": "home",
  "🪟": "window",
  "🔒": "lock",
  "🔓": "unlock",
  "✎": "pencil",
  "✏": "pencil",
  "🖼": "image",
  "⭐": "star",
  "★": "star",
  "📄": "page",
  "🧩": "faceplate",
  "📌": "pin",
  "🗑": "trash",
  "🌄": "background",
  "🧰": "toolbox",
  "🗂": "layers",
  "☀": "sun",
  "🌙": "moon",
  "⏳": "hourglass",
  "🔍": "search",
  "🖌": "brush",
  "⏸": "pause",
  "▶": "play",
  "🤖": "robot",
  "🔣": "symbols",
  "🧹": "eraser",
  "🏭": "factory",
  "📡": "antenna",
  "☁": "cloud",
  "☰": "menu",
  "💿": "disc",
  "🖳": "monitor",
  "▭": "frame",
  "ƒ": "logic",
  "⟳": "refresh",
  "🧊": "cube",
  "⛶": "fit",
  "🕒": "clock",
  "✅": "done",
};

# Ruolo di questo template

**Inventario.** Gemello di [`demo-items-lvgl`](../demo-items-lvgl/README.md): stesse pagine,
stessi id, stesse coordinate — un oggetto per ciascuno dei 35 tipi della palette web.

## Il metro con cui giudicarlo

Deve contenere **tutti** i tipi della palette, non i più rappresentativi: è la sua unica
ragione d'essere, e uno solo mancante è un difetto, non un'omissione accettabile.

Ogni differenza rispetto al gemello LVGL (a parte i 4 tipi che LVGL non disegna: `image`,
`kpi_tile`, `alarm_history`, `data_log`) è un difetto di **parità fra motori**, non una scelta
di design di questo template — non va corretta qui, va guardato cosa diverge fra i due
renderer. `check_demo_templates.sh` verifica automaticamente che i due restino sincronizzati.

Non giudicarlo per realismo o eleganza: non deve somigliare a un impianto vero, deve mostrare
ogni pezzo della palette in un posto verificabile.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._

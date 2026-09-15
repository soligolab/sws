# Ruolo di questo template

**Inventario.** Gemello di [`demo-items-web`](../demo-items-web/README.md): stesse pagine,
stessi id, stesse coordinate — un oggetto per ciascuno dei 31 tipi che il motore LVGL disegna
(35 della palette, meno i 4 che LVGL non supporta: `image`, `kpi_tile`, `alarm_history`,
`data_log`).

## Il metro con cui giudicarlo

Deve contenere **tutti** i tipi che LVGL sa disegnare, non i più rappresentativi.

Ogni differenza rispetto al gemello web è un difetto di **parità fra motori**, non una scelta
di design di questo template — `check_demo_templates.sh` verifica che i due restino
sincronizzati (stessi nomi pagina, stesse dimensioni, stesse coordinate oggetto per oggetto).

Non giudicarlo per realismo o eleganza: non deve somigliare a un impianto vero, deve mostrare
ogni pezzo della palette LVGL in un posto verificabile, confrontabile a colpo d'occhio col
motore web sulla stessa pagina.

_Revisione template, 2026-09-15 (`docs/plans/2026-09-14-revisione-template.md`, passo 2)._

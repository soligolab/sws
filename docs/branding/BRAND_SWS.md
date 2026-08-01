# Brand SWS — palette KATODO

> Brief di identità visiva per "SWS" (Soligo Web SCADA), incollato dal maintainer il 2026-08-01.
> Salvato qui per non perderlo tra sessioni sparse (vedi `CLAUDE.md` — rischio #1 di questo repo).
> Gli asset grafici veri (logo, sfondi boot) **non esistono ancora**: il maintainer li genera altrove
> con i prompt qui sotto e li integra in una sessione successiva. Fino ad allora il brand "sws" nel
> codice ha il solo accento (`primary`/`primaryHover`/`onPrimary`) aggiornato a questa palette — vedi
> `sws-editor/public/branding/sws/brand.json` — mentre logo/favicon restano il placeholder blu "S".

## Palette (derivata dal logo storico KATODO)

| Ruolo | Nome | HEX | RGB |
|-------|------|-----|-----|
| Primario | Arancio acceso | `#DD5D21` | 221, 93, 33 |
| Secondario | Giallo dorato / senape | `#D9B200` | 217, 178, 0 |
| Accento (dati) | Azzurro cielo | `#7EB5E1` | 126, 181, 225 |
| Supporto UI | Verde oliva | `#82A84F` | 130, 168, 79 |
| Neutro scuro | Grafite | `#2B2B2B` | 43, 43, 43 |
| Neutro chiaro | Off-white | `#F7F4EF` | 247, 244, 239 |

Arancio + giallo come coppia principale del logo (2–3 colori max), azzurro come accento. Verde oliva
riservato all'interfaccia, non al logo.

**Stato attuale nel codice**: solo primario/hover/on-primary sono rappresentabili oggi nel sistema
white-label (vedi nota sotto). Secondario e accento restano per ora colori del solo artwork del logo,
non token CSS — decisione aperta in `docs/OPEN_QUESTIONS.md` Q11.

## Perché il grafite non è (ancora) nel brand.json di "sws"

`sws-editor/src/theme.ts` applica i 7 neutri (`bg/surface/surface2/border/text/text2/textMuted`)
**dopo** il branding e li condivide fra tutti i brand (sws/pixsys/acme/giorgino-giorgetti) — sono un
tema, non un token di brand, per scelta di design già documentata nel codice. Impostarli nel
`brand.json` di "sws" non avrebbe effetto visibile. Vedi `docs/OPEN_QUESTIONS.md` Q12.

## Deliverable da generare (esterni a questo repo per ora)

- Logo orizzontale a colori (wordmark)
- Logo su sfondo scuro (grafite `#2B2B2B`)
- Icona monogramma (quadrata)
- Favicon 32×32 / 16×16
- Versione monocroma (positivo + negativo)

### Contratto di drop-in per logo/favicon

Quando arrivano i file, sostituiscono direttamente:
- `sws-editor/public/branding/sws/logo.svg`
- `sws-editor/public/branding/sws/favicon.svg`

Nessun'altra modifica di codice è necessaria — `BrandLogo.tsx` e `branding/index.ts` leggono questi
percorsi per nome, non per contenuto. Mantenere lo stesso `viewBox` e il pattern
`role="img" aria-label="SWS"` già usato nel placeholder attuale, per compatibilità con lo screen
reader e col fallback testuale di `BrandLogo`.

## Prompt principale — Logo con wordmark

```
A modern, clean, minimal logo for "SWS", a lightweight web-based SCADA
platform for embedded industrial hardware. Monogram wordmark using the
three letters S W S, geometric sans-serif, uniform stroke weight, sharp
precise edges, well-balanced spacing. Technical and orderly feel, NOT
futuristic, NO 3D effects, NO gradients-heavy look, NO glow.
Two-color scheme: warm orange (#DD5D21) and golden yellow (#D9B200),
with an optional sky-blue accent (#7EB5E1). Neutral off-white background
(#F7F4EF). Flat vector style, crisp, scalable. Professional software
brand identity.
```

## Prompt variante — Icona / favicon (senza testo)

```
A compact app icon built from the three letters S W S fused into a
tight, balanced monogram. Geometric, minimal, flat vector. Readable at
small sizes (favicon 32x32). Uniform stroke weight, sharp edges.
Orange (#DD5D21) and golden yellow (#D9B200), sky-blue accent (#7EB5E1)
optional. Rounded-square or circular container optional. Clean, modern,
technical. No 3D, no gradients, no text besides the SWS letters.
```

## Prompt variante — Versione monocroma

```
Single-color version of the SWS monogram logo, flat vector, for use on
dark and light backgrounds. Pure geometric letterforms, uniform stroke.
Provide as solid orange (#DD5D21) on transparent, and as off-white
(#F7F4EF) on transparent.
```

---

## Sfondi di boot/login per pannelli Pixsys

Destinati al provisioning **OS-level** dei pannelli HMI Pixsys — **fuori** dal perimetro software di
questo repo. Nessun meccanismo di boot-splash (psplash o simile) esiste oggi in `deploy/yocto/` o
`scripts/`; questi file sono solo da consegnare al maintainer per la configurazione del device.
Landing directory per gli export: `docs/branding/boot-backgrounds/` (vedi il README lì per i nomi
attesi). Come questi PNG arrivino davvero su un pannello reale è una domanda aperta —
`docs/OPEN_QUESTIONS.md` Q13.

### Risoluzioni target

| Pollici | Risoluzione | Aspect | Stato |
|---------|-------------|--------|-------|
| 4.3"    | 480 × 272   | 16:9   | da confermare |
| 7"      | 800 × 480   | 5:3    | confermato (TD710) |
| 10.1"   | 1280 × 800  | 16:10  | da confermare |
| 10.1"   | 1280 × 768  | 5:3    | confermato (device attuale) |
| 15"     | 1366 × 768  | 16:9   | da confermare |
| 15.6"   | 1920 × 1080 | 16:9   | da confermare |

### Metodo consigliato

Disegnare un master a 1920×1080 con il contenuto (logo SWS + eventuale tagline) centrato dentro una
**safe-area centrale ~1280×720**, sfondo che si estende fino ai bordi. Poi esportare/ritagliare ogni
risoluzione dalla stessa composizione, così il branding resta coerente e centrato su tutti i pannelli.

### Prompt background

```
A clean, minimal industrial boot/login background for "SWS" (Soligo Web
SCADA). Dark graphite base (#2B2B2B) with a subtle geometric texture,
NOT busy. SWS monogram logo centered, in orange (#DD5D21) and golden
yellow (#D9B200), with a thin sky-blue accent line (#7EB5E1). Plenty of
empty margin around the logo (safe-area friendly). Flat, modern, sober.
No 3D, no heavy gradients, no glow. Optimized to look sharp on small
industrial HMI panels. Export at: 480x272, 800x480, 1280x768, 1280x800,
1366x768, 1920x1080.
```

---

## Sezione Branding / White-label SWS (aspirazionale)

Il brief originale descrive anche uno schema di token e metadati più ampio di quello implementato
oggi (che ha solo 10 campi colore in `BrandColors`, vedi `src/branding/index.ts`). Riportato qui come
riferimento per un'eventuale evoluzione dello schema — non ancora deciso, vedi Q11/Q12.

### Asset grafici da generare per ogni brand

- Logo completo (wordmark) — sfondo chiaro
- Logo completo (wordmark) — sfondo scuro
- Logo compatto / icona (per sidebar collassata)
- Favicon (32×32, 16×16, .ico + .svg)
- Logo schermata di login (versione grande)
- Immagine / pattern di sfondo login (opzionale)

### Design token — colori (CSS custom properties, forma aspirazionale)

```css
:root {
  /* Brand */
  --brand-primary:      #DD5D21;  /* arancio acceso   */
  --brand-secondary:    #D9B200;  /* giallo dorato    */
  --brand-accent:       #7EB5E1;  /* azzurro dati     */

  /* Stati (critici in ambito SCADA) */
  --state-ok:           #82A84F;  /* verde oliva      */
  --state-warning:      #D9B200;  /* giallo           */
  --state-alarm:        #C0392B;  /* rosso allarme    */
  --state-info:         #7EB5E1;  /* azzurro          */
  --state-disabled:     #9AA0A6;  /* grigio           */

  /* Neutri / superfici */
  --bg-dark:            #2B2B2B;
  --bg-light:           #F7F4EF;
  --text-on-dark:       #F7F4EF;
  --text-on-light:      #2B2B2B;
}
```

> Nota: i nomi qui **non** corrispondono 1:1 a `CSS_VARS` in `src/branding/index.ts` (che usa
> `--brand-bg`, `--brand-surface`, ecc.) né ai token di stato già presenti in `theme.ts`
> (`--brand-danger/-success/-warning` con varianti soft/bg calcolate per contrasto WCAG). Prima di
> adottare questo schema andrebbe riconciliato con quello esistente, non aggiunto in parallelo.

### Token tipografia

```css
:root {
  --font-family-base: "Inter", system-ui, sans-serif;
  --font-family-mono: "JetBrains Mono", monospace; /* valori/telemetria */
}
```

### Metadati brand (per cliente, forma aspirazionale)

```yaml
brand:
  name: "SWS"
  display_name: "Soligo Web SCADA"
  tagline: ""
  logo_full_light: "assets/logo-full-light.svg"
  logo_full_dark:  "assets/logo-full-dark.svg"
  logo_compact:    "assets/logo-icon.svg"
  favicon:         "assets/favicon.svg"
  login_logo:      "assets/login-logo.svg"
  colors:
    primary:   "#DD5D21"
    secondary: "#D9B200"
    accent:    "#7EB5E1"
```

Lo schema reale oggi (`public/branding/<id>/brand.json`) è più semplice: `id, name, shortName, logo,
favicon, colors{10 campi}, device_presets, data_path_presets`. Vedi i 4 brand esistenti in
`sws-editor/public/branding/` per l'esempio corrente.

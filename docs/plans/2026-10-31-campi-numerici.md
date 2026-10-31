# I campi numerici accettano il «-» da tastiera (e tutto il resto a metà)

## Context

Il maintainer (31-10-2026), sullo slider di CasaDomotica: «nel campo Min non posso scrivere "-" da tastiera ma
solo con gli indicatori, verifica tutti i campi di input numerici».

**La causa, misurata nel codice.** Tutti i 105 `<input type="number">` dell'editor sono controllati e scrivono
a ogni tasto. Il pannello proprietà ne ha due, i due `numInput` di `sws-editor/src/editor/EditorShell.tsx`
(~2902 e ~3165). Gli altri sono nelle schede di configurazione: sorgenti, allarmi, tag, report, backup,
console…

- **Il «-» viene cancellato.** Con un testo a metà come «-» il browser dà `e.target.value === ""`. Il gestore
  allora scrive `undefined` e il campo torna al ripiego (`fallback` 0). In più React, quando il valore è 0 e il
  campo è vuoto, riscrive «0» nel DOM a ogni ridisegno, e i valori vivi dei tag ridisegnano spesso.
- **Altrove si scrive uno 0.** Molti gestori fanno `Number(e.target.value)` senza controllo, e per «-» scrivono
  davvero **0** nel progetto (porte, indirizzi, scale, intervalli).
- **Stesso guasto in altri casi.** Cancellare il campo per riscriverlo e i testi a metà come «1e» hanno lo
  stesso problema.

## Il ramo

`fix/campi-numerici`, annidato su `fix/annulla-per-campo` (opzione 2 di «Un ramo alla volta»: stessa zona,
`EditorShell.tsx`).

## Il lavoro

### 1. Un controllo solo: `CampoNumero` (`sws-editor/src/components/CampoNumero.tsx`)

Stessa forma di `SelettoreColore` (`editor/CampoColore.tsx`), che ha appena fatto lo stesso per i colori:

```tsx
export function CampoNumero({ value, onTesto, onBlur, ...resto }:
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange">
  & { value: number | string | undefined; onTesto: (v: string) => void })
```

- **Il testo a metà resta nel campo.** Si riconosce da `e.target.validity.badInput`: «-», «1e», «-.» non
  arrivano al gestore. Il campo tiene una bozza locale (`""`), che coincide con il valore che il DOM riporta,
  quindi React non riscrive niente e a schermo resta «-».
- **Il campo svuotato davvero** (`""` senza `badInput`) arriva al gestore come prima, cioè «non impostato».
  Mentre il campo è in uso la bozza lo tiene vuoto invece di rimettere il ripiego.
- **All'uscita dal campo** (`onBlur`) la bozza si scarta e torna il valore del progetto. Si chiama anche
  l'`onBlur` del chiamante.
- **Le frecce, la rotella e la tastiera numerica** del browser restano: è sempre `type="number"`.

### 2. Tutti i 105 campi passano da lì

È la stessa conversione meccanica fatta per i selettori colore:

- `<input type="number" … onChange={(e) => X(e.target.value …)}>` diventa `<CampoNumero … onTesto={(v) => X(v …)}>`;
- i corpi dei gestori restano identici: cambia solo da dove arriva la stringa;
- uno script (nella scratchpad) fa una prova a secco su tutti i file, da rileggere, poi si applica;
- i casi che non si piegano (gestori che leggono altro dall'evento, commenti con `<input type="number">`
  dentro) si fanno a mano, come `EditorAssegnazioni.tsx` per i colori.

File principali:
- `editor/EditorShell.tsx` (34 campi, compresi i due `numInput`);
- `config/schede/AlarmsTab.tsx`, `TagsTab.tsx`, `StileSimboliTab.tsx`;
- `config/sorgenti/*` (Modbus, S7, OPC-UA, MQTT, Host, catalogo);
- `console/Aziende.tsx`, `Posta.tsx`;
- `planimetrie/PlanimetriaEditor.tsx`, `scala/DialogoRisoluzione.tsx`, `cornici/ProprietaCornice.tsx`;
- `runtime-view/RuntimeView.tsx`, `components/BindableInput.tsx`.

### 3. Una guardia perché non ritorni

`scripts/check_campi_numerici.sh`, registrata in `check_static.sh` con la sua riga di motivo:

- nessun `type="number"` nei `.tsx` di `sws-editor/src` fuori da `CampoNumero.tsx`, commenti esclusi;
- stampa file e riga dei trasgressori.

### 4. Test (vitest, `tests/campoNumero.test.tsx`)

In jsdom `badInput` non nasce da solo: lo si imposta con `Object.defineProperty` su `validity`.

- **«-» a metà:** il gestore non viene chiamato e il campo resta vuoto anche dopo un ridisegno con valore 0.
- **«-5»:** arriva «-5».
- **Svuotato davvero:** arriva `""`; all'uscita torna il valore del progetto.
- **Lo slider:** il campo Min del pannello proprietà accetta -50 da tastiera.

### 5. Testi

- CHANGELOG `[Unreleased] / Fixed`.
- NOVITA: il blocco 2.23.8 è pieno (15). La voce non si aggiunge; si valuta se unirla a una voce dell'IDE già
  presente.

## Verifica

- `pnpm exec vitest run` (tre giri, per la molla), `pnpm build`, `./scripts/check_static.sh` (52 guardie con la
  nuova), `cargo check`.
- **Dal vivo**, immagine amd64 sul VPS come da regola:
  - in CasaDomotica, lo slider `mvw9aukjek0im`: Min -50 scritto da tastiera, Max 50, Origine 0, Riposo 0;
  - una porta di una sorgente cancellata e riscritta senza che passi per 0.
- Poi conferma del maintainer, e squash dei tre rami annidati: `fix/colore-fluido`, `fix/annulla-per-campo`,
  `fix/campi-numerici`.

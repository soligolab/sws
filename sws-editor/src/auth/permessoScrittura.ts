// Chi può scrivere un tag dal viewer (25-10-2026, piano
// docs/archive/2026-10-25-scrittura-senza-login.md).
//
// Valgono **tutti e due** i vincoli, e vince il più severo (decisione del
// maintainer): il tag dice chi può scriverlo — ed è l'unico che il server fa
// rispettare — e l'oggetto può solo restringere, nell'interfaccia
// (`isRoleAllowed` in `SvgCanvas`). Qui c'è la metà del tag, la stessa regola
// di `tag_write_allowed` in `sws-web/src/router.rs`: una soglia assente vuol
// dire Operator, «Viewer» vuol dire chiunque, anonimo compreso — perché per il
// server l'anonimo è Viewer.
import type { TagDef, TypeDef } from "@/types";
import { foglieDiTolleranti } from "@/tag/forma";

const RANGO: Record<string, number> = { Viewer: 0, Operator: 1, Supervisor: 2, Admin: 3 };

/** La soglia di scrittura del tag `id`, nell'ordine di `write_role_of` del
 *  server (`build_tag_write_roles`): la sua; per la foglia di un'istanza
 *  quella del **membro** del tipo, se la dichiara; poi quella della radice
 *  (`motore1.marcia` → `motore1`). Assente = `Operator`.
 *
 *  Il membro c'è dal 04-11-2026 (regola R7 dei template): fino ad allora un
 *  membro aperto a «Chiunque» il server lo lasciava scrivere, e il viewer
 *  apriva lo stesso il login, perché qui si guardava solo la radice. */
export function sogliaScritturaTag(
  tags: TagDef[] | undefined,
  id: string,
  types: readonly TypeDef[] = [],
): string {
  const esatto = tags?.find((t) => t.id === id);
  if (esatto?.write_min_role) return esatto.write_min_role;
  const fine = id.search(/[.\[]/);
  if (fine > 0) {
    const radice = tags?.find((t) => t.id === id.slice(0, fine));
    if (radice) {
      const foglia = foglieDiTolleranti(radice, types).find((f) => f.percorso === id);
      if (foglia?.membro?.write_min_role) return foglia.membro.write_min_role;
      if (radice.write_min_role) return radice.write_min_role;
    }
  }
  return "Operator";
}

/** Il ruolo `ruolo` (dallo store; `null` = non ancora saputo = anonimo) basta
 *  per la soglia? L'anonimo conta come Viewer, come sul server. */
export function puoScrivere(soglia: string, ruolo: string | null | undefined): boolean {
  const ho = RANGO[ruolo ?? "Viewer"] ?? 0;
  return ho >= (RANGO[soglia] ?? RANGO.Operator);
}

/** Il rango di un ruolo, per confrontarne due. Un nome sconosciuto vale
 *  `Viewer`, come fa `role_allowed` sul pannello: una stringa scritta male
 *  non deve bloccare tutto. `undefined` (nessuna soglia sull'oggetto) non ha
 *  rango e si tratta a parte da chi chiama. */
export function rangoRuolo(ruolo: string): number {
  return RANGO[ruolo] ?? 0;
}

/** **La soglia che l'oggetto eredita dalle variabili che scrive**
 *  (26-10-2026). È la più severa fra le soglie dei suoi tag, perché per
 *  usarlo servono tutte.
 *
 *  Serve al pannello proprietà: fino a oggi il campo «ruolo minimo»
 *  dell'oggetto nasceva vuoto e sembrava dire «aperto a chiunque», mentre il
 *  tag sotto chiedeva Operator — che è il default di un tag senza soglia. Il
 *  maintainer ci è inciampato il 26-10 con uno slider che chiedeva il login
 *  senza che niente nell'oggetto lo facesse prevedere.
 *
 *  `undefined` = l'oggetto non scrive niente, quindi non eredita niente. */
export function sogliaEreditata(
  tags: TagDef[] | undefined,
  obj: Parameters<typeof tagScrittiDa>[0],
  types: readonly TypeDef[] = [],
): string | undefined {
  const scritti = tagScrittiDa(obj);
  if (!scritti.length) return undefined;
  return scritti
    .map((id) => sogliaScritturaTag(tags, id, types))
    .reduce((a, b) => (rangoRuolo(b) > rangoRuolo(a) ? b : a));
}

/** I tipi che scrivono il proprio `tag` quando li si usa (le chiamate a
 *  `guardedWrite` in `SvgCanvas`). Il simbolo scrive `command_tag`. */
const SCRIVONO_IL_TAG = new Set(["button", "checkbox", "radio", "setpoint", "slider"]);

/** I tag che l'oggetto scrive: le assegnazioni se ci sono (come fa il clic),
 *  altrimenti il `command_tag` del simbolo o il `tag` dei tipi che scrivono.
 *  Vuoto per un oggetto che mostra soltanto. */
export function tagScrittiDa(obj: {
  type: string; tag?: string; command_tag?: string; assegnazioni?: { tag: string }[]; read_only?: boolean;
}): string[] {
  if (obj.assegnazioni?.length) return [...new Set(obj.assegnazioni.map((a) => a.tag).filter(Boolean))];
  // In sola lettura l'oggetto mostra e basta: non scrive, quindi non eredita
  // la soglia del tag (04-11-2026, come la regola R7 dei template).
  if (obj.read_only) return [];
  if (obj.type === "symbol") return obj.command_tag ? [obj.command_tag] : [];
  return SCRIVONO_IL_TAG.has(obj.type) && obj.tag ? [obj.tag] : [];
}

/** **Il lucchetto** (regola R7 dei template, 04-11-2026): il ruolo che manca a
 *  chi guarda per usare questo comando, o `null` se può usarlo.
 *
 *  Due motivi, e vince il più severo. L'oggetto chiede un ruolo (`min_role`):
 *  allora è anche attenuato e inerte, come prima (`attenua`). Oppure è la
 *  variabile a chiederlo: l'oggetto resta pieno, perché toccandolo si apre
 *  l'accesso e dopo funziona. Il pannello LVGL fa lo stesso conto
 *  (`ruolo_che_serve` in `lvgl_render.rs`). Il ruolo nullo è l'anonimo: per
 *  l'oggetto sta sotto Viewer (come `isRoleAllowed`), per la variabile vale
 *  Viewer (come il server). */
export function ruoloCheServe(
  obj: Parameters<typeof tagScrittiDa>[0] & { min_role?: string; table_rows?: { tag?: string; writable?: boolean }[] },
  ruolo: string | null | undefined,
  tags: TagDef[] | undefined,
  types: readonly TypeDef[] = [],
): { ruolo: string; attenua: boolean } | null {
  const ho = (r: string | null | undefined) => (r ? (RANGO[r] ?? -1) : -1);
  const perOggetto = obj.min_role && ho(ruolo) < (RANGO[obj.min_role] ?? 0) ? obj.min_role : undefined;
  const scritti = [
    ...tagScrittiDa(obj),
    ...(obj.table_rows ?? []).filter((r) => r.writable && r.tag).map((r) => r.tag as string),
  ];
  let perVariabile: string | undefined;
  for (const id of scritti) {
    const soglia = sogliaScritturaTag(tags, id, types);
    if (puoScrivere(soglia, ruolo)) continue;
    if (perVariabile === undefined || rangoRuolo(soglia) > rangoRuolo(perVariabile)) perVariabile = soglia;
  }
  if (!perOggetto && !perVariabile) return null;
  const piuAlto = !perVariabile || (perOggetto && rangoRuolo(perOggetto) >= rangoRuolo(perVariabile))
    ? perOggetto!
    : perVariabile;
  return { ruolo: piuAlto, attenua: !!perOggetto };
}

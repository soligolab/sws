// The device firewall (firewalld), as the runtime describes it: the same shape
// for the IDE (`/api/remote/firewall`) and for the control panel
// (`/api/control-panel/firewall`). Plan
// docs/plans/2026-11-26-firewall-dei-dispositivi.md.
//
// A change is a list of operations. The screens build it as a draft (switch an
// entry off, edit a port, add a rule), then apply it at once: the runtime
// undoes it after `confirm_within_secs` unless it is confirmed.

export type Item =
  | { kind: "service"; name: string }
  | { kind: "port"; port: string; protocol: string }
  | { kind: "rich_rule"; rule: string };

export type Action = "add" | "remove";

export interface Op {
  zone: string;
  action: Action;
  item: Item;
}

export type Verdict = "accept" | "reject" | "drop";

export type RuleTarget =
  | { kind: "port"; port: string; protocol: string }
  | { kind: "service"; name: string };

export interface RuleForm {
  source: string;
  target: RuleTarget;
  verdict: Verdict;
}

export type Entry = Item & {
  enabled: boolean;
  /** For a service: the ports it opens (`80/tcp`). */
  ports?: string[];
  /** For a rich rule the screens can edit as a form. */
  form?: RuleForm;
  disabled_by?: string;
  disabled_at_ms?: number;
};

export interface ZoneView {
  name: string;
  default: boolean;
  interfaces: string[];
  sources: string[];
  entries: Entry[];
}

export interface ListenPort {
  port: number;
  protocol: string;
  /** 7443 or 7444: the ports of SWS itself. */
  sws: boolean;
  open_in: string[];
}

export interface PendingView {
  ops: Op[];
  seconds_left: number;
  by?: string;
}

export interface FirewallView {
  available: boolean;
  default_zone: string;
  zones: ZoneView[];
  known_services: string[];
  listen_ports: ListenPort[];
  pending: PendingView | null;
  confirm_within_secs: number;
}

/** The four calls, behind the IDE's proxy or the control panel's session. */
export interface FirewallApi {
  get(): Promise<FirewallView>;
  apply(ops: Op[]): Promise<{ confirm_within_secs: number }>;
  confirmChange(): Promise<void>;
  rollbackChange(): Promise<void>;
}

export const PROTOCOLS = ["tcp", "udp", "sctp", "dccp"] as const;
export const SWS_PORTS = [7443, 7444];

// ── Validation, the same as the runtime's ─────────────────────────────────────

export function validPort(s: string): boolean {
  const n = (x: string) => /^\d{1,5}$/.test(x) && Number(x) >= 1 && Number(x) <= 65535;
  const [a, b, ...rest] = s.split("-");
  if (rest.length > 0) return false;
  if (b === undefined) return n(a);
  return n(a) && n(b) && Number(a) < Number(b);
}

export function validSource(s: string): boolean {
  const [addr, prefix, ...rest] = s.split("/");
  if (rest.length > 0 || !addr) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  const isV4 = !!v4 && v4.slice(1).every((x) => Number(x) <= 255);
  const isV6 = !isV4 && addr.includes(":") && /^[0-9a-fA-F:.]+$/.test(addr);
  if (!isV4 && !isV6) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (isV4 ? 32 : 128);
}

export function validServiceName(s: string): boolean {
  return /^[A-Za-z0-9_.+-]{1,64}$/.test(s);
}

export function validRuleForm(f: RuleForm): boolean {
  if (!validSource(f.source)) return false;
  return f.target.kind === "port"
    ? validPort(f.target.port) && (PROTOCOLS as readonly string[]).includes(f.target.protocol)
    : validServiceName(f.target.name);
}

/** The firewalld text of a rule of the form: the same text the runtime writes. */
export function composeRule(f: RuleForm): string {
  const family = f.source.split("/")[0].includes(":") ? "ipv6" : "ipv4";
  const what = f.target.kind === "port"
    ? `port port="${f.target.port}" protocol="${f.target.protocol}"`
    : `service name="${f.target.name}"`;
  return `rule family="${family}" source address="${f.source}" ${what} ${f.verdict}`;
}

// ── Items ─────────────────────────────────────────────────────────────────────

export function itemOf(e: Entry): Item {
  if (e.kind === "service") return { kind: "service", name: e.name };
  if (e.kind === "port") return { kind: "port", port: e.port, protocol: e.protocol };
  return { kind: "rich_rule", rule: e.rule };
}

export function sameItem(a: Item, b: Item): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "service" && b.kind === "service") return a.name === b.name;
  if (a.kind === "port" && b.kind === "port") return a.port === b.port && a.protocol === b.protocol;
  if (a.kind === "rich_rule" && b.kind === "rich_rule") return a.rule === b.rule;
  return false;
}

export function itemKey(zone: string, i: Item): string {
  return `${zone}|${JSON.stringify(itemOf(i as Entry))}`;
}

/** Does the port range `p` (`80`, `1740-1743`) contain `port`? */
function inRange(p: string, port: number): boolean {
  const [a, b] = p.split("-").map(Number);
  return b === undefined ? a === port : a <= port && port <= b;
}

/** The ports an entry lets in, as `port/protocol` texts (rich rules: none). */
export function portsOf(e: Entry): string[] {
  if (e.kind === "port") return [`${e.port}/${e.protocol}`];
  if (e.kind === "service") return e.ports ?? [];
  return [];
}

/** Removing this entry can cut the line to the device: a port of SWS, or ssh. */
export function isSensitive(e: Entry): boolean {
  if (e.kind === "service" && e.name === "ssh") return true;
  return portsOf(e).some((t) => {
    const [p, proto] = t.split("/");
    return proto === "tcp" && (SWS_PORTS.some((s) => inRange(p, s)) || inRange(p, 22));
  });
}

// ── The draft ─────────────────────────────────────────────────────────────────

/** A row as the screens draw it: the entry with the draft applied. */
export interface Row {
  zone: string;
  entry: Entry;
  /** On after the draft. */
  on: boolean;
  /** The draft changes this row. */
  changed: boolean;
  /** Added by the draft: not on the device yet. */
  added: boolean;
}

/** The rows of a zone after the draft: switched entries, and the new ones at the end. */
export function rowsOf(z: ZoneView, draft: Op[]): Row[] {
  const ops = draft.filter((o) => o.zone === z.name);
  const rows: Row[] = z.entries.map((e) => {
    const last = [...ops].reverse().find((o) => sameItem(o.item, itemOf(e)));
    const on = last ? last.action === "add" : e.enabled;
    return { zone: z.name, entry: e, on, changed: on !== e.enabled, added: false };
  });
  for (const o of ops) {
    if (o.action !== "add") continue;
    if (z.entries.some((e) => sameItem(itemOf(e), o.item))) continue;
    if (rows.some((r) => sameItem(itemOf(r.entry), o.item))) continue;
    rows.push({ zone: z.name, entry: { ...o.item, enabled: false } as Entry, on: true, changed: true, added: true });
  }
  return rows;
}

/** The draft with this row switched. Switching back takes the operation away. */
export function toggle(draft: Op[], z: ZoneView, r: Row): Op[] {
  const item = itemOf(r.entry);
  const without = draft.filter((o) => !(o.zone === z.name && sameItem(o.item, item)));
  if (r.added) return without;
  const enabledNow = r.entry.enabled;
  if (r.changed) return without;
  return [...without, { zone: z.name, action: enabledNow ? "remove" : "add", item }];
}

/** The draft with a new entry. An entry already there, or already drafted, changes nothing. */
export function addItem(draft: Op[], z: ZoneView, item: Item): Op[] {
  const there = rowsOf(z, draft).find((r) => sameItem(itemOf(r.entry), item));
  if (there) return there.on ? draft : toggle(draft, z, there);
  return [...draft, { zone: z.name, action: "add", item }];
}

/** The draft with `old` replaced by `next`: one change, so the rollback puts `old` back. */
export function editItem(draft: Op[], z: ZoneView, r: Row, next: Item): Op[] {
  if (sameItem(itemOf(r.entry), next)) return draft;
  let d = draft;
  if (r.added) d = toggle(d, z, r);
  else if (r.on) d = r.changed ? d : [...d, { zone: z.name, action: "remove", item: itemOf(r.entry) }];
  return addItem(d, z, next);
}

/** The operations to send: the removals first, then the additions, as drafted. */
export function opsToSend(draft: Op[]): Op[] {
  return [...draft.filter((o) => o.action === "remove"), ...draft.filter((o) => o.action === "add")];
}

/** The draft removes something that can cut the line to the device. */
export function draftIsSensitive(view: FirewallView, draft: Op[]): boolean {
  return draft.some((o) => {
    if (o.action !== "remove") return false;
    const z = view.zones.find((x) => x.name === o.zone);
    const e = z?.entries.find((x) => sameItem(itemOf(x), o.item));
    return e ? isSensitive(e) : false;
  });
}

/** The zone where "Open" puts a closed port: the default one, or the first with a card. */
export function zoneForOpen(view: FirewallView): ZoneView | undefined {
  return view.zones.find((z) => z.interfaces.length > 0) ?? view.zones.find((z) => z.default) ?? view.zones[0];
}

/** The runtime's reason, out of an error of either client. */
export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const json = m.slice(m.indexOf("{"));
  try {
    const b = JSON.parse(json);
    if (b && typeof b.error === "string") return b.error;
  } catch { /* not JSON */ }
  return m;
}

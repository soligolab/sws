// The device control panel on the web viewer: service PIN, then network,
// Wi-Fi, time, screen and device sections over `/api/control-panel/*`. Plan
// docs/plans/2026-11-13-pannello-di-controllo.md, phases 2 and 4; the look
// follows the preview the maintainer approved on 13-11-2026.
//
// It covers the whole screen and works with a finger only: the panels have no
// keyboard, so PIN and addresses have their own keypads. A physical keyboard
// still types in the fields.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CampoPassword } from "@/components/CampoPassword";
import { QrCode } from "@/components/QrCode";
import { usePanelTranslation } from "./language";
import {
  isIpv4,
  isPsk,
  openSession,
  PinError,
  session as makeSession,
  SessionExpired,
  splitCidr,
  type Capabilities,
  type Card,
  type ControlPanelSession,
  type DeviceInfo,
  type Hotspot,
  type TimeState,
  type WifiNetwork,
  type WifiState,
} from "./api";

const C = {
  bg: "#1b1f24", panel: "#242a31", panel2: "#2c333b", line: "#3a434d",
  text: "#e6e9ec", muted: "#9aa5b1", accent: "#4f9cf0", ok: "#46b37a",
  warn: "#e0a43a", bad: "#d9534f",
};

const btn: CSSProperties = {
  border: `1px solid ${C.line}`, background: C.panel2, color: C.text, borderRadius: 6,
  padding: "9px 16px", fontSize: 15, cursor: "pointer", minHeight: 40,
};
const btnPrimary: CSSProperties = { ...btn, background: C.accent, borderColor: C.accent, color: "#fff" };
const card: CSSProperties = {
  background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "14px 16px", marginBottom: 14,
};
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 44 };
const lbl: CSSProperties = { width: 150, color: C.muted, fontSize: 14, flexShrink: 0 };
const field: CSSProperties = {
  background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "8px 10px", color: C.text,
  fontSize: 16, fontFamily: "'DejaVu Sans Mono', monospace", width: 180,
};

type Section = "network" | "wifi" | "time" | "screen" | "device";

export function ControlPanel({ onClose }: { onClose: () => void }) {
  const [api, setApi] = useState<ControlPanelSession | null>(null);
  if (!api) return <PinDialog onCancel={onClose} onOpen={(token) => setApi(makeSession(token))} />;
  return <Panel api={api} onClose={onClose} onExpired={() => setApi(null)} />;
}

// ── PIN ──────────────────────────────────────────────────────────────────────

const PIN_LENGTH = 6;

function PinDialog({ onCancel, onOpen }: { onCancel: () => void; onOpen: (token: string) => void }) {
  const { t } = usePanelTranslation();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      onOpen(await openSession(value));
    } catch (e) {
      setPin("");
      if (e instanceof PinError) {
        setError(e.retryAfterSecs ? t("controlPanel.pinLocked", { secs: e.retryAfterSecs }) : t("controlPanel.pinWrong"));
      } else {
        setError(String((e as Error).message ?? e));
      }
    } finally {
      setBusy(false);
    }
  }, [onOpen, t]);

  const press = (k: string) => {
    if (busy) return;
    if (k === "⌫") { setPin((p) => p.slice(0, -1)); return; }
    setPin((p) => (p.length < PIN_LENGTH ? p + k : p));
  };

  // A physical keyboard works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9a-fA-F]$/.test(e.key)) press(e.key.toLowerCase());
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter" && pin) void submit(pin);
      else if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const keys = ["1", "2", "3", "a", "4", "5", "6", "b", "7", "8", "9", "c", "d", "0", "e", "f"];
  return (
    <div style={veil} data-testid="control-panel-pin">
      <div style={{ ...card, width: 420, padding: "22px 26px", marginBottom: 0, boxShadow: "0 10px 40px #000a" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>{t("controlPanel.title")}</h2>
        <p style={{ margin: "0 0 14px", color: C.muted, fontSize: 14 }}>{t("controlPanel.pinHelp")}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "6px 0 12px" }}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} style={{
              width: 44, height: 52, border: `1px solid ${i < pin.length ? C.accent : C.line}`, borderRadius: 6,
              background: C.bg, display: "grid", placeItems: "center", fontSize: 26,
            }}>{pin[i] ?? "·"}</span>
          ))}
        </div>
        <div role="alert" style={{ minHeight: 20, color: "#f1b0ad", fontSize: 14, textAlign: "center", marginBottom: 8 }}>
          {error}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {keys.map((k) => (
            <button key={k} type="button" style={{ ...btn, height: 50, fontSize: 20, color: /[a-f]/.test(k) ? "#9cc6f5" : C.text }}
              onClick={() => press(k)}>{k}</button>
          ))}
          <button type="button" style={{ ...btn, gridColumn: "span 2", color: C.muted }} onClick={onCancel}>
            {t("controlPanel.cancel")}
          </button>
          <button type="button" style={{ ...btn, color: C.muted }} onClick={() => press("⌫")} aria-label="backspace">⌫</button>
          <button type="button" style={btnPrimary} disabled={!pin || busy} onClick={() => void submit(pin)}>
            {t("controlPanel.enter")}
          </button>
        </div>
      </div>
    </div>
  );
}

const veil: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10000, background: "#000a", display: "grid", placeItems: "center",
  color: C.text, fontFamily: "'DejaVu Sans', system-ui, sans-serif",
};

// ── The panel ────────────────────────────────────────────────────────────────

function Panel({ api, onClose, onExpired }: { api: ControlPanelSession; onClose: () => void; onExpired: () => void }) {
  const { t } = usePanelTranslation();
  const [section, setSection] = useState<Section>("network");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every call goes through here: an expired session goes back to the PIN.
  const guard = useCallback(async <T,>(p: Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await p;
    } catch (e) {
      if (e instanceof SessionExpired) { onExpired(); return undefined; }
      setError(String((e as Error).message ?? e));
      return undefined;
    }
  }, [onExpired]);

  useEffect(() => {
    void guard(api.capabilities()).then((c) => c && setCaps(c));
    void guard(api.info()).then((i) => i && setInfo(i));
  }, [api, guard]);

  const sections: { id: Section; label: string; on: boolean }[] = [
    { id: "network", label: t("controlPanel.network"), on: caps?.network ?? true },
    { id: "wifi", label: t("controlPanel.wifi"), on: caps?.wifi ?? false },
    { id: "time", label: t("controlPanel.time"), on: caps?.time ?? true },
    // On the web: the brightness and PixsysOS' calibration. The resistive
    // calibration of the Tiny TY is the LVGL viewer's.
    { id: "screen", label: t("controlPanel.screen"), on: (caps?.display || caps?.touch_calibration_service) ?? false },
    { id: "device", label: t("controlPanel.device"), on: true },
  ];

  return (
    <div data-testid="control-panel" style={{
      position: "fixed", inset: 0, zIndex: 10000, background: C.bg, color: C.text,
      fontFamily: "'DejaVu Sans', system-ui, sans-serif",
      display: "grid", gridTemplateColumns: "220px 1fr", gridTemplateRows: "56px 1fr",
    }}>
      <header style={{
        gridColumn: "1 / 3", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 18px", background: C.panel, borderBottom: `1px solid ${C.line}`,
      }}>
        <div style={{ fontSize: 19 }}>
          {t("controlPanel.title")}
          {info?.hostname && <small style={{ color: C.muted, fontSize: 13, marginLeft: 10 }}>{info.hostname}</small>}
        </div>
        <button type="button" style={btn} onClick={onClose}>{t("controlPanel.close")} ✕</button>
      </header>
      <nav style={{ background: C.panel, borderRight: `1px solid ${C.line}`, padding: "10px 0" }}>
        {sections.map((s) => (
          <button key={s.id} type="button" disabled={!s.on} onClick={() => setSection(s.id)}
            data-testid={`control-panel-section-${s.id}`}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "14px 20px", fontSize: 16,
              background: section === s.id ? C.panel2 : "transparent", border: "none",
              borderLeft: `4px solid ${section === s.id ? C.accent : "transparent"}`,
              color: section === s.id ? C.text : C.muted, opacity: s.on ? 1 : 0.35, cursor: s.on ? "pointer" : "default",
            }}>{s.label}</button>
        ))}
      </nav>
      <main style={{ padding: "18px 22px", overflow: "auto", position: "relative" }}>
        {error && <div role="alert" style={{ ...card, borderColor: C.bad, color: "#f1b0ad" }}>{error}</div>}
        {section === "network" && <NetworkSection api={api} guard={guard} />}
        {section === "wifi" && <WifiSection api={api} guard={guard} />}
        {section === "time" && <TimeSection api={api} guard={guard} />}
        {section === "screen" && <ScreenSection api={api} guard={guard} caps={caps} />}
        {section === "device" && <DeviceSection api={api} guard={guard} info={info} caps={caps} />}
      </main>
    </div>
  );
}

type Guard = <T>(p: Promise<T>) => Promise<T | undefined>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div style={row}><div style={lbl}>{label}</div><div style={{ fontSize: 16 }}>{children}</div></div>;
}

function Tag({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "warn" }) {
  const c = tone === "ok" ? ["#46b37a26", "#8fd6ad"] : ["#e0a43a26", "#f0c97a"];
  return <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: c[0], color: c[1], marginLeft: 8 }}>{children}</span>;
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} style={{
          padding: "8px 18px", fontSize: 15, border: "none", cursor: "pointer",
          background: o.value === value ? C.accent : "transparent", color: o.value === value ? "#fff" : C.muted,
        }}>{o.label}</button>
      ))}
    </div>
  );
}

// ── Network ──────────────────────────────────────────────────────────────────

type Draft = { method: "auto" | "manual"; address: string; prefix: string; gateway: string; dns: string };
const FIELDS = ["address", "prefix", "gateway", "dns"] as const;
type FieldName = (typeof FIELDS)[number];

function draftOf(c: Card): Draft {
  const first = c.addresses[0] ? splitCidr(c.addresses[0]) : { address: "", prefix: 24 };
  return {
    method: c.method === "manual" ? "manual" : "auto",
    address: first.address, prefix: String(first.prefix), gateway: c.gateway ?? "", dns: c.dns[0] ?? "",
  };
}

function NetworkSection({ api, guard }: { api: ControlPanelSession; guard: Guard }) {
  const { t } = usePanelTranslation();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState<FieldName>("address");
  const [pending, setPending] = useState<{ until: number; before: Card } | null>(null);
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(() => guard(api.network()).then((c) => c && setCards(c)), [api, guard]);
  useEffect(() => { void reload(); }, [reload]);

  // The countdown, and a fresh read every few seconds while a change waits.
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() > pending.until + 2_000) { setPending(null); void reload(); }
    }, 1_000);
    return () => window.clearInterval(id);
  }, [pending, reload]);

  const invalid = draft && draft.method === "manual"
    ? !isIpv4(draft.address) || !(Number(draft.prefix) >= 1 && Number(draft.prefix) <= 32)
      || (draft.gateway !== "" && !isIpv4(draft.gateway)) || (draft.dns !== "" && !isIpv4(draft.dns))
    : false;

  const apply = async () => {
    if (!draft || !editing || invalid) return;
    const before = cards?.find((c) => c.name === editing);
    const change = draft.method === "auto" ? { method: "auto" as const } : {
      method: "manual" as const, address: draft.address.trim(), prefix: Number(draft.prefix),
      gateway: draft.gateway.trim() || undefined, dns: draft.dns.trim() ? [draft.dns.trim()] : [],
    };
    const r = await guard(api.setIpv4(editing, change));
    if (!r || !before) return;
    setPending({ until: Date.now() + r.confirm_within_secs * 1000, before });
    setNow(Date.now());
    setEditing(null);
    window.setTimeout(() => void reload(), 3_000);
  };

  const confirmChange = async () => { await guard(api.confirmNetwork()); setPending(null); void reload(); };
  const rollbackChange = async () => { await guard(api.rollbackNetwork()); setPending(null); window.setTimeout(() => void reload(), 2_000); };

  const key = (k: string) => {
    if (!draft) return;
    const v = draft[focus];
    const next = k === "⌫" ? v.slice(0, -1) : v + k;
    setDraft({ ...draft, [focus]: next });
  };
  const move = (dir: 1 | -1) => setFocus((f) => FIELDS[(FIELDS.indexOf(f) + dir + FIELDS.length) % FIELDS.length]);

  if (!cards) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  return (
    <div style={{ paddingBottom: editing && draft?.method === "manual" ? 110 : 0 }}>
      {cards.length === 0 && <div style={card}>{t("controlPanel.noCards")}</div>}
      {cards.map((c) => (
        <div key={c.name} style={{ ...card, opacity: c.state === "unavailable" ? 0.6 : 1 }} data-testid={`card-${c.name}`}>
          <Row label={t("controlPanel.card")}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%", display: "inline-block", marginRight: 8,
              background: pending && c.name === pending.before.name ? C.warn : c.state === "connected" ? C.ok : c.state === "connecting" ? C.warn : C.line,
            }} />
            {c.name} · {t(`controlPanel.state.${c.state}`)}
          </Row>
          {c.addresses.length > 0 && (
            <Row label={t("controlPanel.addressNow")}>
              {c.addresses.join(", ")}
              {c.method === "auto" && <Tag>DHCP</Tag>}
              {c.method === "manual" && <Tag tone={pending ? "warn" : "ok"}>{pending ? t("controlPanel.staticToConfirm") : t("controlPanel.static")}</Tag>}
            </Row>
          )}
          {(c.gateway || c.dns.length > 0) && <Row label={t("controlPanel.gatewayDns")}>{[c.gateway ?? "—", c.dns.join(", ") || "—"].join(" · ")}</Row>}
          {c.mac && <Row label="MAC"><span style={{ color: C.muted }}>{c.mac}</span></Row>}
          {editing !== c.name && c.method !== null && !pending && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button type="button" style={btn} onClick={() => { setEditing(c.name); setDraft(draftOf(c)); setFocus("address"); }}>
                {t("controlPanel.change")}
              </button>
            </div>
          )}
          {editing === c.name && draft && (
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 12 }}>
              <Row label="IPv4">
                <Segmented value={draft.method} onChange={(m) => setDraft({ ...draft, method: m })}
                  options={[{ value: "auto", label: "DHCP" }, { value: "manual", label: t("controlPanel.static") }]} />
              </Row>
              {draft.method === "manual" && (<>
                <Row label={t("controlPanel.address")}>
                  <IpField name="address" draft={draft} setDraft={setDraft} focus={focus} setFocus={setFocus} />
                  <span style={{ color: C.muted, margin: "0 6px" }}>/</span>
                  <IpField name="prefix" draft={draft} setDraft={setDraft} focus={focus} setFocus={setFocus} width={60} />
                </Row>
                <Row label={t("controlPanel.gateway")}><IpField name="gateway" draft={draft} setDraft={setDraft} focus={focus} setFocus={setFocus} /></Row>
                <Row label="DNS"><IpField name="dns" draft={draft} setDraft={setDraft} focus={focus} setFocus={setFocus} /></Row>
              </>)}
              {/* With the keypad open, Cancel and Apply live on the keypad. */}
              {draft.method === "auto" && <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" style={btn} onClick={() => setEditing(null)}>{t("controlPanel.cancel")}</button>
                <button type="button" style={btnPrimary} onClick={() => void apply()}>
                  {t("controlPanel.apply")}
                </button>
              </div>}
            </div>
          )}
        </div>
      ))}
      {editing && draft?.method === "manual" && (
        <div style={{
          position: "fixed", left: 220, right: 0, bottom: 0, background: "#14181d", borderTop: `1px solid ${C.line}`,
          padding: 10, display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6,
        }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "."].map((k) => (
            <button key={k} type="button" style={{ ...btn, height: 42, fontSize: 18 }} onClick={() => key(k)}>{k}</button>
          ))}
          <button type="button" style={{ ...btn, height: 42 }} onClick={() => key("⌫")} aria-label="backspace">⌫</button>
          <button type="button" style={{ ...btn, gridColumn: "span 2", height: 42 }} onClick={() => move(-1)}>← {t("controlPanel.field")}</button>
          <button type="button" style={{ ...btn, gridColumn: "span 2", height: 42 }} onClick={() => move(1)}>{t("controlPanel.field")} →</button>
          <button type="button" style={{ ...btn, gridColumn: "span 2", height: 42 }} onClick={() => setEditing(null)}>{t("controlPanel.cancel")}</button>
          <button type="button" style={{ ...btnPrimary, gridColumn: "span 2", height: 42, opacity: invalid ? 0.5 : 1 }}
            disabled={!!invalid} onClick={() => void apply()}>{t("controlPanel.apply")}</button>
        </div>
      )}
      {pending && (
        <ConfirmBar until={pending.until} now={now}
          before={pending.before.method === "manual" ? pending.before.addresses[0] ?? "" : `DHCP (${pending.before.addresses[0] ?? "—"})`}
          onConfirm={() => void confirmChange()} onRollback={() => void rollbackChange()} />
      )}
    </div>
  );
}

/** The 60-second bar of a network change: confirm it, or it goes back. */
function ConfirmBar({ until, now, before, onConfirm, onRollback }: {
  until: number; now: number; before: string; onConfirm: () => void; onRollback: () => void;
}) {
  const { t } = usePanelTranslation();
  const secs = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <div data-testid="network-confirm" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, background: "#3b2f12", borderTop: `2px solid ${C.warn}`,
      display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", zIndex: 1,
    }}>
      <div style={{ fontSize: 30, fontWeight: "bold", color: C.warn, width: 60, textAlign: "center" }}>{secs}</div>
      <div style={{ flex: 1 }}>
        <b style={{ display: "block", fontSize: 17 }}>{t("controlPanel.confirmQuestion")}</b>
        <span style={{ color: "#e9d8b0", fontSize: 14 }}>{t("controlPanel.confirmHelp", { secs, before })}</span>
      </div>
      <button type="button" style={btn} onClick={onRollback}>{t("controlPanel.rollback")}</button>
      <button type="button" style={btnPrimary} onClick={onConfirm}>{t("controlPanel.confirm")}</button>
    </div>
  );
}

/** A pending change: the deadline, what it goes back to, and a clock. */
function usePending(reload: () => void) {
  const [pending, setPending] = useState<{ until: number; before: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() > pending.until + 2_000) { setPending(null); reload(); }
    }, 1_000);
    return () => window.clearInterval(id);
  }, [pending, reload]);
  const start = (secs: number, before: string) => { setPending({ until: Date.now() + secs * 1000, before }); setNow(Date.now()); };
  return { pending, now, start, clear: () => setPending(null) };
}

// ── On-screen keyboard ───────────────────────────────────────────────────────

const LETTERS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SYMBOLS = ["1234567890", "-_@#&*+=()", ".,:;!?'\"/"];

/** Letters, capitals and symbols for SSIDs and passwords: the devices have no
 * keyboard. `onKey` gets a character, `⌫`, or `⏎` for Done. */
function TextKeyboard({ onKey }: { onKey: (k: string) => void }) {
  const { t } = usePanelTranslation();
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const rows = symbols ? SYMBOLS : LETTERS;
  const key: CSSProperties = { ...btn, height: 42, fontSize: 18, padding: 0, flex: 1 };
  return (
    <div data-testid="text-keyboard" style={{
      position: "fixed", left: 220, right: 0, bottom: 0, background: "#14181d", borderTop: `1px solid ${C.line}`,
      padding: 8, display: "flex", flexDirection: "column", gap: 6, zIndex: 2,
    }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, padding: i === 1 && !symbols ? "0 24px" : 0 }}>
          {i === 2 && !symbols && (
            <button type="button" style={{ ...key, flex: 1.5, background: shift ? C.accent : C.panel2 }} onClick={() => setShift(!shift)}>⇧</button>
          )}
          {[...r].map((c) => {
            const ch = shift && !symbols ? c.toUpperCase() : c;
            return <button key={c} type="button" style={key} onClick={() => onKey(ch)}>{ch}</button>;
          })}
          {i === 2 && <button type="button" style={{ ...key, flex: 1.5 }} onClick={() => onKey("⌫")} aria-label="backspace">⌫</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={{ ...key, flex: 1.5, fontSize: 15 }} onClick={() => setSymbols(!symbols)}>
          {symbols ? t("controlPanel.kbLetters") : t("controlPanel.kbSymbols")}
        </button>
        <button type="button" style={{ ...key, flex: 6, fontSize: 15, color: C.muted }} onClick={() => onKey(" ")}>{t("controlPanel.kbSpace")}</button>
        <button type="button" style={{ ...btnPrimary, height: 42, flex: 2, padding: 0 }} onClick={() => onKey("⏎")}>{t("controlPanel.kbDone")}</button>
      </div>
    </div>
  );
}

function typeInto(value: string, k: string, max = 63): string {
  if (k === "⌫") return value.slice(0, -1);
  return value.length < max ? value + k : value;
}

function fieldStyle(active: boolean, bad: boolean | undefined, width: number): CSSProperties {
  return {
    ...field, width, fontFamily: "inherit",
    borderColor: bad ? C.bad : active ? C.accent : C.line,
    boxShadow: active ? "0 0 0 2px #4f9cf040" : "none",
  };
}

function TextField({ value, onChange, active, onFocus, secret, testId, width = 260, bad }: {
  value: string; onChange: (v: string) => void; active: boolean; onFocus: () => void;
  secret?: boolean; testId?: string; width?: number; bad?: boolean;
}) {
  // A password goes through the shared field with the eye (check_campi_password).
  if (secret) {
    return (
      <CampoPassword value={value} data-testid={testId} autoComplete="off"
        onFocus={onFocus} onChange={(e) => onChange(e.target.value)} style={fieldStyle(active, bad, width)} />
    );
  }
  return (
    <input value={value} data-testid={testId} autoComplete="off"
      onFocus={onFocus} onChange={(e) => onChange(e.target.value)} style={fieldStyle(active, bad, width)} />
  );
}

// ── Wi-Fi ────────────────────────────────────────────────────────────────────

function Bars({ signal }: { signal: number }) {
  const n = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : 1;
  return (
    <span aria-label={`${signal}%`} style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 16, marginRight: 10 }}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} style={{ width: 4, height: 4 * i, borderRadius: 1, background: i <= n ? C.text : C.line }} />
      ))}
    </span>
  );
}

type WifiForm =
  | { kind: "join"; ssid: string; password: string; hidden: boolean; focus: "ssid" | "password" }
  | { kind: "hotspot"; ssid: string; password: string; focus: "ssid" | "password" };

function WifiSection({ api, guard }: { api: ControlPanelSession; guard: Guard }) {
  const { t } = usePanelTranslation();
  const [wifi, setWifi] = useState<WifiState | null>(null);
  const [hotspot, setHotspot] = useState<Hotspot | null>(null);
  const [form, setForm] = useState<WifiForm | null>(null);

  const reload = useCallback(() => {
    void guard(api.wifi()).then((w) => w && setWifi(w));
    void guard(api.hotspot()).then((h) => h && setHotspot(h));
  }, [api, guard]);
  const { pending, now, start, clear } = usePending(reload);
  useEffect(() => { reload(); }, [reload]);

  const scan = async () => {
    await guard(api.wifiScan());
    window.setTimeout(reload, 3_000);
  };
  const beforeText = (w: WifiState) =>
    w.mode === "client" && w.active_ssid ? t("controlPanel.wifiBefore", { ssid: w.active_ssid })
      : w.mode === "hotspot" && w.active_ssid ? t("controlPanel.hotspotBefore", { ssid: w.active_ssid })
        : t("controlPanel.wifiNothing");

  const join = async (n: WifiNetwork | null) => {
    if (!wifi) return;
    // A saved or open network joins at once; the others ask for the password.
    if (n && (n.known || n.security === "open")) {
      const r = await guard(api.wifiConnect({ ssid: n.ssid }));
      if (r) { start(r.confirm_within_secs, beforeText(wifi)); window.setTimeout(reload, 3_000); }
      return;
    }
    setForm({ kind: "join", ssid: n?.ssid ?? "", password: "", hidden: !n, focus: n ? "password" : "ssid" });
  };

  const submit = async () => {
    if (!form || !wifi) return;
    const r = form.kind === "join"
      ? await guard(api.wifiConnect({ ssid: form.ssid, password: form.password || undefined, hidden: form.hidden }))
      : await guard(api.setHotspot({ enabled: true, ssid: form.ssid, password: form.password }));
    if (!r) return;
    setForm(null);
    start(r.confirm_within_secs, beforeText(wifi));
    window.setTimeout(reload, 3_000);
  };

  const hotspotOff = async () => {
    if (!wifi || !hotspot) return;
    const r = await guard(api.setHotspot({ enabled: false, ssid: hotspot.ssid, password: hotspot.password }));
    if (r) { start(r.confirm_within_secs, beforeText(wifi)); window.setTimeout(reload, 3_000); }
  };

  const confirmChange = async () => { await guard(api.confirmNetwork()); clear(); reload(); };
  const rollbackChange = async () => { await guard(api.rollbackNetwork()); clear(); window.setTimeout(reload, 2_000); };

  if (!wifi) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  if (!wifi.card) return <div style={card}>{t("controlPanel.noWifiCard")}</div>;

  const formInvalid = !form || form.ssid.length === 0 || form.ssid.length > 32
    || (form.kind === "hotspot" ? !isPsk(form.password) : form.password !== "" && !isPsk(form.password));
  const onKey = (k: string) => {
    if (!form) return;
    if (k === "⏎") { if (!formInvalid) void submit(); return; }
    setForm({ ...form, [form.focus]: typeInto(form[form.focus], k, form.focus === "ssid" ? 32 : 63) });
  };
  const hotspotOn = wifi.mode === "hotspot";

  return (
    <div style={{ paddingBottom: form ? 230 : pending ? 80 : 0 }}>
      <div style={card}>
        <Row label={t("controlPanel.wifiCard")}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", display: "inline-block", marginRight: 8,
            background: pending ? C.warn : wifi.mode === "client" || hotspotOn ? C.ok : C.line,
          }} />
          {wifi.card} · {t(`controlPanel.wifiState.${wifi.mode}`)}{wifi.active_ssid ? ` · ${wifi.active_ssid}` : ""}
        </Row>
        <Row label={t("controlPanel.radio")}>
          <Segmented value={wifi.radio ? "on" : "off"} onChange={(v) => void guard(api.wifiRadio(v === "on")).then(() => window.setTimeout(reload, 1_500))}
            options={[{ value: "on", label: t("controlPanel.on") }, { value: "off", label: t("controlPanel.off") }]} />
        </Row>
      </div>

      {wifi.radio && !hotspotOn && (
        <div style={card} data-testid="wifi-networks">
          <div style={{ ...row, justifyContent: "space-between" }}>
            <b style={{ fontSize: 16 }}>{t("controlPanel.networks")}</b>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn} onClick={() => void join(null)}>{t("controlPanel.hiddenNetwork")}</button>
              <button type="button" style={btn} onClick={() => void scan()}>{t("controlPanel.scan")}</button>
            </span>
          </div>
          {wifi.networks.length === 0 && <div style={{ color: C.muted, padding: "8px 0" }}>{t("controlPanel.noNetworks")}</div>}
          {wifi.networks.map((n) => (
            <div key={n.ssid} style={{ ...row, borderTop: `1px solid ${C.line}`, opacity: n.security === "enterprise" ? 0.5 : 1 }} data-testid={`wifi-${n.ssid}`}>
              <Bars signal={n.signal} />
              <span style={{ flex: 1, fontSize: 16 }}>
                {n.ssid}
                <small style={{ color: C.muted, marginLeft: 8 }}>{t(`controlPanel.security.${n.security}`)}</small>
                {n.active ? <Tag>{t("controlPanel.connected")}</Tag> : n.known ? <Tag tone="warn">{t("controlPanel.saved")}</Tag> : null}
              </span>
              {n.known && !n.active && <button type="button" style={{ ...btn, color: C.muted }} onClick={() => void guard(api.wifiForget(n.ssid)).then(reload)}>{t("controlPanel.forget")}</button>}
              {!n.active && n.security !== "enterprise" && !pending && (
                <button type="button" style={btn} onClick={() => void join(n)}>{t("controlPanel.join")}</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={card} data-testid="wifi-hotspot">
        <div style={{ ...row, justifyContent: "space-between" }}>
          <b style={{ fontSize: 16 }}>{t("controlPanel.hotspot")}{hotspotOn && <Tag>{t("controlPanel.on")}</Tag>}</b>
          {wifi.can_hotspot && hotspot && !pending && (hotspotOn
            ? <button type="button" style={btn} onClick={() => void hotspotOff()}>{t("controlPanel.hotspotTurnOff")}</button>
            : <button type="button" style={btnPrimary} onClick={() => setForm({ kind: "hotspot", ssid: hotspot.ssid, password: hotspot.password, focus: "password" })}>
              {t("controlPanel.hotspotTurnOn")}
            </button>)}
        </div>
        {!wifi.can_hotspot ? <div style={{ color: C.muted, fontSize: 14 }}>{t("controlPanel.hotspotCannot")}</div> : (<>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>{t("controlPanel.hotspotHelp")} {t("controlPanel.hotspotExcludes")}</div>
          {hotspotOn && hotspot?.qr && (
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <QrCode text={hotspot.qr} size={150} label={t("controlPanel.hotspotScan")} />
              <div>
                <Row label={t("controlPanel.ssid")}>{hotspot.ssid}</Row>
                <Row label={t("controlPanel.password")}><span style={{ fontFamily: "'DejaVu Sans Mono', monospace" }}>{hotspot.password}</span></Row>
              </div>
            </div>
          )}
        </>)}
      </div>

      {form && (
        <div style={{ ...card, borderColor: C.accent }} data-testid="wifi-form">
          <Row label={t("controlPanel.ssid")}>
            {form.kind === "join" && !form.hidden ? <b>{form.ssid}</b> : (
              <TextField value={form.ssid} testId="wifi-ssid" active={form.focus === "ssid"}
                onFocus={() => setForm({ ...form, focus: "ssid" })} onChange={(v) => setForm({ ...form, ssid: v })} />
            )}
          </Row>
          <Row label={t("controlPanel.password")}>
            <TextField value={form.password} testId="wifi-password" secret active={form.focus === "password"}
              bad={form.password !== "" && !isPsk(form.password)}
              onFocus={() => setForm({ ...form, focus: "password" })} onChange={(v) => setForm({ ...form, password: v })} />
          </Row>
          {form.kind === "hotspot" && hotspot?.proposed && <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.hotspotProposed")}</div>}
          {form.password !== "" && !isPsk(form.password) && <div style={{ color: "#f1b0ad", fontSize: 13 }}>{t("controlPanel.passwordShort")}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
            <button type="button" style={btn} onClick={() => setForm(null)}>{t("controlPanel.cancel")}</button>
            <button type="button" style={{ ...btnPrimary, opacity: formInvalid ? 0.5 : 1 }} disabled={formInvalid} onClick={() => void submit()}>
              {form.kind === "join" ? t("controlPanel.join") : t("controlPanel.hotspotTurnOn")}
            </button>
          </div>
        </div>
      )}
      {form && <TextKeyboard onKey={onKey} />}
      {pending && !form && (
        <ConfirmBar until={pending.until} now={now} before={pending.before}
          onConfirm={() => void confirmChange()} onRollback={() => void rollbackChange()} />
      )}
    </div>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

function ScreenSection({ api, guard, caps }: { api: ControlPanelSession; guard: Guard; caps: Capabilities | null }) {
  const { t } = usePanelTranslation();
  const [brightness, setBrightness] = useState<number | null | undefined>(undefined);
  const [draft, setDraft] = useState(80);
  useEffect(() => {
    if (!caps?.display) return;
    void guard(api.display()).then((d) => { if (d) { setBrightness(d.brightness); if (d.brightness != null) setDraft(d.brightness); } });
  }, [api, guard, caps]);
  const calibration = caps?.touch_calibration_service && (
    <div style={card}>
      <Row label={t("controlPanel.calibration")}>
        <button type="button" style={btn} onClick={() => void guard(api.startTouchCalibration())}>{t("controlPanel.calibrate")}</button>
      </Row>
    </div>
  );
  if (!caps?.display) return <>{calibration}</>;
  if (brightness === undefined) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const save = (v: number | null) => void guard(api.setDisplay(v)).then(() => setBrightness(v));
  return (<>
    <div style={card} data-testid="screen-section">
      <Row label={t("controlPanel.brightness")}>
        <Segmented value={brightness === null ? "project" : "here"}
          onChange={(v) => save(v === "project" ? null : draft)}
          options={[{ value: "project", label: t("controlPanel.brightnessProject") }, { value: "here", label: t("controlPanel.brightnessHere") }]} />
      </Row>
      {brightness !== null && (
        <Row label="">
          <input type="range" min={5} max={100} value={draft} data-testid="brightness"
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => save(draft)} onKeyUp={() => save(draft)}
            style={{ width: 320 }} />
          <span style={{ marginLeft: 12, width: 50, display: "inline-block" }}>{draft} %</span>
        </Row>
      )}
      <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.brightnessHelp")}</div>
    </div>
    {calibration}
  </>);
}

function IpField({ name, draft, setDraft, focus, setFocus, width }: {
  name: FieldName; draft: Draft; setDraft: (d: Draft) => void; focus: FieldName; setFocus: (f: FieldName) => void; width?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const bad = draft[name] !== "" && (name === "prefix" ? !(Number(draft[name]) >= 1 && Number(draft[name]) <= 32) : !isIpv4(draft[name]));
  return (
    <input ref={ref} value={draft[name]} inputMode="decimal" data-testid={`ip-${name}`}
      onFocus={() => setFocus(name)}
      onChange={(e) => setDraft({ ...draft, [name]: e.target.value.replace(/[^0-9.]/g, "") })}
      style={{
        ...field, width: width ?? 180,
        borderColor: bad ? C.bad : focus === name ? C.accent : C.line,
        boxShadow: focus === name ? "0 0 0 2px #4f9cf040" : "none",
      }} />
  );
}

// ── Time ─────────────────────────────────────────────────────────────────────

function TimeSection({ api, guard }: { api: ControlPanelSession; guard: Guard }) {
  const { t, lang } = usePanelTranslation();
  const [time, setTime] = useState<TimeState | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [readAt, setReadAt] = useState(Date.now());
  const [, tick] = useState(0);
  const [manual, setManual] = useState({ date: "", time: "" });

  const reload = useCallback(() => guard(api.time()).then((x) => { if (x) { setTime(x); setReadAt(Date.now()); } }), [api, guard]);
  useEffect(() => { void reload(); void guard(api.timezones()).then((z) => z && setZones(z)); }, [api, guard, reload]);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 1_000); return () => window.clearInterval(id); }, []);

  if (!time) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const nowMs = time.time_usec / 1000 + (Date.now() - readAt);
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    try { return new Intl.DateTimeFormat(lang, { ...o, timeZone: time.timezone }).format(nowMs); }
    catch { return new Date(nowMs).toISOString(); }
  };
  const setManualTime = async () => {
    const ms = new Date(`${manual.date}T${manual.time}`).getTime();
    if (Number.isNaN(ms)) return;
    await guard(api.setTime({ time_usec: ms * 1000 }));
    void reload();
  };
  return (<>
    <div style={card}>
      <Row label={t("controlPanel.deviceTime")}>
        <span style={{ fontSize: 28 }}>{fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        <span style={{ color: C.muted, fontSize: 15, marginLeft: 10 }}>{fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      </Row>
      <Row label={t("controlPanel.sync")}>
        <Segmented value={time.ntp ? "ntp" : "manual"}
          onChange={(v) => void guard(api.setTime({ ntp: v === "ntp" })).then(reload)}
          options={[{ value: "ntp", label: t("controlPanel.ntp") }, { value: "manual", label: t("controlPanel.manual") }]} />
        {time.ntp && (time.ntp_synchronized ? <Tag>{t("controlPanel.synced")}</Tag> : <Tag tone="warn">{t("controlPanel.notSynced")}</Tag>)}
      </Row>
      <Row label={t("controlPanel.timezone")}>
        <select value={time.timezone} onChange={(e) => void guard(api.setTime({ timezone: e.target.value })).then(reload)}
          style={{ ...field, width: 260, fontFamily: "inherit" }}>
          {(zones.length ? zones : [time.timezone]).map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </Row>
    </div>
    <div style={{ ...card, opacity: time.ntp ? 0.55 : 1 }}>
      <Row label={t("controlPanel.dateTime")}>
        <input type="date" disabled={time.ntp} value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} style={{ ...field, width: 170 }} />
        <input type="time" disabled={time.ntp} value={manual.time} onChange={(e) => setManual({ ...manual, time: e.target.value })} style={{ ...field, width: 110 }} />
        <button type="button" style={btn} disabled={time.ntp || !manual.date || !manual.time} onClick={() => void setManualTime()}>{t("controlPanel.apply")}</button>
      </Row>
      {time.ntp && <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.manualOnlyWhenOff")}</div>}
    </div>
  </>);
}

// ── Device ───────────────────────────────────────────────────────────────────

function DeviceSection({ api, guard, info, caps }: {
  api: ControlPanelSession; guard: Guard; info: DeviceInfo | null; caps: Capabilities | null;
}) {
  const { t } = usePanelTranslation();
  const [ask, setAsk] = useState<"reboot" | "power_off" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!info) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const go = async () => {
    const what = ask;
    setAsk(null);
    // Both answer with no body: success is "no error", which `guard` cannot
    // tell from a failure, so the error goes through it only when there is one.
    try {
      if (what === "reboot") await api.reboot();
      else await api.powerOff();
      setDone(what === "reboot" ? t("controlPanel.rebooting") : t("controlPanel.poweringOff"));
    } catch (e) {
      void guard(Promise.reject(e));
    }
  };
  return (<>
    <div style={card}>
      <Row label={t("controlPanel.model")}>{info.model ?? "—"}</Row>
      <Row label={t("controlPanel.serial")}>{info.serial ?? "—"}</Row>
      <Row label={t("controlPanel.hostname")}>{info.hostname ? `${info.hostname}.local` : "—"}</Row>
      <Row label={t("controlPanel.swsVersion")}>{info.sws_version}</Row>
      {info.initial_pin && (<>
        <Row label={t("controlPanel.pin")}>{info.initial_pin}<Tag tone="warn">{t("controlPanel.pinInitial")}</Tag></Row>
        <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.pinInitialWarning")}</div>
      </>)}
    </div>
    <div style={card}>
      {done ? <div>{done}</div> : ask ? (
        <div style={row}>
          <span>{ask === "reboot" ? t("controlPanel.rebootAsk") : t("controlPanel.powerOffAsk")}</span>
          <button type="button" style={btn} onClick={() => setAsk(null)}>{t("controlPanel.cancel")}</button>
          <button type="button" style={{ ...btnPrimary, background: ask === "power_off" ? C.bad : C.accent, borderColor: ask === "power_off" ? C.bad : C.accent }}
            onClick={() => void go()}>{ask === "reboot" ? t("controlPanel.reboot") : t("controlPanel.powerOff")}</button>
        </div>
      ) : (
        <div style={row}>
          {caps?.reboot !== false && <button type="button" style={btn} onClick={() => setAsk("reboot")}>{t("controlPanel.reboot")}</button>}
          {caps?.power_off && <button type="button" style={{ ...btn, borderColor: "#7b3633", color: "#f1b0ad" }} onClick={() => setAsk("power_off")}>{t("controlPanel.powerOff")}</button>}
        </div>
      )}
    </div>
  </>);
}

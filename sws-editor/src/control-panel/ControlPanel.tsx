// The device control panel on the web viewer: service PIN, then network,
// Wi-Fi, time, screen and device sections over `/api/control-panel/*`. Plan
// docs/archive/2026-11-13-pannello-di-controllo.md, phases 2 and 4; the look
// follows the preview the maintainer approved on 13-11-2026.
//
// It covers the whole screen and works with a finger only: the panels have no
// keyboard, so PIN and addresses have their own keypads. A physical keyboard
// still types in the fields.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CampoPassword } from "@/components/CampoPassword";
import { QrCode } from "@/components/QrCode";
import { usePanelTranslation } from "./language";
import { cityOf, continentsIn, countriesIn, search, zoneLabel, type CountryEntry, type Zone } from "./timezones";
import {
  type About,
  type NtpServers,
  type PanelCornerOptions,
  isNtpServer,
  MAX_NTP_SERVERS,
  splitNtpServers,
  isIpv4,
  isPsk,
  getStatus,
  openSession,
  PinError,
  session as makeSession,
  SessionExpired,
  splitCidr,
  type Capabilities,
  type OpenPlc,
  type Card,
  type ControlPanelSession,
  type DeviceInfo,
  type DisplaySettings,
  type Hotspot,
  type RebootCorner,
  type RebootCornerOptions,
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

type Section = "network" | "wifi" | "time" | "screen" | "device" | "openplc" | "about";

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
  // The device's PIN counts only from the device's own screen: from anywhere
  // else, without a project PIN, there is nothing to type.
  const [screenOnly, setScreenOnly] = useState(false);
  useEffect(() => {
    getStatus().then((s) => setScreenOnly(s.pin === "screen_only")).catch(() => {});
  }, []);

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
        {screenOnly && (
          <p role="alert" data-testid="control-panel-screen-only" style={{ margin: "0 0 14px", color: C.warn, fontSize: 14 }}>
            {t("controlPanel.pinScreenOnly")}
          </p>
        )}
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
  // The cards as the panel last saw them, and a count of dongles come or gone.
  const [watched, setWatched] = useState<{ cards: Card[]; plugs: number } | null>(null);
  useCardWatch(api, onExpired, (cards, plugged) => {
    setWatched((w) => ({ cards, plugs: (w?.plugs ?? 0) + (plugged ? 1 : 0) }));
    if (plugged) void guard(api.capabilities()).then((c) => c && setCaps(c));
  });

  const sections: { id: Section; label: string; on: boolean }[] = [
    { id: "network", label: t("controlPanel.network"), on: caps?.network ?? true },
    { id: "wifi", label: t("controlPanel.wifi"), on: caps?.wifi ?? false },
    { id: "time", label: t("controlPanel.time"), on: caps?.time ?? true },
    // On the web: the brightness and PixsysOS' calibration. The resistive
    // calibration of the Tiny TY is the LVGL viewer's.
    { id: "screen", label: t("controlPanel.screen"), on: true },
    { id: "device", label: t("controlPanel.device"), on: true },
    ...(caps?.openplc ? [{ id: "openplc" as const, label: t("controlPanel.openplc"), on: true }] : []),
    { id: "about", label: t("controlPanel.about"), on: true },
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
        {error && <div role="alert" style={{ ...card, borderColor: C.bad, color: "#f1b0ad" }}>{errorText(error, t)}</div>}
        {section === "network" && <NetworkSection api={api} guard={guard} watched={watched?.cards ?? null} />}
        {section === "wifi" && <WifiSection api={api} guard={guard} watched={watched} />}
        {section === "time" && <TimeSection api={api} guard={guard} />}
        {section === "screen" && <ScreenSection api={api} guard={guard} caps={caps} />}
        {section === "device" && <DeviceSection api={api} guard={guard} info={info} caps={caps} />}
        {section === "openplc" && <OpenPlcSection api={api} guard={guard} />}
        {section === "about" && <AboutSection api={api} guard={guard} />}
      </main>
    </div>
  );
}

type Guard = <T>(p: Promise<T>) => Promise<T | undefined>;

/** The runtime's error, in words when it is one of its stable codes: a Wi-Fi
 *  key the network refused, or another failure, already undone. */
function errorText(e: string, t: (k: string) => string): string {
  if (e === "wifi-wrong-password") return t("controlPanel.wifiWrongPassword");
  if (e.startsWith("wifi-failed")) return t("controlPanel.wifiFailed");
  if (e === "usb-not-mounted") return t("controlPanel.diagnosticsNoUsb");
  if (e === "usb-mounting") return t("controlPanel.diagnosticsMounting");
  if (e === "usb-format") return t("controlPanel.diagnosticsFormat");
  return e;
}

/** One way of giving the device back: title, what it removes, its button on the right. */
function ResetBlock({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ color: C.text, fontSize: 15 }}>{title}</div>
      <div style={{ color: C.muted, fontSize: 13 }}>{help}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>{children}</div>
    </div>
  );
}

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

/** While the panel is open, the cards again every 3 s: a Wi-Fi dongle plugged
 *  in or pulled out shows up by itself (TY570, 14-11-2026). `changed` runs only
 *  when the list differs, with whether a card came or went. Not through
 *  `guard`: no error line, and the request does not keep the session alive. */
function useCardWatch(api: ControlPanelSession, onExpired: () => void, changed: (cards: Card[], plugged: boolean) => void) {
  const last = useRef<string | null>(null);
  const cb = useRef(changed);
  cb.current = changed;
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    const look = () => void api.watchNetwork().then((c) => {
      const key = JSON.stringify(c);
      const names = (k: string | null) => (k ? (JSON.parse(k) as Card[]).map((x) => x.name).join() : null);
      if (key === last.current) return;
      // The first look is the baseline, read with the section.
      const plugged = last.current !== null && names(last.current) !== names(key);
      last.current = key;
      cb.current(c, plugged);
    }, (e) => { if (e instanceof SessionExpired) expired.current(); });
    look();
    const id = window.setInterval(look, 3_000);
    return () => window.clearInterval(id);
  }, [api]);
}

function NetworkSection({ api, guard, watched }: { api: ControlPanelSession; guard: Guard; watched: Card[] | null }) {
  const { t } = usePanelTranslation();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState<FieldName>("address");
  const [pending, setPending] = useState<{ until: number; before: Card } | null>(null);
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(() => guard(api.network()).then((c) => c && setCards(c)), [api, guard]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (watched) setCards(watched); }, [watched]);

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

function WifiSection({ api, guard, watched }: {
  api: ControlPanelSession; guard: Guard; watched: { cards: Card[]; plugs: number } | null;
}) {
  const { t } = usePanelTranslation();
  const [wifi, setWifi] = useState<WifiState | null>(null);
  const [hotspot, setHotspot] = useState<Hotspot | null>(null);
  const [form, setForm] = useState<WifiForm | null>(null);
  const [cards, setCards] = useState<Card[]>([]);

  const reload = useCallback(() => {
    void guard(api.wifi()).then((w) => w && setWifi(w));
    void guard(api.hotspot()).then((h) => h && setHotspot(h));
    // The addresses of the network joined (maintainer, 14-11-2026): the card
    // as the Network section shows it.
    void guard(api.network()).then((c) => c && setCards(c));
  }, [api, guard]);
  const { pending, now, start, clear } = usePending(reload);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (watched) setCards(watched.cards); }, [watched]);
  // A dongle came or went: the Wi-Fi state again. Not on the first render.
  const plugs = useRef(watched?.plugs ?? 0);
  useEffect(() => {
    if (!watched || watched.plugs === plugs.current) return;
    plugs.current = watched.plugs;
    reload();
  }, [watched, reload]);

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
        {(() => {
          const c = cards.find((x) => x.name === wifi.card);
          if (wifi.mode !== "client" || !c || (c.addresses.length === 0 && !c.addresses6?.length)) return null;
          // Joined, but the network gave no IPv4 (its DHCP did not answer): the IPv6 address, and a line that says so.
          if (c.addresses.length === 0) return (<>
            <Row label={t("controlPanel.wifiDetails")}>
              <span data-testid="wifi-addresses">{c.addresses6!.join(", ")}</span>
              <Tag tone="warn">{t("controlPanel.wifiNoIpv4Tag")}</Tag>
            </Row>
            <div data-testid="wifi-no-ipv4" style={{ color: C.warn, fontSize: 13 }}>{t("controlPanel.wifiNoIpv4")}</div>
          </>);
          return (<>
            <Row label={t("controlPanel.wifiDetails")}>
              <span data-testid="wifi-addresses">{c.addresses.join(", ")}</span>
              <Tag>{c.method === "manual" ? t("controlPanel.static") : "DHCP"}</Tag>
            </Row>
            {(c.gateway || c.dns.length > 0) && <Row label={t("controlPanel.gatewayDns")}>{[c.gateway ?? "—", c.dns.join(", ") || "—"].join(" · ")}</Row>}
          </>);
        })()}
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

function Stepper({ value, onLess, onMore }: { value: string; onLess: () => void; onMore: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button type="button" style={{ ...btn, width: 48 }} onClick={onLess}>-</button>
      <span style={{ minWidth: 64, textAlign: "center" }}>{value}</span>
      <button type="button" style={{ ...btn, width: 48 }} onClick={onMore}>+</button>
    </span>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** None and the four corners, without the one the other gesture has: two long
 *  presses cannot share a corner. */
function cornerChoices(t: (k: string) => string, taken: RebootCorner): { value: RebootCorner; label: string }[] {
  const all: { value: RebootCorner; label: string }[] = [
    { value: "none", label: t("controlPanel.rebootCornerNone") },
    { value: "top_left", label: t("controlPanel.cornerTopLeft") },
    { value: "top_right", label: t("controlPanel.cornerTopRight") },
    { value: "bottom_left", label: t("controlPanel.cornerBottomLeft") },
    { value: "bottom_right", label: t("controlPanel.cornerBottomRight") },
  ];
  return all.filter((c) => c.value === "none" || c.value !== taken);
}

/** The corner that opens this panel when held, on every device: where, for
 *  how long and how large. While the card is on screen a green square shows
 *  the real area. */
function PanelCornerCard({ api, guard, corner, options, taken, onChange }: {
  api: ControlPanelSession; guard: Guard; corner: RebootCorner; options: PanelCornerOptions; taken: RebootCorner;
  onChange: (c: RebootCorner, o: PanelCornerOptions) => void;
}) {
  const { t } = usePanelTranslation();
  const save = (c: RebootCorner, o: PanelCornerOptions) =>
    void guard(api.setPanelCorner(c, o)).then(() => onChange(c, o));
  return (
    <div style={card} data-testid="panel-corner">
      <Row label={t("controlPanel.panelCorner")}>
        <Segmented value={corner} options={cornerChoices(t, taken)} onChange={(c) => save(c, options)} />
      </Row>
      {corner !== "none" && (<>
        <Row label={t("controlPanel.rebootCornerHold")}>
          <Stepper value={`${options.hold_secs} s`}
            onLess={() => save(corner, { ...options, hold_secs: clamp(options.hold_secs - 1, 2, 15) })}
            onMore={() => save(corner, { ...options, hold_secs: clamp(options.hold_secs + 1, 2, 15) })} />
        </Row>
        <Row label={t("controlPanel.rebootCornerSize")}>
          <Stepper value={`${options.size_px} px`}
            onLess={() => save(corner, { ...options, size_px: clamp(options.size_px - 20, 40, 200) })}
            onMore={() => save(corner, { ...options, size_px: clamp(options.size_px + 20, 40, 200) })} />
        </Row>
        <div data-testid="panel-corner-preview" style={{
          position: "fixed", zIndex: 9700, pointerEvents: "none", width: options.size_px, height: options.size_px,
          background: "#46b37a46", border: `2px solid ${C.ok}`, boxSizing: "border-box",
          ...(corner.endsWith("left") ? { left: 0 } : { right: 0 }),
          ...(corner.startsWith("bottom") ? { bottom: 0 } : { top: 0 }),
        }} />
      </>)}
      <div style={{ color: corner === "none" ? C.warn : C.muted, fontSize: 13 }}>
        {corner === "none" ? t("controlPanel.panelCornerNoneHelp") : t("controlPanel.panelCornerHelp", { secs: options.hold_secs })}
      </div>
    </div>
  );
}

/** The corner that reboots when held. The options (time, size, question) only
 *  where the LVGL viewer watches it: PixsysOS has its own, fixed. */
function RebootCornerCard({ api, guard, initial, taken, onCorner }: {
  api: ControlPanelSession; guard: Guard; initial: DisplaySettings; taken: RebootCorner; onCorner: (c: RebootCorner) => void;
}) {
  const { t } = usePanelTranslation();
  const [corner, setCorner] = useState<RebootCorner>(initial.reboot_corner ?? "none");
  const [options, setOptions] = useState<RebootCornerOptions | null>(initial.reboot_corner_options ?? null);
  const save = (c: RebootCorner, o: RebootCornerOptions | null) =>
    void guard(api.setRebootCorner(c, o)).then(() => { setCorner(c); setOptions(o); onCorner(c); });
  const choices = cornerChoices(t, taken);
  if (initial.reboot_corner_allowed === false) {
    return (
      <div style={card} data-testid="reboot-corner">
        <Row label={t("controlPanel.rebootCorner")}>
          <span style={{ color: C.muted, fontSize: 14 }}>{t("controlPanel.rebootCornerOffByProject")}</span>
        </Row>
      </div>
    );
  }
  return (
    <div style={card} data-testid="reboot-corner">
      <Row label={t("controlPanel.rebootCorner")}>
        <Segmented value={corner} options={choices} onChange={(c) => save(c, options)} />
      </Row>
      {options && corner !== "none" && (<>
        <Row label={t("controlPanel.rebootCornerHold")}>
          <Stepper value={`${options.hold_secs} s`}
            onLess={() => save(corner, { ...options, hold_secs: clamp(options.hold_secs - 1, 2, 15) })}
            onMore={() => save(corner, { ...options, hold_secs: clamp(options.hold_secs + 1, 2, 15) })} />
        </Row>
        <Row label={t("controlPanel.rebootCornerSize")}>
          <Stepper value={`${options.size_px} px`}
            onLess={() => save(corner, { ...options, size_px: clamp(options.size_px - 20, 40, 200) })}
            onMore={() => save(corner, { ...options, size_px: clamp(options.size_px + 20, 40, 200) })} />
        </Row>
        <Row label={t("controlPanel.rebootCornerConfirm")}>
          <Segmented value={options.confirm ? "yes" : "no"}
            onChange={(v) => save(corner, { ...options, confirm: v === "yes" })}
            options={[{ value: "no", label: t("controlPanel.no") }, { value: "yes", label: t("controlPanel.yes") }]} />
        </Row>
      </>)}
      <div style={{ color: C.muted, fontSize: 13 }}>
        {t("controlPanel.rebootCornerHelp", { secs: options?.hold_secs ?? 5 })}
      </div>
    </div>
  );
}

function ScreenSection({ api, guard, caps }: { api: ControlPanelSession; guard: Guard; caps: Capabilities | null }) {
  const { t } = usePanelTranslation();
  const [settings, setSettings] = useState<DisplaySettings | undefined>(undefined);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [draft, setDraft] = useState(80);
  const [flipped, setFlipped] = useState<boolean | null>(null);
  const [panelCorner, setPanelCorner] = useState<RebootCorner>("top_right");
  const [panelOptions, setPanelOptions] = useState<PanelCornerOptions>({ hold_secs: 5, size_px: 80 });
  const [rebootCorner, setRebootCorner] = useState<RebootCorner>("none");
  useEffect(() => {
    void guard(api.display()).then((d) => {
      if (!d) return;
      setSettings(d); setBrightness(d.brightness); if (d.brightness != null) setDraft(d.brightness);
      setPanelCorner(d.panel_corner ?? "top_right"); setRebootCorner(d.reboot_corner ?? "none");
      setFlipped(d.flipped ?? null);
      if (d.panel_corner_options) setPanelOptions(d.panel_corner_options);
    });
  }, [api, guard]);
  const calibration = caps?.touch_calibration_service && (
    <div style={card}>
      <Row label={t("controlPanel.calibration")}>
        <button type="button" style={btn} onClick={() => void guard(api.startTouchCalibration())}>{t("controlPanel.calibrate")}</button>
      </Row>
    </div>
  );
  if (settings === undefined) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const save = (v: number | null) => void guard(api.setDisplay(v)).then(() => setBrightness(v));
  return (<>
    {caps?.display && (
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
    )}
    {flipped !== null && (
      <div style={card} data-testid="flipped">
        <Row label={t("controlPanel.flipped")}>
          <Segmented value={flipped ? "yes" : "no"}
            onChange={(v) => void guard(api.setFlip(v === "yes")).then(() => setFlipped(v === "yes"))}
            options={[{ value: "no", label: t("controlPanel.no") }, { value: "yes", label: t("controlPanel.yes") }]} />
        </Row>
        <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.flippedHelp")}</div>
      </div>
    )}
    <PanelCornerCard api={api} guard={guard} corner={panelCorner} options={panelOptions} taken={rebootCorner}
      onChange={(c, o) => { setPanelCorner(c); setPanelOptions(o); }} />
    {caps?.reboot_corner && (
      <RebootCornerCard api={api} guard={guard} initial={settings} taken={panelCorner} onCorner={setRebootCorner} />
    )}
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

/** Which servers the clock follows: the system's, or one to four typed here. */
function NtpServersCard({ api, guard, initial, onSaved }: {
  api: ControlPanelSession; guard: Guard; initial: NtpServers; onSaved: () => void;
}) {
  const { t } = usePanelTranslation();
  const [manual, setManual] = useState(initial.manual);
  const [text, setText] = useState(initial.servers.join(" "));
  const servers = splitNtpServers(text);
  const bad = servers.length > MAX_NTP_SERVERS || servers.some((s) => !isNtpServer(s)) || (manual && servers.length === 0);
  const save = (m: boolean, list: string[]) =>
    void guard(api.setTime({ ntp_servers: { manual: m, servers: list } })).then(onSaved);
  return (
    <div style={card} data-testid="ntp-servers">
      <Row label={t("controlPanel.ntpServers")}>
        <Segmented value={manual ? "manual" : "auto"}
          onChange={(v) => {
            setManual(v === "manual");
            // Automatic applies at once; manual waits for its servers.
            if (v === "auto") save(false, servers.filter(isNtpServer).slice(0, MAX_NTP_SERVERS));
          }}
          options={[{ value: "auto", label: t("controlPanel.ntpServersAuto") }, { value: "manual", label: t("controlPanel.ntpServersManual") }]} />
      </Row>
      {manual && (
        <Row label="">
          <input type="text" value={text} data-testid="ntp-servers-input" spellCheck={false} autoCapitalize="off"
            placeholder="192.168.1.10 ntp.example.com" onChange={(e) => setText(e.target.value)}
            style={{ ...field, width: 360, borderColor: bad && text.trim() ? C.bad : C.line }} />
          <button type="button" style={btnPrimary} disabled={bad} data-testid="ntp-servers-apply"
            onClick={() => save(true, servers)}>{t("controlPanel.apply")}</button>
        </Row>
      )}
      <div style={{ color: C.muted, fontSize: 13 }}>
        {t(manual ? "controlPanel.ntpServersManualHelp" : "controlPanel.ntpServersAutoHelp")}
      </div>
    </div>
  );
}

function TimeSection({ api, guard }: { api: ControlPanelSession; guard: Guard }) {
  const { t, lang } = usePanelTranslation();
  const [time, setTime] = useState<TimeState | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [picking, setPicking] = useState(false);
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
          onChange={(v) => {
            // Shown at once: the system takes seconds to switch. The reload has the truth.
            setTime({ ...time, ntp: v === "ntp", ntp_synchronized: false, drift: null });
            void guard(api.setTime({ ntp: v === "ntp" })).then(reload);
          }}
          options={[{ value: "ntp", label: t("controlPanel.ntp") }, { value: "manual", label: t("controlPanel.manual") }]} />
        {time.ntp && (time.ntp_synchronized ? <Tag>{t("controlPanel.synced")}</Tag> : <Tag tone="warn">{t("controlPanel.notSynced")}</Tag>)}
      </Row>
      {time.ntp && time.drift && (
        <Row label={t("controlPanel.clockDrift")}>
          <span data-testid="clock-drift" style={{ fontSize: 15 }}>
            {t(time.drift.ppm >= 0 ? "controlPanel.clockDriftFast" : "controlPanel.clockDriftSlow", {
              ppm: Math.abs(time.drift.ppm).toFixed(1),
              perDay: (Math.abs(time.drift.ppm) * 0.0864).toFixed(1),
              offset: (Math.abs(time.drift.offset_secs) * 1000).toFixed(1),
            })}
          </span>
        </Row>
      )}
      <Row label={t("controlPanel.timezone")}>
        <span data-testid="timezone-current" style={{ fontSize: 16 }}>
          {zoneLabel(zones.find((z) => z.zone === time.timezone) ?? { zone: time.timezone, country: null }, lang)}
        </span>
        <span style={{ color: C.muted, fontSize: 13 }}>{time.timezone}</span>
        {zones.length > 0 && !picking && (
          <button type="button" style={btn} data-testid="timezone-change" onClick={() => setPicking(true)}>{t("controlPanel.tzChange")}</button>
        )}
      </Row>
    </div>
    {picking && (
      <TimezonePicker zones={zones} onCancel={() => setPicking(false)}
        onPick={(zone) => { setPicking(false); void guard(api.setTime({ timezone: zone })).then(reload); }} />
    )}
    {time.ntp_servers && (
      <NtpServersCard key={JSON.stringify(time.ntp_servers)} api={api} guard={guard} initial={time.ntp_servers}
        onSaved={() => void reload()} />
    )}
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

/** Continent, then country, then city; or a filter over all three. A country
 *  with one zone is chosen at once. Lists scroll inside the panel. */
function TimezonePicker({ zones, onPick, onCancel }: {
  zones: Zone[]; onPick: (zone: string) => void; onCancel: () => void;
}) {
  const { t, lang } = usePanelTranslation();
  const [filter, setFilter] = useState("");
  const [typing, setTyping] = useState(false);
  const [continent, setContinent] = useState<string | null>(null);
  const [country, setCountry] = useState<CountryEntry | null>(null);
  const item: CSSProperties = { ...btn, textAlign: "left", width: "100%", fontSize: 16, padding: "10px 14px" };
  const list: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto", marginTop: 10 };
  const crumb = (label: string, onClick: (() => void) | null) => (
    <button type="button" style={{ ...btn, padding: "4px 10px", fontSize: 14 }}
      disabled={!onClick} onClick={onClick ?? undefined}>{label}</button>
  );
  const pickCountry = (c: CountryEntry) => (c.zones.length === 1 ? onPick(c.zones[0]) : setCountry(c));
  const continentName = (c: string) => t(`controlPanel.continent_${c}`);
  let body: ReactNode;
  if (filter.trim()) {
    const found = search(zones, filter, lang);
    body = found.length === 0
      ? <div style={{ color: C.muted, marginTop: 10 }}>{t("controlPanel.tzNoMatch")}</div>
      : <div style={list} data-testid="timezone-results">{found.map((z) => (
          <button key={z.zone} type="button" style={item} onClick={() => onPick(z.zone)}>
            {zoneLabel(z, lang)} <span style={{ color: C.muted, fontSize: 13 }}>{z.zone}</span>
          </button>))}</div>;
  } else if (!continent) {
    body = <div style={{ ...list, display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }} data-testid="timezone-continents">
      {continentsIn(zones).map((c) => <button key={c} type="button" style={item} onClick={() => setContinent(c)}>{continentName(c)}</button>)}
    </div>;
  } else if (!country) {
    body = <div style={list} data-testid="timezone-countries">
      {countriesIn(zones, continent, lang).map((c) => (
        <button key={c.code ?? c.zones[0]} type="button" style={item} onClick={() => pickCountry(c)}>
          {c.name}{c.zones.length > 1 && <span style={{ color: C.muted, fontSize: 13 }}> · {c.zones.length}</span>}
        </button>))}
    </div>;
  } else {
    body = <div style={list} data-testid="timezone-cities">
      {[...country.zones].sort((a, b) => cityOf(a).localeCompare(cityOf(b), lang)).map((z) => (
        <button key={z} type="button" style={item} onClick={() => onPick(z)}>
          {cityOf(z)} <span style={{ color: C.muted, fontSize: 13 }}>{z}</span>
        </button>))}
    </div>;
  }
  return (
    <div style={card} data-testid="timezone-picker">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <TextField value={filter} onChange={setFilter} active={typing} onFocus={() => setTyping(true)} width={240}
          testId="timezone-filter" />
        {!filter.trim() && crumb(t("controlPanel.tzContinents"), continent ? () => { setContinent(null); setCountry(null); } : null)}
        {!filter.trim() && continent && crumb(continentName(continent), country ? () => setCountry(null) : null)}
        {!filter.trim() && country && crumb(country.name, null)}
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={onCancel}>{t("controlPanel.cancel")}</button>
      </div>
      {!filter && <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>{t("controlPanel.tzFilterHelp")}</div>}
      {body}
      {typing && <TextKeyboard onKey={(k) => (k === "⏎" ? setTyping(false) : setFilter((v) => typeInto(v, k, 30)))} />}
    </div>
  );
}

// ── Device ───────────────────────────────────────────────────────────────────

// ── About ────────────────────────────────────────────────────────────────────

/** «1.2 MB»: one decimal from the kilobyte up. */
export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes, unit = 0;
  while (v >= 1024 && unit < units.length - 1) { v /= 1024; unit += 1; }
  return unit === 0 ? `${bytes} B` : `${v.toFixed(1)} ${units[unit]}`;
}

/** «3 d 4 h», «4 h 12 min», «12 min». */
export function formatDuration(secs: number, days: string): string {
  const d = Math.floor(secs / 86_400), h = Math.floor((secs % 86_400) / 3_600), m = Math.floor((secs % 3_600) / 60);
  if (d > 0) return `${d} ${days} ${h} h`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** What runs here, read only: SWS, the project, the system, the state. */
/** OpenPLC on this device: whether it answers, its version, the ports, and the
 *  Editor's user and password, created by the installation (CRA D20,
 *  18-11-2026). Behind the service PIN, like the rest of the panel. */
function OpenPlcSection({ api, guard }: { api: ControlPanelSession; guard: Guard }) {
  const { t } = usePanelTranslation();
  const [plc, setPlc] = useState<OpenPlc | null>(null);
  useEffect(() => { void guard(api.openplc()).then((p) => p && setPlc(p)); }, [api, guard]);
  if (!plc) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const port = (k: string) => plc.ports[k] ?? "—";
  return (<>
    <div style={card} data-testid="openplc-state">
      <Row label={t("controlPanel.openplcState")}>
        {plc.answers ? <Tag tone="ok">{t("controlPanel.openplcAnswers")}</Tag> : <Tag tone="warn">{t("controlPanel.openplcSilent")}</Tag>}
      </Row>
      <Row label={t("controlPanel.openplcVersion")}>{plc.version ?? "—"}</Row>
      <Row label={t("controlPanel.openplcPorts")}>
        {t("controlPanel.openplcPortsValue", { editor: port("editor"), modbus: port("modbus"), s7: port("s7"), opcua: port("opcua") })}
      </Row>
    </div>
    <div style={card} data-testid="openplc-credentials">
      <div style={{ color: C.muted, fontSize: 15, marginBottom: 6 }}>{t("controlPanel.openplcEditor")}</div>
      {plc.credentials ? (<>
        <Row label={t("controlPanel.openplcUser")}><span style={{ fontFamily: "'DejaVu Sans Mono', monospace" }}>{plc.credentials.username}</span></Row>
        <Row label={t("controlPanel.openplcPassword")}>
          <span data-testid="openplc-password" style={{ fontFamily: "'DejaVu Sans Mono', monospace", fontSize: 18, letterSpacing: 1 }}>{plc.credentials.password}</span>
        </Row>
        <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.openplcHelp", { port: port("editor") })}</div>
      </>) : (
        <div style={{ color: C.warn, fontSize: 14 }} data-testid="openplc-note">
          {t(plc.credentials_foreign ? "controlPanel.openplcForeign"
            : plc.credentials_unknown ? "controlPanel.openplcUnknown" : "controlPanel.openplcNone")}
        </div>
      )}
    </div>
  </>);
}

function AboutSection({ api, guard }: { api: ControlPanelSession; guard: Guard }) {
  const { t, lang } = usePanelTranslation();
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => { void guard(api.about()).then((a) => a && setAbout(a)); }, [api, guard]);
  const [exported, setExported] = useState<string | null>(null);
  if (!about) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const { sws, project: p, system: sys, state: st } = about;
  const download = async () => {
    const zip = await guard(api.diagnostics());
    if (!zip) return;
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sws-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const toUsb = async () => {
    setExported(null);
    const r = await guard(api.diagnosticsToUsb());
    if (r) setExported(r.file);
  };
  const date = (ms?: number | null) => ms == null ? null
    : new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(ms);
  const time = (s?: number | null) => s == null ? null : formatDuration(s, t("controlPanel.aboutDays"));
  const of = (used: number | undefined, total: number | undefined, unit: string) =>
    used == null || total == null ? null : t("controlPanel.aboutOf", { used, total, unit });
  const title: CSSProperties = { color: C.muted, fontSize: 15 };
  const rows = (list: [string, ReactNode | null][]) => list
    .filter(([, v]) => v != null)
    .map(([k, v]) => <Row key={k} label={t(`controlPanel.${k}`)}>{v}</Row>);
  return (<div data-testid="about-section">
    <div style={card}>
      <div style={title}>SWS</div>
      {rows([
        ["aboutVersion", sws.git ? `${sws.version} (${sws.git})` : sws.version ?? "—"],
        ["aboutBuilt", date(sws.build_ms)],
        ["aboutEngine", "web"],
        ["aboutRunning", time(sws.uptime_s)],
      ])}
    </div>
    <div style={card}>
      <div style={title}>{t("controlPanel.aboutProject")}</div>
      {p ? rows([
        ["aboutName", p.version ? `${p.name ?? "—"} · ${p.version}` : p.name ?? "—"],
        ["aboutLoaded", date(p.loaded_ms)],
        ["aboutSize", formatSize(p.size_bytes)],
        ["aboutHistory", formatSize(p.history_bytes)],
        ["aboutContents", t("controlPanel.aboutContentsValue", { pages: p.pages, tags: p.tags, sources: p.sources })],
      ]) : rows([["aboutName", t("controlPanel.aboutNoProject")]])}
    </div>
    <div style={card}>
      <div style={title}>{t("controlPanel.aboutSystem")}</div>
      {rows([
        ["aboutOs", sys.os ?? null],
        ["aboutKernel", sys.kernel ?? null],
        ["aboutImage", sys.image ?? null],
        ["aboutDisk", of(sys.disk_used_gb, sys.disk_total_gb, "GB")],
        ["aboutMemory", of(sys.mem_used_mb, sys.mem_total_mb, "MB")],
        ["aboutTemp", sys.cpu_temp_c == null ? null : `${Math.round(sys.cpu_temp_c)} °C`],
        ["aboutUptime", time(sys.uptime_s)],
      ])}
    </div>
    <div style={card}>
      <div style={title}>{t("controlPanel.aboutState")}</div>
      {rows([
        ["aboutSources", st.armed === false ? t("controlPanel.aboutStopped")
          : t("controlPanel.aboutSourcesValue", { running: st.sources_running ?? 0, total: st.sources ?? 0 })],
        ["aboutAlarms", st.alarms_active ?? 0],
        ["aboutCloud", st.cloud ?? t("controlPanel.aboutCloudNone")],
        ["aboutUpdate", st.update_available ?? t("controlPanel.aboutUpdateNone")],
        ["aboutCertificate", st.certificate_expires_ms == null ? null
          : t("controlPanel.aboutExpires", { date: date(st.certificate_expires_ms) })],
      ])}
    </div>
    <div style={card} data-testid="diagnostics">
      <Row label={t("controlPanel.diagnostics")}>
        <button type="button" style={btn} data-testid="diagnostics-download" onClick={() => void download()}>
          {t("controlPanel.diagnosticsDownload")}
        </button>
        {about.diagnostics_usb && (
          <button type="button" style={{ ...btn, marginLeft: 8 }} data-testid="diagnostics-usb" onClick={() => void toUsb()}>
            {t("controlPanel.diagnosticsUsb")}
          </button>
        )}
      </Row>
      {exported && <div style={{ color: C.ok, fontSize: 13 }}>{t("controlPanel.diagnosticsWritten", { file: exported })}</div>}
      <div style={{ color: C.muted, fontSize: 13 }}>{t("controlPanel.diagnosticsHelp")}</div>
    </div>
  </div>);
}

function DeviceSection({ api, guard, info, caps }: {
  api: ControlPanelSession; guard: Guard; info: DeviceInfo | null; caps: Capabilities | null;
}) {
  const { t } = usePanelTranslation();
  const [ask, setAsk] = useState<"reboot" | "power_off" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Giving the device back: the PIN again, then it goes.
  const [reset, setReset] = useState<{ pin: string; wrong: boolean; keepCloud: boolean } | null>(null);
  const [resetDone, setResetDone] = useState<"all" | "keep-cloud" | null>(null);
  if (!info) return <div style={{ color: C.muted }}>{t("controlPanel.loading")}</div>;
  const doReset = async () => {
    if (!reset || !reset.pin) return;
    try {
      if (await api.reset(reset.pin, reset.keepCloud)) { setReset(null); setResetDone(reset.keepCloud ? "keep-cloud" : "all"); }
      else setReset({ ...reset, pin: "", wrong: true });
    } catch (e) {
      void guard(Promise.reject(e));
    }
  };
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
    <div style={{ ...card, borderColor: "#7b3633", display: "flex", flexDirection: "column", gap: 8 }} data-testid="reset-card">
      {resetDone ? <div style={{ color: C.ok }}>{t(resetDone === "keep-cloud" ? "controlPanel.resetKeepCloudDone" : "controlPanel.resetDone")}</div> : (<>
        <div style={{ color: C.bad, fontSize: 17, fontWeight: 600 }}>{t("controlPanel.resetSection")}</div>
        {reset === null ? (<>
          {/* From the cloud's remote screen only the reset that keeps the
              pairing: the full one leaves a code that can be read only on site. */}
          {info.origin === "remote_screen" ? (
            <div style={{ color: C.warn, fontSize: 13 }} data-testid="reset-remote-note">{t("controlPanel.resetRemoteOnlyKeepCloud")}</div>
          ) : (
            <ResetBlock title={t("controlPanel.reset")} help={t("controlPanel.resetHelp")}>
              <button type="button" style={{ ...btnPrimary, background: C.bad, borderColor: C.bad }}
                data-testid="reset-ask" onClick={() => setReset({ pin: "", wrong: false, keepCloud: false })}>{t("controlPanel.resetButton")}</button>
            </ResetBlock>
          )}
          {info.cloud && (<>
            <div style={{ borderTop: `1px solid ${C.line}`, margin: "4px 0" }} />
            <ResetBlock title={t("controlPanel.resetKeepCloud")} help={t("controlPanel.resetKeepCloudHelp", { cloud: info.cloud })}>
              <button type="button" style={{ ...btn, borderColor: C.bad, color: "#f1b0ad" }}
                data-testid="reset-keep-cloud-ask" onClick={() => setReset({ pin: "", wrong: false, keepCloud: true })}>{t("controlPanel.resetButton")}</button>
            </ResetBlock>
          </>)}
        </>) : (<>
          <div style={{ color: C.text, fontSize: 15 }}>{t(reset.keepCloud ? "controlPanel.resetKeepCloud" : "controlPanel.reset")}</div>
          <div style={{ color: C.muted, fontSize: 13 }}>{t(reset.keepCloud ? "controlPanel.resetKeepCloudPinHelp" : "controlPanel.resetPinHelp")}</div>
          <div style={{ ...row, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <CampoPassword value={reset.pin} autoComplete="off" autoFocus data-testid="reset-pin" style={{ ...field, width: 140 }}
              onChange={(e) => setReset({ ...reset, pin: e.target.value, wrong: false })} />
            <button type="button" style={btn} onClick={() => setReset(null)}>{t("controlPanel.cancel")}</button>
            <button type="button" style={{ ...btnPrimary, background: C.bad, borderColor: C.bad }} disabled={!reset.pin}
              data-testid="reset-confirm" onClick={() => void doReset()}>{t("controlPanel.resetConfirm")}</button>
          </div>
          {reset.wrong && <div style={{ color: "#f1b0ad", fontSize: 13 }}>{t("controlPanel.resetPinWrong")}</div>}
        </>)}
      </>)}
    </div>
  </>);
}

// The editor of the device firewall, shared by the IDE (Device → Firewall) and
// the control panel on the panel's screen. The two places give their own
// colours and buttons (`FirewallSkin`); the control panel also gives its
// on-screen keyboard, because the devices have no keyboard.
//
// Every entry already in the firewall shows as a switch, also the ones of the
// system. Changes collect in a draft; «Apply» sends them in one change, and the
// 60-second bar asks to confirm it: without the confirmation the device goes
// back by itself.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  addItem, composeRule, draftIsSensitive, editItem, errorMessage, isSensitive, itemKey, opsToSend,
  PROTOCOLS, rowsOf, toggle, validPort, validRuleForm, validServiceName, validSource, zoneForOpen,
  type Entry, type FirewallApi, type FirewallView, type Item, type Op, type Row, type RuleForm,
  type Verdict, type ZoneView,
} from "./core";

export interface FirewallSkin {
  text: string; muted: string; line: string; accent: string; ok: string; warn: string; bad: string;
  panel: string; bg: string;
  /** The bar of the 60 seconds: background and text. */
  barBg: string; barText: string;
  btn: CSSProperties; btnPrimary: CSSProperties; btnDanger: CSSProperties;
  card: CSSProperties; input: CSSProperties;
  /** The control panel: the keyboard for the text field that has the focus. */
  keyboard?: (onKey: (k: string) => void) => ReactNode;
  /** The control panel: the bar of the 60 seconds sits at the bottom of the screen. */
  fixedBar?: boolean;
}

type T = (k: string, o?: Record<string, unknown>) => string;

/** The text fields of the editor: one focus, so one keyboard serves all of them. */
type FieldName = "port" | "source" | "rulePort" | "editPort";

type Adding =
  | null
  | { what: "service"; zone: string; name: string }
  | { what: "port"; zone: string; protocol: string }
  | { what: "rule"; zone: string; target: "port" | "service"; protocol: string; service: string; verdict: Verdict }
  | { what: "edit"; zone: string; row: Row; protocol: string; target: "port" | "service"; service: string; verdict: Verdict };

export function FirewallEditor({ api, t, skin, onExpired }: {
  api: FirewallApi; t: T; skin: FirewallSkin;
  /** The control panel: an expired session goes back to the PIN. */
  onExpired?: (e: unknown) => boolean;
}) {
  const [view, setView] = useState<FirewallView | null>(null);
  const [draft, setDraft] = useState<Op[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [adding, setAdding] = useState<Adding>(null);
  const [fields, setFields] = useState<Record<FieldName, string>>({ port: "", source: "", rulePort: "", editPort: "" });
  const [focus, setFocus] = useState<FieldName | null>(null);

  const fail = useCallback((e: unknown) => {
    if (onExpired?.(e)) return;
    setError(errorMessage(e));
  }, [onExpired]);

  const reload = useCallback(async () => {
    try {
      const v = await api.get();
      setView(v);
      setUntil(v.pending ? Date.now() + v.pending.seconds_left * 1000 : null);
    } catch (e) { fail(e); }
  }, [api, fail]);
  useEffect(() => { void reload(); }, [reload]);

  // The countdown; at the end the device has gone back, so read it again.
  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() > until + 2_000) { setUntil(null); void reload(); }
    }, 1_000);
    return () => window.clearInterval(id);
  }, [until, reload]);

  const setField = (f: FieldName, v: string) => setFields((x) => ({ ...x, [f]: v }));
  const key = (k: string) => {
    if (!focus) return;
    if (k === "⏎") { setFocus(null); return; }
    const v = fields[focus];
    setField(focus, k === "⌫" ? v.slice(0, -1) : v.length < 64 ? v + k : v);
  };

  const zones = view?.zones ?? [];
  const rowsByZone = useMemo(() => zones.map((z) => ({ z, rows: rowsOf(z, draft) })), [zones, draft]);

  const send = async () => {
    if (!view || draft.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.apply(opsToSend(draft));
      setDraft([]);
      setReview(false);
      setUntil(Date.now() + r.confirm_within_secs * 1000);
      setNow(Date.now());
      await reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const confirmNow = async () => {
    setBusy(true);
    try { await api.confirmChange(); setUntil(null); await reload(); } catch (e) { fail(e); await reload(); } finally { setBusy(false); }
  };
  const rollbackNow = async () => {
    setBusy(true);
    try { await api.rollbackChange(); setUntil(null); await reload(); } catch (e) { fail(e); await reload(); } finally { setBusy(false); }
  };

  const s = skin;
  const small: CSSProperties = { color: s.muted, fontSize: 12 };
  const chip = (txt: string, color: string): ReactNode => (
    <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 9, border: `1px solid ${color}`, color, marginLeft: 6, whiteSpace: "nowrap" }}>{txt}</span>
  );
  const input = (f: FieldName, placeholder: string, width: number, bad: boolean, testId: string) => (
    <input value={fields[f]} placeholder={placeholder} data-testid={testId} autoComplete="off"
      onFocus={() => setFocus(f)} onChange={(e) => setField(f, e.target.value)}
      style={{ ...s.input, width, borderColor: bad ? s.bad : focus === f ? s.accent : (s.input.borderColor as string | undefined) }} />
  );
  const select = (value: string, options: { value: string; label: string }[], onChange: (v: string) => void, testId: string) => (
    <select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)} style={{ ...s.input, width: "auto" }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  if (!view) {
    return <div style={{ color: s.muted }}>{error ?? t("firewall.loading")}</div>;
  }
  if (!view.available) {
    return <div style={{ ...s.card, color: s.muted }} data-testid="firewall-unavailable">{t("firewall.unavailable")}</div>;
  }

  const pending = until !== null;
  const secs = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  const sensitive = draftIsSensitive(view, draft);

  const label = (e: Entry | Item): string => {
    if (e.kind === "service") return e.name;
    if (e.kind === "port") return `${e.port}/${e.protocol}`;
    return e.rule;
  };
  const detail = (e: Entry): string => {
    if (e.kind === "service") return (e.ports ?? []).join(", ");
    if (e.kind === "rich_rule" && e.form) {
      const target = e.form.target.kind === "port" ? `${e.form.target.port}/${e.form.target.protocol}` : e.form.target.name;
      return t("firewall.ruleSummary", { source: e.form.source, target, verdict: t(`firewall.verdict.${e.form.verdict}`) });
    }
    return "";
  };
  const opText = (o: Op): string => t(o.action === "add" ? "firewall.opAdd" : "firewall.opRemove", {
    what: o.item.kind === "rich_rule" ? t("firewall.rule") : label(o.item), zone: o.zone,
  });

  // ── The forms ──────────────────────────────────────────────────────────────

  const openAdd = (a: Adding) => {
    setAdding(a);
    setFields({ port: "", source: "", rulePort: "", editPort: "" });
    setFocus(a && a.what !== "service" ? (a.what === "port" ? "port" : a.what === "rule" ? "source" : null) : null);
  };
  const openEdit = (z: ZoneView, r: Row) => {
    const e = r.entry;
    if (e.kind === "port") {
      setAdding({ what: "edit", zone: z.name, row: r, protocol: e.protocol, target: "port", service: "", verdict: "accept" });
      setFields({ port: "", source: "", rulePort: "", editPort: e.port });
      setFocus("editPort");
    } else if (e.kind === "rich_rule" && e.form) {
      const f = e.form;
      setAdding({
        what: "edit", zone: z.name, row: r, target: f.target.kind,
        protocol: f.target.kind === "port" ? f.target.protocol : "tcp",
        service: f.target.kind === "service" ? f.target.name : view.known_services[0] ?? "",
        verdict: f.verdict,
      });
      setFields({ port: "", source: f.source, rulePort: f.target.kind === "port" ? f.target.port : "", editPort: "" });
      setFocus("source");
    }
  };

  const ruleOf = (a: { target: "port" | "service"; protocol: string; service: string; verdict: Verdict }): RuleForm => ({
    source: fields.source.trim(),
    target: a.target === "port"
      ? { kind: "port", port: fields.rulePort.trim(), protocol: a.protocol }
      : { kind: "service", name: a.service },
    verdict: a.verdict,
  });

  const zoneOf = (name: string) => zones.find((z) => z.name === name)!;

  const addReady = (): Item | null => {
    if (!adding) return null;
    if (adding.what === "service") return validServiceName(adding.name) ? { kind: "service", name: adding.name } : null;
    if (adding.what === "port") return validPort(fields.port.trim()) ? { kind: "port", port: fields.port.trim(), protocol: adding.protocol } : null;
    if (adding.what === "rule") { const f = ruleOf(adding); return validRuleForm(f) ? { kind: "rich_rule", rule: composeRule(f) } : null; }
    const e = adding.row.entry;
    if (e.kind === "port") return validPort(fields.editPort.trim()) ? { kind: "port", port: fields.editPort.trim(), protocol: adding.protocol } : null;
    const f = ruleOf(adding);
    return validRuleForm(f) ? { kind: "rich_rule", rule: composeRule(f) } : null;
  };
  const commitAdd = () => {
    const item = addReady();
    if (!adding || !item) return;
    const z = zoneOf(adding.zone);
    setDraft((d) => adding.what === "edit" ? editItem(d, z, adding.row, item) : addItem(d, z, item));
    setAdding(null);
    setFocus(null);
  };

  const ruleFields = (a: { target: "port" | "service"; protocol: string; service: string; verdict: Verdict }, set: (p: Partial<typeof a>) => void) => (<>
    <label style={small}>{t("firewall.source")}</label>
    {input("source", "192.168.0.0/23", 170, fields.source !== "" && !validSource(fields.source.trim()), "firewall-rule-source")}
    {select(a.target, [{ value: "port", label: t("firewall.port") }, { value: "service", label: t("firewall.service") }], (v) => set({ target: v as "port" | "service" }), "firewall-rule-target")}
    {a.target === "port"
      ? (<>{input("rulePort", "7444", 90, fields.rulePort !== "" && !validPort(fields.rulePort.trim()), "firewall-rule-port")}
        {select(a.protocol, PROTOCOLS.map((p) => ({ value: p, label: p })), (v) => set({ protocol: v }), "firewall-rule-protocol")}</>)
      : select(a.service, view.known_services.map((n) => ({ value: n, label: n })), (v) => set({ service: v }), "firewall-rule-service")}
    {select(a.verdict, (["accept", "reject", "drop"] as const).map((v) => ({ value: v, label: t(`firewall.verdict.${v}`) })), (v) => set({ verdict: v as Verdict }), "firewall-rule-verdict")}
  </>);

  const form = (z: ZoneView): ReactNode => {
    if (!adding || adding.zone !== z.name) return null;
    const ready = addReady() !== null;
    let body: ReactNode = null;
    if (adding.what === "service") {
      const used = new Set(rowsOf(z, draft).filter((r) => r.on && r.entry.kind === "service").map((r) => (r.entry as { name: string }).name));
      const free = view.known_services.filter((n) => !used.has(n));
      body = select(adding.name, [{ value: "", label: t("firewall.pickService") }, ...free.map((n) => ({ value: n, label: n }))],
        (v) => setAdding({ ...adding, name: v }), "firewall-add-service");
    } else if (adding.what === "port") {
      body = (<>
        {input("port", "4840", 110, fields.port !== "" && !validPort(fields.port.trim()), "firewall-add-port")}
        {select(adding.protocol, PROTOCOLS.map((p) => ({ value: p, label: p })), (v) => setAdding({ ...adding, protocol: v }), "firewall-add-protocol")}
      </>);
    } else if (adding.what === "rule") {
      body = ruleFields(adding, (p) => setAdding({ ...adding, ...p }));
    } else if (adding.row.entry.kind === "port") {
      body = (<>
        <span style={small}>{label(adding.row.entry)} →</span>
        {input("editPort", "4841", 110, !validPort(fields.editPort.trim()), "firewall-edit-port")}
        {select(adding.protocol, PROTOCOLS.map((p) => ({ value: p, label: p })), (v) => setAdding({ ...adding, protocol: v }), "firewall-edit-protocol")}
      </>);
    } else {
      body = ruleFields(adding, (p) => setAdding({ ...adding, ...p }));
    }
    return (
      <div data-testid="firewall-form" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 0", borderTop: `1px solid ${s.line}`, marginTop: 8 }}>
        {body}
        <span style={{ flex: 1 }} />
        <button type="button" style={s.btn} onClick={() => { setAdding(null); setFocus(null); }}>{t("firewall.cancel")}</button>
        <button type="button" style={{ ...s.btnPrimary, opacity: ready ? 1 : 0.5 }} disabled={!ready}
          data-testid="firewall-form-ok" onClick={commitAdd}>{t(adding.what === "edit" ? "firewall.editOk" : "firewall.addOk")}</button>
      </div>
    );
  };

  // ── The page ──────────────────────────────────────────────────────────────

  const bar = pending && (
    <div data-testid="firewall-confirm" style={{
      ...(s.fixedBar ? { position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 3 } : { position: "sticky", top: 0, zIndex: 3, marginBottom: 12 }),
      background: s.barBg, border: `2px solid ${s.warn}`, borderRadius: s.fixedBar ? 0 : 8,
      display: "flex", alignItems: "center", gap: 16, padding: "12px 18px", color: s.barText,
    }}>
      <div style={{ fontSize: 28, fontWeight: "bold", color: s.warn, width: 56, textAlign: "center" }}>{secs}</div>
      <div style={{ flex: 1 }}>
        <b style={{ display: "block", fontSize: 15 }}>{t("firewall.confirmQuestion")}</b>
        <span style={{ fontSize: 13 }}>{t("firewall.confirmHelp", { secs })}</span>
        {view.pending && <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {view.pending.ops.map((o, i) => <li key={i}>{opText(o)}</li>)}
        </ul>}
      </div>
      <button type="button" style={s.btn} disabled={busy} onClick={() => void rollbackNow()} data-testid="firewall-rollback">{t("firewall.rollback")}</button>
      <button type="button" style={s.btnPrimary} disabled={busy} onClick={() => void confirmNow()} data-testid="firewall-confirm-ok">{t("firewall.confirm")}</button>
    </div>
  );

  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <div style={{ ...small, flex: 1, minWidth: 240, fontSize: 13 }}>{t("firewall.help")}</div>
      {draft.length > 0 && !pending && (<>
        <span data-testid="firewall-draft-count" style={{ color: s.warn, fontSize: 13 }}>{t("firewall.draftCount", { count: draft.length })}</span>
        <button type="button" style={s.btn} onClick={() => { setDraft([]); setReview(false); }}>{t("firewall.discard")}</button>
        <button type="button" style={s.btnPrimary} data-testid="firewall-apply" onClick={() => setReview(true)}>{t("firewall.apply")}</button>
      </>)}
    </div>
  );

  const reviewBox = review && draft.length > 0 && !pending && (
    <div data-testid="firewall-review" style={{ ...s.card, borderColor: sensitive ? s.bad : s.accent }}>
      <b>{t("firewall.reviewTitle")}</b>
      <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 13 }}>
        {opsToSend(draft).map((o, i) => <li key={i}>{opText(o)}</li>)}
      </ul>
      {sensitive && <div data-testid="firewall-sensitive" style={{ color: s.bad, fontSize: 13, marginBottom: 6 }}>{t("firewall.sensitive")}</div>}
      <div style={{ ...small, marginBottom: 8 }}>{t("firewall.reviewHelp", { secs: view.confirm_within_secs })}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={s.btn} onClick={() => setReview(false)}>{t("firewall.back")}</button>
        <button type="button" style={sensitive ? s.btnDanger : s.btnPrimary} disabled={busy}
          data-testid="firewall-send" onClick={() => void send()}>{t("firewall.applyNow")}</button>
      </div>
    </div>
  );

  const listen = view.listen_ports.length > 0 && (
    <div style={s.card} data-testid="firewall-listen">
      <b>{t("firewall.listenTitle")}</b>
      <div style={{ ...small, marginBottom: 6 }}>{t("firewall.listenHelp")}</div>
      {view.listen_ports.map((l) => {
        const open = l.open_in.length > 0;
        const z = zoneForOpen(view);
        const item: Item = { kind: "port", port: String(l.port), protocol: l.protocol };
        const drafted = z ? rowsOf(z, draft).some((r) => r.on && r.added && r.entry.kind === "port" && r.entry.port === String(l.port) && r.entry.protocol === l.protocol) : false;
        return (
          <div key={`${l.port}/${l.protocol}`} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: open ? s.ok : s.bad, display: "inline-block" }} />
            <span style={{ fontFamily: "monospace" }}>{l.port}/{l.protocol}</span>
            {l.sws && chip("SWS", s.accent)}
            <span style={small}>{open ? t("firewall.openIn", { zones: l.open_in.join(", ") }) : t("firewall.closed")}</span>
            <span style={{ flex: 1 }} />
            {!open && z && !pending && (
              <button type="button" style={s.btn} disabled={drafted} data-testid={`firewall-open-${l.port}`}
                onClick={() => setDraft((d) => addItem(d, z, item))}>{drafted ? t("firewall.inDraft") : t("firewall.open")}</button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div data-testid="firewall-editor" style={{ color: s.text, paddingBottom: s.fixedBar && (pending || focus) ? 220 : 0 }}>
      {bar}
      {head}
      {error && <div role="alert" style={{ ...s.card, borderColor: s.bad, color: s.bad }}>{error}</div>}
      {reviewBox}
      {listen}
      {rowsByZone.map(({ z, rows }) => (
        <div key={z.name} style={s.card} data-testid={`firewall-zone-${z.name}`}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <b>{t("firewall.zone", { name: z.name })}</b>
            {z.default && chip(t("firewall.default"), s.muted)}
            <span style={small}>
              {[z.interfaces.length > 0 ? t("firewall.interfaces", { list: z.interfaces.join(", ") }) : "",
                z.sources.length > 0 ? t("firewall.sources", { list: z.sources.join(", ") }) : ""].filter(Boolean).join(" · ")}
            </span>
          </div>
          {rows.map((r) => {
            const e = r.entry;
            const k = itemKey(z.name, e);
            const editable = !pending && (e.kind === "port" || (e.kind === "rich_rule" && !!e.form)) && r.on;
            return (
              <div key={k} data-testid={`firewall-row-${e.kind}-${e.kind === "service" ? e.name : e.kind === "port" ? `${e.port}-${e.protocol}` : "rule"}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10, minHeight: 38, padding: "2px 6px",
                  borderLeft: `3px solid ${r.changed ? s.warn : "transparent"}`, opacity: r.on ? 1 : 0.6,
                }}>
                <button type="button" role="switch" aria-checked={r.on} disabled={pending}
                  aria-label={t(r.on ? "firewall.switchOff" : "firewall.switchOn", { what: label(e) })}
                  onClick={() => setDraft((d) => toggle(d, z, r))}
                  style={{
                    width: 40, height: 22, borderRadius: 11, border: "none", padding: 2, cursor: pending ? "default" : "pointer",
                    background: r.on ? s.ok : s.line, display: "flex", justifyContent: r.on ? "flex-end" : "flex-start", flexShrink: 0,
                  }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", display: "block" }} />{/* fixed-colour: the knob of the switch */}
                </button>
                <span style={{ fontFamily: e.kind === "service" ? "inherit" : "monospace", fontSize: e.kind === "rich_rule" ? 12 : 14, wordBreak: "break-all" }}>
                  {e.kind === "rich_rule" && e.form ? t("firewall.rule") : label(e)}
                </span>
                <span style={{ ...small, flex: 1 }}>{detail(e)}</span>
                {isSensitive(e) && chip(t("firewall.connection"), s.warn)}
                {r.added && chip(t("firewall.new"), s.warn)}
                {!r.added && !r.on && !r.changed && e.disabled_by && chip(t("firewall.disabledBy", { who: e.disabled_by }), s.muted)}
                {editable && <button type="button" style={s.btn} onClick={() => openEdit(z, r)}>{t("firewall.edit")}</button>}
              </div>
            );
          })}
          {!pending && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" style={s.btn} data-testid={`firewall-add-service-${z.name}`}
                onClick={() => openAdd({ what: "service", zone: z.name, name: "" })}>+ {t("firewall.service")}</button>
              <button type="button" style={s.btn} data-testid={`firewall-add-port-${z.name}`}
                onClick={() => openAdd({ what: "port", zone: z.name, protocol: "tcp" })}>+ {t("firewall.port")}</button>
              <button type="button" style={s.btn} data-testid={`firewall-add-rule-${z.name}`}
                onClick={() => openAdd({ what: "rule", zone: z.name, target: "port", protocol: "tcp", service: view.known_services[0] ?? "", verdict: "accept" })}>+ {t("firewall.rule")}</button>
            </div>
          )}
          {form(z)}
        </div>
      ))}
      {s.keyboard && focus && !pending && s.keyboard(key)}
    </div>
  );
}

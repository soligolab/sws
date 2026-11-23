import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import {
  PLX800_GROUPS, PLX800_POINTS, missingPoints, plx800Point, tagDefFor, writableWithoutWrites, type Plx800Status,
} from "@/config/sourcePlx800";
import { TagInput } from "@/components/TagInput";
import { CampoNumero } from "@/components/CampoNumero";
import { useAppStore } from "@/store";
import type { Plx800IoSource, Plx800Point, Plx800PointMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";

// ── PLX800 I/O module ─────────────────────────────────────────────────────────
// Points, types and units live in `sourcePlx800.ts`. The card asks the
// **connected device** whether it has the module: the PC of whoever designs
// has none, and an empty answer from it would say nothing about the panel.

type StatusOrigin = "remote" | "remote-old" | "local" | "none";

export function Plx800IoSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: Plx800IoSource;
  onChange: (s: Plx800IoSource) => void;
  onDelete: () => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const [status, setStatus] = useState<Plx800Status | null>(null);
  const [origin, setOrigin] = useState<StatusOrigin>("none");
  useEffect(() => {
    let alive = true;
    (async () => {
      let remoteFailed = false;
      if (remoteConnected) {
        try {
          const st = await api.remotePlx800Status();
          if (alive) { setStatus(st); setOrigin("remote"); }
          return;
        } catch { remoteFailed = true; }
      }
      try {
        const st = await api.plx800Status();
        if (alive) { setStatus(st); setOrigin(remoteFailed ? "remote-old" : "local"); }
      } catch {
        if (alive) { setStatus(null); setOrigin("none"); }
      }
    })();
    return () => { alive = false; };
  }, [remoteConnected, remoteUrl]);

  const upd = (patch: Partial<Plx800IoSource>) => onChange({ ...source, ...patch });
  const updP = (idx: number, patch: Partial<Plx800PointMapping>) =>
    upd({ points: source.points.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  const label = (p: Plx800Point) => t(`plx800.point.${p}`);

  const addAll = () => {
    const missing = missingPoints(source);
    for (const m of missing) onCreateTag(tagDefFor(m.tag, m.point, label(m.point)));
    upd({ points: [...source.points, ...missing] });
  };

  const unused = writableWithoutWrites(source);
  const campo: React.CSSProperties = { ...S.inputSm, width: "auto" };
  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;
  const where = remoteUrl ?? "";

  let statusText: string;
  let statusOk = false;
  if (origin === "remote-old") statusText = t("plx800.statusOldRuntime", { url: where });
  else if (origin === "none" || !status) statusText = t("plx800.statusUnknown");
  else if (!status.present) statusText = origin === "remote" ? t("plx800.statusMissingRemote", { url: where }) : t("plx800.statusMissingLocal");
  else if (!status.valid) statusText = t("plx800.statusInvalid", { error: status.error ?? "" });
  else if (!status.fresh) statusText = t("plx800.statusStale");
  else {
    statusOk = true;
    statusText = origin === "remote"
      ? t("plx800.statusOkRemote", { url: where, us: status.cycle_us })
      : t("plx800.statusOkLocal", { us: status.cycle_us });
  }

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="PLX800 I/O"
        colore="var(--brand-success, #22c55e)"
        id={source.id}
        enabled={source.enabled !== false}
        onEnabled={(on) => onChange({ ...source, enabled: on ? undefined : false })}
        riepilogo={t("plx800.summary", { n: source.points.length, mode: source.writes ? t("plx800.modeWrite") : t("plx800.modeRead") })}
        aperta={!collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
      />
      {!collapsed && (
      <div style={{ padding: "0 16px 14px" }}>
      <SezioneSorgente titolo={t("sorgenti.sezioni.impostazioni")}>
        <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8 }}>{t("plx800.intro")}</div>
        <div data-testid="plx800-status" style={{ fontSize: 12, marginBottom: 8, color: statusOk ? "var(--brand-success-soft, #4ade80)" : "var(--brand-warning-soft, #facc15)" }}>
          {statusText}
          {/* The module is there, but SWS commands nothing while another program
              holds the lock: a warning, not part of the green «all good». */}
          {statusOk && status?.writer_lock_busy && (
            <span data-testid="plx800-lock-busy" style={{ color: "var(--brand-warning-soft, #facc15)" }}> · {t("plx800.lockBusy")}</span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "110px 240px", gap: 12, marginBottom: 8 }}>
          <div>
            <label style={etichetta}>{t("plx800.poll")}</label>
            <CampoNumero value={source.poll_interval_ms} onTesto={(e) => upd({ poll_interval_ms: Number(e) })} style={S.input} />
          </div>
          <div>
            <label style={etichetta}>{t("cfgUi.sourceId")}</label>
            <input value={source.id} onChange={(e) => upd({ id: e.target.value })} style={S.input} spellCheck={false} />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" data-testid="plx800-writes" checked={!!source.writes}
            onChange={(e) => upd({ writes: e.target.checked ? true : undefined })} />
          {t("plx800.writes")}
        </label>
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", marginTop: 4 }}>{t("plx800.writesHelp")}</div>
        {unused > 0 && (
          <div data-testid="plx800-read-only-note" style={{ fontSize: 12, marginTop: 6, color: "var(--brand-warning-soft, #facc15)" }}>
            {t("plx800.writableButReadOnly", { count: unused })}
          </div>
        )}
      </SezioneSorgente>

      <DisponibilitaSezione src={source} />

      <SezioneSorgente titolo={`${t("plx800.points")} (${source.points.length})`}>
        {source.points.map((m, idx) => {
          const d = plx800Point(m.point);
          return (
            <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <TagInput value={m.tag} onChange={(v) => updP(idx, { tag: v })} tipoSuggerito={d?.type}
                placeholder={t("cfg.tagIdPh")} style={{ ...campo, width: 190 }} />
              <select value={m.point} onChange={(e) => updP(idx, { point: e.target.value as Plx800Point })} style={campo}>
                {PLX800_GROUPS.map((g) => (
                  <optgroup key={g} label={t(`plx800.group.${g}`)}>
                    {PLX800_POINTS.filter((x) => x.group === g).map((x) => (
                      <option key={x.point} value={x.point}>{label(x.point)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {d?.unit && <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>{d.unit}</span>}
              {d?.writable && <span style={{ fontSize: 11, color: source.writes ? "var(--brand-success-soft, #4ade80)" : "var(--brand-text-subtle, #94a3b8)" }}>{t("plx800.commandable")}</span>}
              <button style={S.btnXs} title={t("cfg.createTag")}
                onClick={() => { if (m.tag) onCreateTag(tagDefFor(m.tag, m.point, label(m.point))); }}>+var</button>
              <button style={S.btnXs} onClick={() => upd({ points: source.points.filter((_, i) => i !== idx) })}>✕</button>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={S.btn("ghost")} onClick={() => upd({ points: [...source.points, { tag: "", point: "in0" }] })}>{t("plx800.addPoint")}</button>
          <button style={S.btn("ghost")} data-testid="plx800-add-all" disabled={missingPoints(source).length === 0} onClick={addAll}>
            {t("plx800.addAll")}
          </button>
        </div>
      </SezioneSorgente>
      </div>
      )}
    </div>
  );
}

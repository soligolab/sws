// La scheda «Tipi»: i tipi struttura riusabili del progetto (Fase 2 del piano
// tag).
//
// Un tipo descrive una volta com'è fatto un motore, una valvola, un anello
// PID; poi una variabile lo **istanzia** (`type_ref`) e le sue foglie si
// raggiungono per percorso: `motore1.velocita`. Unità, scala, limiti, ruolo di
// scrittura e storico stanno sul **membro**, quindi due istanze dello stesso
// tipo li ereditano senza ripeterli — e cambiare il tipo cambia tutte le
// istanze insieme.
//
// Sta in un file suo e non dentro `ConfigView.tsx`, che è già a 11 600 righe
// (vedi il seme `docs/plans/2026-09-22-riorganizzare-i-file-dell-editor.md`).

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { OpzioniTipo } from "@/components/OpzioniTipo";
import { normalizzaTipo } from "@/tag/tipiScalari";
import { FormaNonValida, foglieDi } from "@/tag/forma";
import type { Membro, TagDataType, TypeDef } from "@/types";
import { S, SaveBar, SezionePendente } from "./ConfigView";

const IN: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  color: "var(--brand-text, #e2e8f0)", padding: "3px 6px", fontSize: 12,
};
const TD: React.CSSProperties = { padding: "3px 4px", verticalAlign: "top" };
const TH: React.CSSProperties = {
  padding: "4px", textAlign: "left", fontSize: 10, letterSpacing: 0.5,
  color: "var(--brand-text-subtle, #64748b)", textTransform: "uppercase",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

/** `[2, 3]` ↔ `"2,3"`: le dimensioni si scrivono come le si legge. */
function testoArray(a: number[] | undefined): string {
  return a?.join(",") ?? "";
}
function leggiArray(t: string): number[] | undefined {
  const v = t.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  if (v.length === 0 || v.some((n) => !Number.isInteger(n) || n <= 0)) return undefined;
  return v;
}

function membroVuoto(): Membro {
  return { name: "", data_type: "f64" };
}

/** `incorporata`: la scheda vive dentro «Variabili» come sottoscheda, quindi
 *  la barra del Salva e l'introduzione le mette il guscio, non lei. La bozza
 *  si registra lo stesso fra le sezioni pendenti — è quello che fa arrivare i
 *  tipi al Salva unico del progetto. */
export function TipiTab({ incorporata = false }: { incorporata?: boolean } = {}) {
  const { t } = useTranslation();
  const storeTypes = useAppStore((s) => s.project?.types);
  const storeTags = useAppStore((s) => s.project?.tags);
  const updateProjectTypes = useAppStore((s) => s.updateProjectTypes);
  const markSaveOk = useAppStore((s) => s.markSaveOk);

  const [types, setTypes] = useState<TypeDef[]>(() => storeTypes ?? []);
  const [scelto, setScelto] = useState<string | null>(() => storeTypes?.[0]?.id ?? null);
  // Intenzione dell'utente, non confronto strutturale (vedi TagsTab).
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avanzate, setAvanzate] = useState<Set<number>>(new Set());

  const corrente = types.find((x) => x.id === scelto) ?? null;

  const modifica = (fn: (t: TypeDef) => TypeDef) => {
    if (!corrente) return;
    setTouched(true);
    setTypes((prev) => prev.map((x) => (x.id === corrente.id ? fn(x) : x)));
  };
  const patchMembro = (i: number, p: Partial<Membro>) =>
    modifica((td) => ({ ...td, members: td.members.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  /** Le istanze di questo tipo: cambiarlo le cambia tutte, e chi guarda deve
   *  saperlo prima di toccare un membro. */
  const istanze = useMemo(
    () => (storeTags ?? []).filter((x) => x.type_ref === corrente?.id).map((x) => x.id),
    [storeTags, corrente],
  );

  /** L'anteprima delle foglie: è quello che si otterrà davvero, ed è anche il
   *  posto dove un tipo scritto male lo dice subito invece che al salvataggio. */
  const anteprima = useMemo(() => {
    if (!corrente) return { foglie: [] as string[], errore: null as string | null };
    try {
      const f = foglieDi({ id: "istanza", description: "", type_ref: corrente.id }, types);
      return { foglie: f.map((x) => `${x.percorso} · ${x.tipo}`), errore: null };
    } catch (e) {
      return { foglie: [], errore: e instanceof FormaNonValida ? e.message : String(e) };
    }
  }, [corrente, types]);

  const aggiungiTipo = () => {
    const base = t("tipiTab.nuovoId");
    let id = base;
    let n = 2;
    while (types.some((x) => x.id === id)) id = `${base}${n++}`;
    setTouched(true);
    setTypes((prev) => [...prev, { id, description: "", members: [membroVuoto()] }]);
    setScelto(id);
  };

  const eliminaTipo = (id: string) => {
    const usato = (storeTags ?? []).filter((x) => x.type_ref === id).map((x) => x.id);
    if (usato.length > 0) return; // il bottone è già disabilitato: qui è la rete
    setTouched(true);
    setTypes((prev) => prev.filter((x) => x.id !== id));
    setScelto((s) => (s === id ? null : s));
  };

  const handleSave = async () => {
    const puliti = types
      .filter((x) => x.id.trim() !== "")
      .map((x) => ({ ...x, members: x.members.filter((m) => m.name.trim() !== "") }));
    setSaving(true);
    try {
      await api.updateTypes(puliti);
      updateProjectTypes(puliti);
      setTypes(puliti);
      setTouched(false);
      setSaved(true);
      markSaveOk();
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={incorporata ? undefined : S.section}>
      {incorporata
        ? <SezionePendente section="types" dirty={touched} onSave={handleSave} />
        : <SaveBar onSave={handleSave} saving={saving} saved={saved} section="types" dirty={touched} />}
      <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, lineHeight: 1.5 }}>
        {t("tipiTab.intro")}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {/* Elenco dei tipi */}
        <div style={{ width: 190, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--brand-text-subtle, #64748b)" }}>
              {t("tipiTab.elenco")}
            </span>
            <button style={{ ...S.btn("ghost"), marginLeft: "auto" }} onClick={aggiungiTipo}>+</button>
          </div>
          {types.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.4 }}>
              {t("tipiTab.vuoto")}
            </div>
          )}
          {types.map((td) => {
            const usato = (storeTags ?? []).some((x) => x.type_ref === td.id);
            return (
              <div
                key={td.id}
                onClick={() => setScelto(td.id)}
                style={{
                  padding: "6px 8px", cursor: "pointer", borderRadius: 4, marginBottom: 2,
                  display: "flex", alignItems: "center", gap: 6,
                  background: scelto === td.id ? "var(--brand-surface, #1e293b)" : "transparent",
                  borderLeft: `2px solid ${scelto === td.id ? "var(--brand-primary, #3b82f6)" : "transparent"}`,
                }}
              >
                <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--brand-text, #e2e8f0)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {td.id}
                </span>
                <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>
                  {t("tipiTab.nMembri", { n: td.members.length })}
                </span>
                <button
                  style={{ ...S.btnXs, opacity: usato ? 0.35 : 1, cursor: usato ? "not-allowed" : "pointer" }}
                  disabled={usato}
                  title={usato ? t("tipiTab.usatoNonSiElimina") : t("common.delete")}
                  onClick={(e) => { e.stopPropagation(); eliminaTipo(td.id); }}
                >✕</button>
              </div>
            );
          })}
        </div>

        {/* Il tipo scelto */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!corrente ? (
            <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", padding: 20 }}>
              {t("tipiTab.scegli")}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, width: 180 }}>
                  <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{t("tipiTab.id")}</span>
                  <input style={{ ...IN, fontFamily: "monospace" }} value={corrente.id} spellCheck={false}
                    onChange={(e) => {
                      const nuovo = e.target.value;
                      setTouched(true);
                      setTypes((prev) => prev.map((x) => (x.id === corrente.id ? { ...x, id: nuovo } : x)));
                      setScelto(nuovo);
                    }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 160 }}>
                  <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{t("tipiTab.descrizione")}</span>
                  <input style={IN} value={corrente.description ?? ""}
                    onChange={(e) => modifica((td) => ({ ...td, description: e.target.value }))} />
                </label>
              </div>

              {istanze.length > 0 && (
                <div style={{ ...S.notice, marginBottom: 10 }}>
                  {t("tipiTab.istanze", { n: istanze.length, ids: istanze.slice(0, 6).join(", ") })}
                </div>
              )}

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, width: "26%" }}>{t("tipiTab.nome")}</th>
                    <th style={{ ...TH, width: "22%" }}>{t("tipiTab.tipo")}</th>
                    <th style={{ ...TH, width: "14%" }}>{t("tipiTab.array")}</th>
                    <th style={{ ...TH, width: "14%" }}>{t("tipiTab.unita")}</th>
                    <th style={{ ...TH, width: "12%", textAlign: "center" }}>{t("tipiTab.storico")}</th>
                    <th style={{ ...TH, width: "12%" }} />
                  </tr>
                </thead>
                <tbody>
                  {corrente.members.map((m, i) => (
                    <>
                      <tr key={`m${i}`}>
                        <td style={TD}>
                          <input style={{ ...IN, fontFamily: "monospace" }} value={m.name} spellCheck={false}
                            placeholder={t("tipiTab.nomePh")}
                            onChange={(e) => patchMembro(i, { name: e.target.value })} />
                        </td>
                        <td style={TD}>
                          <select style={{ ...IN, cursor: "pointer" }}
                            value={m.type_ref ? `@${m.type_ref}` : (normalizzaTipo(m.data_type) ?? "f64")}
                            onChange={(e) => {
                              const v = e.target.value;
                              patchMembro(i, v.startsWith("@")
                                ? { type_ref: v.slice(1), data_type: undefined }
                                : { data_type: v as TagDataType, type_ref: undefined });
                            }}>
                            <OpzioniTipo />
                            {types.filter((x) => x.id !== corrente.id).length > 0 && (
                              <optgroup label={t("tipiTab.altriTipi")}>
                                {types.filter((x) => x.id !== corrente.id).map((x) => (
                                  <option key={x.id} value={`@${x.id}`}>{x.id}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </td>
                        <td style={TD}>
                          <input style={{ ...IN, fontFamily: "monospace" }} value={testoArray(m.array)}
                            placeholder={t("tipiTab.arrayPh")} spellCheck={false}
                            onChange={(e) => patchMembro(i, { array: leggiArray(e.target.value) })} />
                        </td>
                        <td style={TD}>
                          <input style={IN} value={m.unit ?? ""} placeholder="°C"
                            onChange={(e) => patchMembro(i, { unit: e.target.value || undefined })} />
                        </td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          <input type="checkbox" checked={m.history !== false}
                            title={t("tipiTab.storicoHint")}
                            onChange={(e) => patchMembro(i, { history: e.target.checked ? undefined : false })} />
                        </td>
                        <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button style={S.btnXs} title={t("tipiTab.avanzate")}
                            onClick={() => setAvanzate((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>⚙</button>
                          <button style={S.btnXs} title={t("common.delete")}
                            onClick={() => modifica((td) => ({ ...td, members: td.members.filter((_, j) => j !== i) }))}>✕</button>
                        </td>
                      </tr>
                      {avanzate.has(i) && (
                        <tr key={`a${i}`}>
                          <td colSpan={6} style={{ ...TD, background: "var(--brand-bg, #0a111e)", paddingBottom: 10 }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11 }}>
                              {([
                                ["raw_min", "rawMin"], ["raw_max", "rawMax"],
                                ["eng_min", "engMin"], ["eng_max", "engMax"],
                                ["limit_lo_lo", "limitLoLo"], ["limit_lo", "limitLo"],
                                ["limit_hi", "limitHi"], ["limit_hi_hi", "limitHiHi"],
                                ["decimals", "decimali"],
                                ["history_deadband", "bandaMorta"],
                                ["history_min_interval_ms", "intervalloMin"],
                              ] as const).map(([campo, chiave]) => (
                                <label key={campo} style={{ display: "flex", flexDirection: "column", gap: 2, width: 96 }}>
                                  <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{t(`tipiTab.${chiave}`)}</span>
                                  <input type="number" style={IN}
                                    value={(m[campo] as number | undefined) ?? ""}
                                    onChange={(e) => patchMembro(i, { [campo]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<Membro>)} />
                                </label>
                              ))}
                              <label style={{ display: "flex", flexDirection: "column", gap: 2, width: 130 }}>
                                <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{t("tipiTab.ruoloScrittura")}</span>
                                <select style={{ ...IN, cursor: "pointer" }} value={m.write_min_role ?? ""}
                                  onChange={(e) => patchMembro(i, { write_min_role: e.target.value || undefined })}>
                                  <option value="">—</option>
                                  <option value="Viewer">Viewer</option>
                                  <option value="Operator">Operator</option>
                                  <option value="Supervisor">Supervisor</option>
                                  <option value="Admin">Admin</option>
                                </select>
                              </label>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              <button style={{ ...S.btn("ghost"), marginTop: 8 }}
                onClick={() => modifica((td) => ({ ...td, members: [...td.members, membroVuoto()] }))}>
                + {t("tipiTab.membro")}
              </button>

              {/* Anteprima delle foglie */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "var(--brand-text-subtle, #64748b)", marginBottom: 6 }}>
                  {t("tipiTab.anteprima")}
                </div>
                {anteprima.errore ? (
                  <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{anteprima.errore}</div>
                ) : (
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.6 }}>
                    {anteprima.foglie.length === 0
                      ? t("tipiTab.nessunaFoglia")
                      : anteprima.foglie.map((f) => <div key={f}>{f}</div>)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

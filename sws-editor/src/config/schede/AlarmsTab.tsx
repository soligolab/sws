import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { genId } from "@/id";
import { TagInput } from "@/components/TagInput";
import type { AlarmCondition, AlarmDef, AlarmEmailMode, AlarmLevel, AlarmSeverity, AlarmTelegramMode } from "@/types";
import { DestinatariEmail } from "@/config/DestinatariEmail";
import { useAppStore } from "@/store";
import { useSezioneSincronizzata } from "@/config/useSezioneSincronizzata";
import { CampoTestoTradotto } from "@/editor/CampoTestoTradotto";
import { TRANS_COMP, BarraConflittoSezione, S, SaveBar } from "@/config/comuni";
import { livelliDi, unisciAllarmi } from "./unisciAllarmi";

// ── ALARMS tab ────────────────────────────────────────────────────────────────

/** Un allarme nuovo nasce **nel formato a livelli**, non in quello vecchio.
 *
 *  Fino al 30-09-2026 questa funzione costruiva `condition`/`message`/
 *  `severity` al primo livello, cioè esattamente la forma che dal 26-09 è
 *  «vecchia»: ogni allarme appena creato faceva comparire «1 allarme è nel
 *  formato vecchio e blocca il salvataggio», e all'utente veniva detto che il
 *  suo allarme nuovo era da convertire. Il maintainer, provandolo su un
 *  progetto che di allarmi non ne aveva: «quando genero un nuovo allarme...
 *  vedo ⚠ 1 alarms are in the old format».
 *
 *  Il modello a livelli è arrivato con la scheda, questo costruttore no. */
function emptyAlarm(): AlarmDef {
  return {
    id: `alm-${genId()}`,
    tag: "",
    levels: [{ condition: { kind: "above", threshold: 0 }, severity: "Warning", message: "" }],
  };
}

export function AlarmsTab() {
  const { t } = useTranslation();
  const storeProject        = useAppStore((s) => s.project);
  const updateProjectAlarms = useAppStore((s) => s.updateProjectAlarms);
  const liveAlarms          = useAppStore((s) => s.alarms);
  const markSaveOk          = useAppStore((s) => s.markSaveOk);

  const [alarms, setAlarms] = useState<AlarmDef[]>(storeProject?.alarms ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // Stesso schema di TagsTab: si traccia l'intenzione dell'utente, non la
  // differenza strutturale bozza-vs-store. Vedi lì per l'incidente del
  // 2026-07-28 che aveva fatto escludere entrambe le tab da "Salva tutto".
  const [touched, setTouched] = useState(false);

  const sync = useSezioneSincronizzata<AlarmDef[]>({
    remoto: storeProject?.alarms,
    applica: (v) => { setAlarms(v); setTouched(false); },
    modificato: touched,
    progetto: storeProject?.meta?.name,
  });

  const addAlarm = () => {
    setTouched(true);
    setAlarms((prev) => [...prev, emptyAlarm()]);
  };

  const updateAlarm = (idx: number, patch: Partial<AlarmDef>) => {
    setTouched(true);
    setAlarms((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  /** Unisce in `idx` gli altri allarmi sullo stesso tag (vedi
   *  `unisciAllarmi.ts`). Se l'allarme tolto aveva impostazioni sue (ritardi,
   *  notifiche…) diverse da questo, si chiede prima: quelle si perdono. */
  const unisciQui = (idx: number) => {
    const resta = alarms[idx];
    const tag = resta.tag.trim();
    const altri = alarms.filter((a, j) => j !== idx && a.tag.trim() === tag);
    if (altri.length === 0) return;
    const { unito, perse } = unisciAllarmi(resta, altri);
    const domanda = t("cfgUi.alarmMergeConfirm", { id: resta.id, altri: altri.map((a) => a.id).join(", "), n: unito.levels?.length ?? 0 })
      + (perse.length ? "\n\n" + t("cfgUi.alarmMergeLost", { elenco: perse.map((p) => `${p.id}: ${p.campi.join(", ")}`).join("\n") }) : "");
    if (!window.confirm(domanda)) return;
    setTouched(true);
    setAlarms((prev) => prev.flatMap((a, j) => (j === idx ? [unito] : altri.includes(a) ? [] : [a])));
  };

  /** Scrive un livello. Toccare un allarme vecchio lo **converte**: i campi di
   *  primo livello spariscono, ed è l'unico modo perché il salvataggio smetta
   *  di essere rifiutato. */
  const updateLivello = (idx: number, liv: number, patch: Partial<AlarmLevel>) => {
    setTouched(true);
    setAlarms((prev) => prev.map((a, i) => {
      if (i !== idx) return a;
      const levels = livelliDi(a).map((l, j) => (j === liv ? { ...l, ...patch } : l));
      return { ...a, levels, condition: undefined, message: undefined, severity: undefined, dead_band: undefined };
    }));
  };

  const addLivello = (idx: number) => {
    setTouched(true);
    setAlarms((prev) => prev.map((a, i) => {
      if (i !== idx) return a;
      const levels = [...livelliDi(a), { condition: { kind: "above", threshold: 0 } as AlarmCondition, severity: "Critical" as AlarmSeverity, message: "" }];
      return { ...a, levels, condition: undefined, message: undefined, severity: undefined, dead_band: undefined };
    }));
  };

  const removeLivello = (idx: number, liv: number) => {
    setTouched(true);
    setAlarms((prev) => prev.map((a, i) => {
      if (i !== idx) return a;
      const levels = livelliDi(a).filter((_, j) => j !== liv);
      return { ...a, levels: levels.length ? levels : livelliDi(a), condition: undefined, message: undefined, severity: undefined, dead_band: undefined };
    }));
  };

  /** Formato vecchio: `condition` al primo livello, `levels` vuoto. Blocca il
   *  salvataggio di **tutto** il progetto (`validate::blocco_salvataggio`), e
   *  a vederlo non si distingue da un allarme giusto: per questo la riga lo
   *  dice e offre il bottone (26-09-2026 — prima bisognava indovinare che
   *  toccare un campo qualsiasi lo convertiva). */
  const eVecchio = (a: AlarmDef) => !a.levels?.length && !!a.condition;
  const converti = (a: AlarmDef): AlarmDef =>
    eVecchio(a) ? { ...a, levels: livelliDi(a), condition: undefined, message: undefined, severity: undefined, dead_band: undefined } : a;
  const convertiUno = (idx: number) => {
    setTouched(true);
    setAlarms((prev) => prev.map((a, i) => (i === idx ? converti(a) : a)));
  };
  const convertiTutti = () => {
    setTouched(true);
    setAlarms((prev) => prev.map(converti));
  };
  const quantiVecchi = alarms.filter(eVecchio).length;

  // L'allarme scelto da un rilievo (clic nella tendina dei rilievi): la riga
  // si evidenzia e scorre al centro, come fa la scheda Variabili.
  const configFocus = useAppStore((s) => s.configFocus);
  const inQuestaScheda = useAppStore((s) => s.configTab === "alarms");
  const sceltoId = inQuestaScheda ? configFocus : null;
  const rigaScelta = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    rigaScelta.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [sceltoId]);
  /** Gli altri allarmi sullo stesso tag: adesso un tag ne vuole uno solo, con
   *  più livelli. Unirli è una scelta (quale id resta, che messaggi), quindi
   *  qui si segnala e basta. */
  const altriSulTag = (idx: number) => {
    const tag = alarms[idx].tag.trim();
    return tag ? alarms.filter((a, j) => j !== idx && a.tag.trim() === tag).map((a) => a.id || "?") : [];
  };

  const updateCondition = (idx: number, cond: AlarmCondition) =>
    updateLivello(idx, 0, { condition: cond });

  const removeAlarm = (idx: number) => {
    setTouched(true);
    setAlarms((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const valid = alarms.filter((a) => a.id.trim() !== "" && a.tag.trim() !== "");
    setSaving(true);
    try {
      await api.updateAlarms(valid);
      updateProjectAlarms(valid);
      setAlarms(valid);
      setTouched(false);
      setSaved(true);
      // Vedi commento analogo in TagsTab: segnala il salvataggio riuscito
      // allo stato globale che alimenta la finestra "salvataggio nostro" del
      // watcher progetto, altrimenti il banner "cambiato esternamente"
      // scatta anche sulla sessione che ha appena salvato.
      markSaveOk();
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
{/* Registrata di nuovo in `pendingSections` dal 2026-08-25, come TagsTab:
          `touched` traccia l'intenzione dell'utente invece della differenza
          strutturale. */}
      <SaveBar onSave={handleSave} saving={saving} saved={saved} section="alarms" dirty={touched} />
      <div style={S.sectionTitle}>{t("cfgUi.alarms")}</div>
      <div style={S.notice}>
        <Trans i18nKey="cfgUi.alarmsNotice" components={TRANS_COMP} />
      </div>

      {quantiVecchi > 0 && (
        <div style={{ ...S.notice, display: "flex", alignItems: "center", gap: 10, borderColor: "var(--brand-danger, #ef4444)", color: "var(--brand-danger-soft, #fca5a5)" }}>
          <span style={{ flex: 1 }}>⚠ {t("cfgUi.alarmOldFormatAll", { n: quantiVecchi })}</span>
          <button type="button" style={S.btn("primary")} onClick={convertiTutti} data-testid="alarms-converti-tutti">
            {t("cfgUi.alarmConvertAll", { n: quantiVecchi })}
          </button>
        </div>
      )}

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: "16%" }}>ID</th>
            <th style={{ ...S.th, width: "18%" }}>{t("cfg.tag")}</th>
            <th style={{ ...S.th, width: "10%" }}>{t("cfg.condition")}</th>
            <th style={{ ...S.th, width: "10%" }}>{t("cfg.threshold")}</th>
            <th style={{ ...S.th, width: "8%" }} title={t("cfg.hysteresis2")}>{t("cfg.deadBand")}</th>
            <th style={{ ...S.th, width: "10%" }}>{t("cfg.severity")}</th>
            <th style={{ ...S.th, width: "20%" }}>{t("cfg.message")}</th>
            <th style={{ ...S.th, width: "12%" }} title={t("cfg.telegramColHint")}>Telegram</th>
            <th style={{ ...S.th, width: "6%" }}>{t("cfg.state")}</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {alarms.length === 0 && (
            <tr>
              <td colSpan={10} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                {t("cfgUi.noAlarmsDefined")}
              </td>
            </tr>
          )}
          {alarms.map((alm, i) => {
            const live = liveAlarms[alm.id];
            // La riga principale mostra il **primo livello**; gli altri stanno
            // nelle righe di continuazione sotto (23-09-2026). `l0` è quel
            // livello, anche quando l'allarme è ancora nel formato vecchio.
            const livelli = livelliDi(alm);
            const l0 = livelli[0];
            const sfondo = i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)";
            const vecchio = eVecchio(alm);
            const altri = altriSulTag(i);
            return (
              <React.Fragment key={i}>
              {(vecchio || altri.length > 0) && (
                <tr data-testid={`alarm-attenzione-${i}`} style={{ background: sfondo }}>
                  <td colSpan={10} style={{ ...S.td, borderLeft: "3px solid var(--brand-danger, #ef4444)", color: "var(--brand-danger-soft, #fca5a5)", fontSize: 11 }}>
                    {vecchio && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 12 }}>
                        ⚠ {t("cfgUi.alarmOldFormat")}
                        <button type="button" style={S.btn("ghost")} onClick={() => convertiUno(i)}>{t("cfgUi.alarmConvert")}</button>
                      </span>
                    )}
                    {altri.length > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        ⚠ {t("cfgUi.alarmDuplicateTag", { tag: alm.tag, altri: altri.join(", ") })}
                        <button type="button" style={S.btn("ghost")} onClick={() => unisciQui(i)} data-testid={`alarm-unisci-${i}`}>
                          {t("cfgUi.alarmMerge")}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              )}
              <tr
                ref={alm.id === sceltoId ? rigaScelta : undefined}
                style={{
                  background: alm.id === sceltoId ? "var(--brand-surface, #1e293b)" : sfondo,
                  outline: alm.id === sceltoId ? "1px solid var(--brand-primary, #3b82f6)" : undefined,
                }}
              >
                <td style={S.td}>
                  <input
                    style={S.inputSm}
                    value={alm.id}
                    onChange={(e) => updateAlarm(i, { id: e.target.value })}
                    spellCheck={false}
                  />
                </td>
                <td style={S.td}>
                  <TagInput
                    style={S.inputSm}
                    placeholder="es. boiler.t"
                    value={alm.tag}
                    onChange={(v) => updateAlarm(i, { tag: v })}
                  />
                </td>
                <td style={S.td}>
                  {(() => {
                    const isComposite = ["and", "or", "not"].includes(l0.condition.kind);
                    if (isComposite) {
                      return (
                        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}
                          title={t("cfg.compositeCondition")}>
                          {l0.condition.kind}
                        </span>
                      );
                    }
                    return (
                      <select
                        style={{ ...S.inputSm, cursor: "pointer" }}
                        value={l0.condition.kind}
                        onChange={(e) => {
                          const kind = e.target.value as AlarmCondition["kind"];
                          if (kind === "above" || kind === "below") {
                            updateCondition(i, { kind, threshold: 0 });
                          } else if (kind === "not") {
                            updateCondition(i, { kind: "not", condition: { kind: "bool_true" } });
                          } else {
                            updateCondition(i, { kind: "bool_equals", value: true });
                          }
                        }}
                      >
                        <option value="above">above</option>
                        <option value="below">below</option>
                        <option value="bool_equals">bool_equals</option>
                        <option value="not">not</option>
                      </select>
                    );
                  })()}
                </td>
                <td style={S.td}>
                  {(() => {
                    const cond = l0.condition;
                    const isBool = cond.kind === "bool_equals" || cond.kind === "bool_true" || cond.kind === "bool_false";
                    const isComposite = cond.kind === "and" || cond.kind === "or" || cond.kind === "not";
                    if (isComposite) return null;
                    if (isBool) {
                      const boolVal = cond.kind === "bool_true" ? "true"
                                    : cond.kind === "bool_false" ? "false"
                                    : (cond as { kind: "bool_equals"; value: boolean }).value ? "true" : "false";
                      return (
                        <select
                          style={{ ...S.inputSm, cursor: "pointer" }}
                          value={boolVal}
                          onChange={(e) =>
                            updateCondition(i, { kind: "bool_equals", value: e.target.value === "true" })
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      );
                    }
                    return (
                      <input
                        style={S.inputSm}
                        type="number"
                        step="any"
                        value={(cond as { kind: "above" | "below"; threshold: number }).threshold}
                        onChange={(e) =>
                          updateCondition(i, { kind: cond.kind as "above" | "below", threshold: Number(e.target.value) })
                        }
                      />
                    );
                  })()}
                </td>
                <td style={S.td}>
                  {/* dead_band: only for above/below atomic conditions */}
                  {(l0.condition.kind === "above" || l0.condition.kind === "below") && (
                    <input
                      style={S.inputSm}
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      title={t("cfg.hysteresis1")}
                      value={l0.dead_band ?? ""}
                      onChange={(e) => updateLivello(i, 0, { dead_band: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                  )}
                </td>
                <td style={S.td}>
                  <select
                    style={{ ...S.inputSm, cursor: "pointer" }}
                    value={l0.severity ?? "Warning"}
                    onChange={(e) => updateLivello(i, 0, { severity: e.target.value as AlarmSeverity })}
                  >
                    <option value="Info">Info</option>
                    <option value="Warning">Warning</option>
                    <option value="Critical">Critical</option>
                  </select>
                </td>
                <td style={S.td}>
                  {/* Lo stesso campo dei testi dei sinottici: il messaggio digitato
                      diventa una voce della tabella lingue, e qui si vede il testo e
                      non `{{t0001}}`. Fino al 18-09-2026 era un <input> nudo: un
                      allarme scritto dall'IDE non finiva MAI in tabella, e la promessa
                      «compresi i messaggi di allarme» valeva solo per i template, che
                      erano stati tokenizzati con uno script. */}
                  <CampoTestoTradotto
                    valore={l0.message ?? ""}
                    placeholder={t("cfg.alarmMsgPlaceholder")}
                    stile={S.inputSm}
                    onChange={(nuovo) => updateLivello(i, 0, { message: nuovo })}
                  />
                  <input
                    style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                    placeholder={t("cfg.webhookUrl")}
                    value={alm.notify_url ?? ""}
                    onChange={(e) => updateAlarm(i, { notify_url: e.target.value || undefined })}
                  />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      style={{ ...S.inputSm, width: "50%", fontSize: 11 }}
                      type="number" step="any" min="0"
                      placeholder={t("cfg.onDelayS")}
                      title={t("cfg.onDelayHint")}
                      value={alm.on_delay_s ?? ""}
                      onChange={(e) => updateAlarm(i, { on_delay_s: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                    <input
                      style={{ ...S.inputSm, width: "50%", fontSize: 11 }}
                      type="number" step="any" min="0"
                      placeholder={t("cfg.offDelayS")}
                      title={t("cfg.offDelayHint")}
                      value={alm.off_delay_s ?? ""}
                      onChange={(e) => updateAlarm(i, { off_delay_s: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                  </div>
                  <TagInput
                    style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                    placeholder={t("cfg.inhibitTag")}
                    value={alm.inhibit_tag ?? ""}
                    onChange={(v) => updateAlarm(i, { inhibit_tag: v || undefined })}
                  />
                  {/* L'email dell'allarme, come Telegram (29-09-2026): il modo sceglie
                      i destinatari. Assente = i propri se ci sono, altrimenti quelli
                      di progetto: è ciò che facevano i progetti di prima. */}
                  <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 11 }}>{t("cfg.emailModo")}</span>
                    <select
                      style={{ ...S.inputSm, fontSize: 11 }}
                      value={alm.email_mode ?? (alm.notify_email?.length ? "propri" : "progetto")}
                      onChange={(e) => updateAlarm(i, { email_mode: e.target.value as AlarmEmailMode })}
                    >
                      <option value="progetto">{t("cfg.emailModoProgetto")}</option>
                      <option value="propri">{t("cfg.emailModoPropri")}</option>
                      <option value="off">{t("cfg.emailModoOff")}</option>
                    </select>
                  </div>
                  {(alm.email_mode ?? (alm.notify_email?.length ? "propri" : "progetto")) === "propri" && (
                    <div style={{ marginTop: 4 }}>
                      <DestinatariEmail compatto value={alm.notify_email}
                        onChange={(v) => updateAlarm(i, { notify_email: v })} />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      style={{ ...S.inputSm, width: "40%", fontSize: 11 }}
                      type="number" step="any" min="0"
                      placeholder={t("cfg.escalateS")}
                      title={t("cfgUi.escalateAfterSSecondsAfter")}
                      value={alm.escalate_after_s ?? ""}
                      onChange={(e) => updateAlarm(i, { escalate_after_s: e.target.value !== "" ? Number(e.target.value) : undefined })}
                    />
                  </div>
                  {alm.escalate_after_s ? (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11 }}>{t("cfg.emailEscalation")}</div>
                      <DestinatariEmail compatto value={alm.escalate_to}
                        onChange={(v) => updateAlarm(i, { escalate_to: v })} />
                    </div>
                  ) : null}
                </td>
                <td style={S.td}>
                  {/* Instradamento Telegram. L'assenza del campo vale "global":
                      è il comportamento che gli allarmi avevano prima che
                      l'impostazione esistesse, e leggerla come "off" spegnerebbe
                      in silenzio notifiche già in servizio. */}
                  <select
                    style={{ ...S.inputSm, cursor: "pointer", fontSize: 11 }}
                    title={t("cfg.telegramColHint")}
                    value={alm.telegram_mode ?? "global"}
                    onChange={(e) => {
                      const mode = e.target.value as AlarmTelegramMode;
                      updateAlarm(i, {
                        // "global" torna a essere assenza del campo: il YAML resta
                        // quello di prima per gli allarmi che non lo usano.
                        telegram_mode: mode === "global" ? undefined : mode,
                        // Le chat si conservano passando per "off" e tornando a
                        // "chats"; si buttano solo scegliendo "global", dove non
                        // hanno più significato.
                        telegram_chat_ids: mode === "global" ? undefined : alm.telegram_chat_ids,
                      });
                    }}
                  >
                    <option value="global">{t("cfg.tgModeGlobal")}</option>
                    <option value="chats">{t("cfg.tgModeChats")}</option>
                    <option value="off">{t("cfg.tgModeOff")}</option>
                  </select>
                  {alm.telegram_mode === "chats" && (
                    <>
                      <input
                        style={{ ...S.inputSm, marginTop: 4, fontSize: 11 }}
                        placeholder={t("cfg.tgChatIdsPh")}
                        title={t("cfg.tgChatIdsHint")}
                        value={alm.telegram_chat_ids?.join(", ") ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const ids = raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
                          // Si tiene [] invece di undefined: con undefined la riga
                          // tornerebbe indistinguibile da "chat non ancora scritte"
                          // e il runtime non potrebbe segnalare l'impostazione
                          // incompleta.
                          updateAlarm(i, { telegram_chat_ids: ids });
                        }}
                      />
                      {!alm.telegram_chat_ids?.length && (
                        <div style={{ fontSize: 10, color: "var(--brand-warning, #eab308)", marginTop: 2 }}>
                          {t("cfg.tgChatIdsMissing")}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {live ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: live.active
                        ? (live.acknowledged ? "var(--brand-warning, #eab308)" : "var(--brand-danger, #ef4444)")
                        : "var(--brand-text-subtle, #64748b)",
                    }}>
                      {live.active ? (live.acknowledged ? "ACK" : "ON") : "—"}
                    </span>
                  ) : (
                    <span style={{ color: "var(--brand-surface-2, #334155)", fontSize: 11 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button style={{ ...S.btn("ghost"), padding: "2px 6px" }} title={t("cfg.addLevelHint")}
                    onClick={() => addLivello(i)}>+ {t("cfg.level")}</button>{" "}
                  <button style={S.btn("danger")} onClick={() => removeAlarm(i)}>✕</button>
                </td>
              </tr>
              {/* I livelli oltre il primo: una riga ciascuno, con le sole
                  colonne che li riguardano. Id, tag e instradamento sono
                  dell'allarme e stanno solo sulla riga di sopra — è un
                  allarme solo, e la tabella deve farlo vedere. */}
              {livelli.slice(1).map((liv, k) => {
                const j = k + 1;
                const soglia = liv.condition.kind === "above" || liv.condition.kind === "below"
                  ? liv.condition.threshold : undefined;
                return (
                  <tr key={`${i}-${j}`} style={{ background: sfondo }}>
                    <td style={{ ...S.td, color: "var(--brand-text-subtle, #64748b)", textAlign: "right", fontSize: 11 }}>↳</td>
                    <td style={S.td} />
                    <td style={S.td}>
                      <select style={{ ...S.inputSm, cursor: "pointer" }} value={liv.condition.kind}
                        onChange={(e) => {
                          const kind = e.target.value as "above" | "below";
                          updateLivello(i, j, { condition: { kind, threshold: soglia ?? 0 } });
                        }}>
                        <option value="above">above</option>
                        <option value="below">below</option>
                      </select>
                    </td>
                    <td style={S.td}>
                      {soglia !== undefined && (
                        <input type="number" style={S.inputSm} value={soglia}
                          onChange={(e) => updateLivello(i, j, {
                            condition: { kind: liv.condition.kind as "above" | "below", threshold: Number(e.target.value) },
                          })} />
                      )}
                    </td>
                    <td style={S.td}>
                      <input type="number" style={S.inputSm} placeholder="—" title={t("cfg.hysteresis2")}
                        value={liv.dead_band ?? ""}
                        onChange={(e) => updateLivello(i, j, { dead_band: e.target.value !== "" ? Number(e.target.value) : undefined })} />
                    </td>
                    <td style={S.td}>
                      <select style={{ ...S.inputSm, cursor: "pointer" }} value={liv.severity ?? "Warning"}
                        onChange={(e) => updateLivello(i, j, { severity: e.target.value as AlarmSeverity })}>
                        <option value="Info">Info</option>
                        <option value="Warning">Warning</option>
                        <option value="Critical">Critical</option>
                      </select>
                    </td>
                    <td style={S.td} colSpan={3}>
                      <input style={S.inputSm} value={liv.message ?? ""} placeholder={t("cfg.message")}
                        onChange={(e) => updateLivello(i, j, { message: e.target.value })} />
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <button style={{ ...S.btn("ghost"), padding: "2px 6px" }} title={t("cfg.removeLevelHint")}
                        onClick={() => removeLivello(i, j)}>✕</button>
                    </td>
                  </tr>
                );
              })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      <BarraConflittoSezione sync={sync} t={t} />

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button style={S.btn("ghost")} onClick={addAlarm}>{t("cfgUi.addAlarm")}</button>
      </div>
    </div>
  );
}

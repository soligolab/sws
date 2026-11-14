// The device's screen and access settings (14-11-2026): what the panel does
// rather than how the pages look — full screen, frames per second, brightness,
// idle times, touch beep and the control panel. They are project fields and
// travel with the deploy; the IDE shows them under Instance → Device → «Screen
// and access», while the «Project settings» window keeps the page settings.
// Moved here from `EditorShell.tsx` as they were.

import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { CampoNumero } from "@/components/CampoNumero";
import { CampoPassword } from "@/components/CampoPassword";
import { getStatus } from "@/control-panel/api";
import { salvaLayout } from "@/formatoProgettoAzioni";
import { useAppStore } from "@/store";
import type { BeepTocco, PannelloConfig } from "@/types";
import { salvaPannello } from "./salvaPannello";

const stileCampoPannello = { background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 12, width: 80 };
const stileAiutoPannello = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 3, lineHeight: 1.45 };
// One row per value (maintainer, 13-11-2026: «too vertical, the fields are not
// clear»): the label on the left, the field, and the unit large on its right.
const stileRigaPannello = { display: "grid", gridTemplateColumns: "1fr 80px 44px", alignItems: "center", columnGap: 8 };
const stileUnitaPannello = { fontSize: 16, fontWeight: 600, color: "var(--brand-text-2, #cbd5e1)" };

/** Label, field and unit on one line. */
function RigaPannello({ etichetta, unita, children }: { etichetta: string; unita: string; children: React.ReactNode }) {
  return (
    <label style={stileRigaPannello}>
      <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>{etichetta}</span>
      {children}
      <span style={stileUnitaPannello}>{unita}</span>
    </label>
  );
}

/** Un numero intero dentro i limiti, scritto quando si esce dal campo: vuoto =
 *  `undefined`, fuori dai limiti torna il valore di prima. */
function NumeroAlBlur({ valore, min, max, placeholder, testid, onValore }: {
  valore: number | undefined; min: number; max: number; placeholder?: string; testid: string;
  onValore: (n: number | undefined) => void;
}) {
  const [testo, setTesto] = useState(valore === undefined ? "" : String(valore));
  useEffect(() => { setTesto(valore === undefined ? "" : String(valore)); }, [valore]);
  const esci = () => {
    const n = testo.trim() === "" ? undefined : Math.round(Number(testo));
    if (n !== undefined && (!Number.isFinite(n) || n < min || n > max)) { setTesto(valore === undefined ? "" : String(valore)); return; }
    if (n !== valore) onValore(n);
  };
  return (
    <CampoNumero min={min} max={max} placeholder={placeholder} value={testo} data-testid={testid}
      onTesto={setTesto} onBlur={esci}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      style={stileCampoPannello} />
  );
}

/** Un campo numerico di `pannello`: fotogrammi al secondo (12-11-2026), luce e
 *  tempi di riposo (13-11-2026, piano Tiny TY). */
function NumeroPannello({ campo, min, max, placeholder, etichetta, unita, aiuto, onErrore }: {
  campo: "fps" | "oscura_dopo_min" | "spegni_dopo_min";
  min: number; max: number; placeholder?: string; etichetta: string; unita: string; aiuto: string;
  onErrore: (e: string | null) => void;
}) {
  const valore = useAppStore((s) => s.project?.pannello?.[campo]);
  const salva = async (n: number | undefined) => {
    onErrore(null);
    try { await salvaPannello({ [campo]: n }); }
    catch (e) { onErrore(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div>
      <RigaPannello etichetta={etichetta} unita={unita}>
        <NumeroAlBlur valore={valore} min={min} max={max} placeholder={placeholder}
          testid={`pannello-${campo}`} onValore={(n) => void salva(n)} />
      </RigaPannello>
      <div style={stileAiutoPannello}>{aiuto}</div>
    </div>
  );
}

/** Il beep a ogni tocco (13-11-2026): spento o acceso con nota, durata e
 *  volume. Acceso la prima volta, parte dai valori di `BeepTocco::default`. */
function BeepPannello({ onErrore }: { onErrore: (e: string | null) => void }) {
  const { t } = useTranslation();
  const beep = useAppStore((s) => s.project?.pannello?.beep);
  const salva = async (b: BeepTocco | undefined) => {
    onErrore(null);
    try { await salvaPannello({ beep: b }); }
    catch (e) { onErrore(e instanceof Error ? e.message : String(e)); }
  };
  const campo = (k: keyof BeepTocco, min: number, max: number, etichetta: string, unita: string) => (
    <RigaPannello etichetta={etichetta} unita={unita}>
      <NumeroAlBlur valore={beep?.[k]} min={min} max={max} testid={`pannello-beep-${k}`}
        onValore={(n) => { if (beep && n !== undefined) void salva({ ...beep, [k]: n }); }} />
    </RigaPannello>
  );
  return (
    <div>
      <CasellaPannello checked={beep !== undefined} testid="pannello-beep" testo={t("shell.beepPannello")}
        onCambia={(on) => {
          if (on) void salva(ultimiPannello().beep ?? { frequenza_hz: 1000, durata_ms: 30, volume: 100 });
          else { ricordaPannello({ beep }); void salva(undefined); }
        }} />
      {beep && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingLeft: 22 }}>
          {campo("frequenza_hz", 100, 10000, t("shell.beepFrequenza"), "Hz")}
          {campo("durata_ms", 5, 1000, t("shell.beepDurata"), "ms")}
          {campo("volume", 1, 100, t("shell.beepVolume"), "%")}
          <div style={stileAiutoPannello}>{t("shell.beepVolumeHelp")}</div>
        </div>
      )}
    </div>
  );
}

/** The last light and beep values, so unticking and ticking again gives
 *  them back instead of the defaults (maintainer, 13-11-2026). A per-browser
 *  convenience: it may be missing, and then the defaults apply. */
const ULTIMI_PANNELLO = "sws.pannello.ultimi";
function ricordaPannello(m: Partial<PannelloConfig>) {
  try {
    const prima = JSON.parse(localStorage.getItem(ULTIMI_PANNELLO) ?? "{}");
    localStorage.setItem(ULTIMI_PANNELLO, JSON.stringify({ ...prima, ...m }));
  } catch { /* no storage: defaults next time */ }
}
function ultimiPannello(): Partial<PannelloConfig> {
  try { return JSON.parse(localStorage.getItem(ULTIMI_PANNELLO) ?? "{}"); } catch { return {}; }
}

/** A tick box whose text does not toggle it: only the box does (13-11-2026,
 *  a click on the text switched the beep off by mistake). */
function CasellaPannello({ checked, testid, testo, onCambia }: {
  checked: boolean; testid: string; testo: string; onCambia: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
      <input type="checkbox" checked={checked} data-testid={testid} aria-label={testo}
        style={{ cursor: "pointer" }} onChange={(e) => onCambia(e.target.checked)} />
      <span>{testo}</span>
    </div>
  );
}

/** A brightness as a horizontal slider, saved when the finger or the mouse is
 *  lifted (not at every step: each save is a PUT). The value large on the right. */
function SliderLuce({ etichetta, valore, min, max, testid, onValore }: {
  etichetta: string; valore: number; min: number; max: number; testid: string;
  onValore: (n: number) => void;
}) {
  const [v, setV] = useState(valore);
  useEffect(() => { setV(valore); }, [valore]);
  const fine = () => { if (v !== valore) onValore(v); };
  return (
    <label style={{ display: "grid", gridTemplateColumns: "1fr 2fr 56px", alignItems: "center", columnGap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>{etichetta}</span>
      <input type="range" min={min} max={max} step={1} value={v} data-testid={testid}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={fine} onKeyUp={fine} onBlur={fine} style={{ width: "100%" }} />
      <span style={stileUnitaPannello}>{v} %</span>
    </label>
  );
}

/** The two brightnesses (13-11-2026): normal and dimmed, as sliders. Off = SWS
 *  leaves the backlight alone; the dimmed light stays below the normal one. */
function LucePannello({ onErrore }: { onErrore: (e: string | null) => void }) {
  const { t } = useTranslation();
  const luce = useAppStore((s) => s.project?.pannello?.luminosita);
  const dimmed = useAppStore((s) => s.project?.pannello?.dimmed_brightness);
  const salva = async (m: Partial<PannelloConfig>) => {
    onErrore(null);
    try { await salvaPannello(m); }
    catch (e) { onErrore(e instanceof Error ? e.message : String(e)); }
  };
  const normale = luce ?? 80;
  const oscurata = Math.min(dimmed ?? Math.max(1, Math.round(normale * 0.15)), normale - 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <CasellaPannello checked={luce !== undefined} testid="pannello-luce" testo={t("shell.lucePannello")}
        onCambia={(on) => {
          if (on) {
            const u = ultimiPannello();
            void salva({ luminosita: u.luminosita ?? 80, dimmed_brightness: u.dimmed_brightness ?? 15 });
          } else {
            ricordaPannello({ luminosita: luce, dimmed_brightness: dimmed });
            void salva({ luminosita: undefined, dimmed_brightness: undefined });
          }
        }} />
      {luce !== undefined && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 22 }}>
          <SliderLuce etichetta={t("shell.luminositaPannello")} valore={normale} min={5} max={100}
            testid="pannello-luminosita"
            onValore={(n) => void salva({ luminosita: n, dimmed_brightness: Math.min(oscurata, n - 1) })} />
          <SliderLuce etichetta={t("shell.luceOscurata")} valore={oscurata} min={1} max={Math.max(1, normale - 1)}
            testid="pannello-dimmed" onValore={(n) => void salva({ dimmed_brightness: n })} />
        </div>
      )}
    </div>
  );
}

/** Luce, riposo e beep del pannello (13-11-2026): una sezione sola, con la
 *  riga che dice dove valgono. */
function SchermoPannello({ onErrore }: { onErrore: (e: string | null) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{t("shell.schermoPannello")}</div>
      <div style={{ ...stileAiutoPannello, marginTop: 0 }}>{t("shell.schermoPannelloHelp")}</div>
      <LucePannello onErrore={onErrore} />
      <NumeroPannello campo="oscura_dopo_min" min={1} max={1440} etichetta={t("shell.oscuraDopo")} unita="min"
        aiuto={t("shell.oscuraDopoHelp")} onErrore={onErrore} />
      <NumeroPannello campo="spegni_dopo_min" min={1} max={1440} etichetta={t("shell.spegniDopo")} unita="min"
        aiuto={t("shell.spegniDopoHelp")} onErrore={onErrore} />
      <BeepPannello onErrore={onErrore} />
    </div>
  );
}

/** The device control panel of the project (plan 2026-11-13-pannello-di-controllo,
 *  phase 6): whether the gesture and the synoptic action open it, and the
 *  service PIN. Until the project sets one, the device's initial PIN holds —
 *  the low six digits of the MAC, readable by anyone on the network — and the
 *  section says so. */
function ControlPanelSettings({ onError }: { onError: (e: string | null) => void }) {
  const { t } = useTranslation();
  const cfg = useAppStore((s) => s.project?.control_panel);
  const enabled = cfg?.enabled ?? true;
  const hasPin = !!cfg?.pin_hash;
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);
  const valid = /^[0-9a-fA-F]{6}$/.test(pin);
  const save = async (body: { enabled: boolean; pin?: string; reset_pin?: boolean }) => {
    onError(null);
    try {
      await api.updateControlPanel(body);
      const pinHash = body.reset_pin ? undefined : body.pin ? "********" : cfg?.pin_hash;
      const next = body.enabled && !pinHash ? undefined : { enabled: body.enabled, ...(pinHash ? { pin_hash: pinHash } : {}) };
      useAppStore.setState((s) => (s.project ? { project: { ...s.project, control_panel: next } } : {}));
      setPin("");
      setEditing(false);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div data-testid="control-panel-settings" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{t("shell.controlPanel")}</div>
      <div style={{ ...stileAiutoPannello, marginTop: 0 }}>{t("shell.controlPanelHelp")}</div>
      <CasellaPannello checked={enabled} testid="control-panel-enabled" testo={t("shell.controlPanelEnabled")}
        onCambia={(on) => void save({ enabled: on })} />
      {hasPin && !editing ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <span data-testid="control-panel-pin-state">{t("shell.controlPanelPinSet")}</span>
          <button type="button" style={smallButton} onClick={() => setEditing(true)}>{t("shell.controlPanelPinChange")}</button>
          <button type="button" style={smallButton} data-testid="control-panel-pin-reset"
            onClick={() => void save({ enabled, reset_pin: true })}>{t("shell.controlPanelPinReset")}</button>
        </div>
      ) : (
        <>
          {!hasPin && (
            <div data-testid="control-panel-pin-warning" style={{
              fontSize: 12, lineHeight: 1.45, padding: "6px 8px", borderRadius: 4,
              border: "1px solid var(--brand-warning, #f59e0b)", color: "var(--brand-text, #e2e8f0)",
            }}>{t("shell.controlPanelDevicePin")}</div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CampoPassword value={pin} maxLength={6} autoComplete="new-password" data-testid="control-panel-pin"
              aria-label={t("shell.controlPanelPinLabel")} placeholder={t("shell.controlPanelPinLabel")}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9a-fA-F]/g, "").toLowerCase())}
              style={{ width: 140, fontFamily: "monospace" }} />
            <button type="button" style={smallButton} disabled={!valid} data-testid="control-panel-pin-save"
              onClick={() => void save({ enabled, pin })}>{t("shell.controlPanelPinSave")}</button>
            {editing && (
              <button type="button" style={smallButton} onClick={() => { setEditing(false); setPin(""); }}>
                {t("common.cancel")}
              </button>
            )}
          </div>
          <div style={{ ...stileAiutoPannello, marginTop: 0 }}>{t("shell.controlPanelPinHelp")}</div>
        </>
      )}
    </div>
  );
}

const smallButton = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer",
};

/** The whole section, as the Device leaf shows it. Every field saves at once. */
export function DeviceScreenSettings() {
  const { t } = useTranslation();
  const hideChrome = useAppStore((s) => !!s.project?.page_layout?.hide_viewer_chrome);
  const [error, setError] = useState<string | null>(null);
  // The brightness set by hand on this device's control panel wins over the
  // project's: say so here, or the slider above seems to do nothing. Read once;
  // an IDE that is not on the device has none, and the line stays away.
  const [deviceBrightness, setDeviceBrightness] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    getStatus().then((st) => { if (alive) setDeviceBrightness(st.brightness ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const setHideChrome = async (on: boolean) => {
    setError(null);
    try { await salvaLayout((base) => ({ size_mode: "fixed", ...base, hide_viewer_chrome: on || undefined })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div data-testid="device-screen-settings" style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 13, color: "var(--brand-text-2, #cbd5e1)", margin: 0 }}>{t("shell.deviceScreenIntro")}</p>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
        <input type="checkbox" checked={hideChrome} onChange={(e) => void setHideChrome(e.target.checked)}
          style={{ marginTop: 2, accentColor: "var(--brand-primary, #3b82f6)" }} />
        <span>
          {t("shell.fullScreenViewerHideThe")}
          <div style={stileAiutoPannello}>
            {t("shell.hideChromeHelp")} <strong>{t("shell.warning")}</strong>{t("shell.hideChromeWarning")}
          </div>
        </span>
      </label>
      <NumeroPannello campo="fps" min={1} max={60} placeholder="20" etichetta={t("shell.fpsPannello")} unita="fps"
        aiuto={t("shell.fpsPannelloHelp")} onErrore={setError} />
      <SchermoPannello onErrore={setError} />
      {deviceBrightness !== null && (
        <div data-testid="device-brightness-override" style={{
          fontSize: 12, lineHeight: 1.45, padding: "6px 8px", borderRadius: 4, marginTop: -8,
          border: "1px solid var(--brand-warning, #f59e0b)", color: "var(--brand-text, #e2e8f0)",
        }}>{t("shell.deviceBrightnessOverride", { n: deviceBrightness })}</div>
      )}
      <ControlPanelSettings onError={setError} />
      {error && <div style={{ color: "var(--brand-danger, #ef4444)", fontSize: 12 }}>{t("shell.erroreSalvataggio", { errore: error })}</div>}
    </div>
  );
}

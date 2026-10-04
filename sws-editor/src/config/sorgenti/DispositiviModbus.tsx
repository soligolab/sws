/** Bus e dispositivi Modbus nell'IDE (04-10-2026): l'elenco dei dispositivi
 *  dentro la card del bus, e la card di un dispositivo (unit id, ordine,
 *  polling, timeout, mappature). La logica pura sta in `modbusDispositivi.ts`. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import type { DispositivoModbus, RegisterMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { emptyRegister } from "@/config/sorgenti/vuote";
import { CampoOrdineModbus, TabellaRegistriModbus } from "@/config/sorgenti/TabellaRegistriModbus";
import {
  type BusModbus, conDispositivi, dispositiviDi, eBusModbus, etichettaDispositivo, focusDispositivo, nuovoDispositivo,
  TIMEOUT_MODBUS_MS,
} from "@/config/sorgenti/modbusDispositivi";
import {
  COLORI_STATO, coloreStato, statoDispositivo, useStatoSorgenti,
} from "@/config/sorgenti/statoSorgenti";
import type { StatoCollegamento } from "@/types";
import { api } from "@/api/client";
import { CatalogoDispositiviModal, IconaCatalogo, useElencoCatalogo, voceDelModello } from "@/config/sorgenti/CatalogoDispositiviModal";
import type { DaCatalogo } from "@/config/sorgenti/daCatalogo";

const ETICHETTA = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

/** Il pallino di stato di un bus o di un dispositivo. */
export function PallinoStato({ stato, testid }: { stato: StatoCollegamento | undefined; testid?: string }) {
  const { t } = useTranslation();
  const c = coloreStato(stato);
  const testo = t(`cfg.modbusStato.${c}`) + (stato?.errore ? ` — ${stato.errore}` : "");
  return (
    <span
      data-testid={testid}
      data-stato={c}
      title={testo}
      aria-label={testo}
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLORI_STATO[c], flexShrink: 0 }}
    />
  );
}

/** L'elenco dei dispositivi nella card del bus: si apre un dispositivo
 *  dall'albero o da qui. */
export function ElencoDispositiviModbus<B extends BusModbus>({ bus, onChange }: { bus: B; onChange: (b: B) => void }) {
  const { t, i18n } = useTranslation();
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const stato = useStatoSorgenti()[bus.id];
  const elencoCatalogo = useElencoCatalogo();
  const [catalogo, setCatalogo] = useState(false);
  const updateProjectTags = useAppStore((s) => s.updateProjectTags);
  const updateProjectTypes = useAppStore((s) => s.updateProjectTypes);
  const markSaveOk = useAppStore((s) => s.markSaveOk);
  const dispositivi = dispositiviDi(bus);
  // Dal catalogo: tipo e variabile si salvano subito (il tipo prima, perché la
  // variabile lo nomina), il dispositivo va nella bozza dei Protocolli come
  // ogni altra modifica al bus.
  const daCatalogoConfermato = async (r: DaCatalogo) => {
    if (!r.riusaTipo) {
      const tipi = [...(useAppStore.getState().project?.types ?? []), r.tipo];
      await api.updateTypes(tipi);
      updateProjectTypes(tipi);
    }
    const tags = [...(useAppStore.getState().project?.tags ?? []), r.tag];
    await api.updateTags(tags);
    updateProjectTags(tags);
    markSaveOk();
    onChange(conDispositivi(bus, [...dispositivi, r.dispositivo]));
    navigateToConfig("protocols", focusDispositivo(bus.id, r.dispositivo.unit_id));
  };
  const aggiungi = () => {
    const d = nuovoDispositivo(bus);
    onChange(conDispositivi(bus, [...dispositivi, d]));
    navigateToConfig("protocols", focusDispositivo(bus.id, d.unit_id));
  };
  const togli = (unit: number) => onChange(conDispositivi(bus, dispositivi.filter((d) => d.unit_id !== unit)));
  return (
    <>
      <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
        {t("cfg.modbusDispositivi")}
      </div>
      {dispositivi.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", marginBottom: 8 }}>{t("cfg.modbusNessunDispositivo")}</div>
      )}
      {dispositivi.length > 0 && (
        <table style={{ ...S.table, marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={S.th}></th>
              <th style={S.th}></th>
              <th style={S.th}>{t("cfg.unitId")}</th>
              <th style={S.th}>{t("cfg.modbusNome")}</th>
              <th style={S.th}>{t("cfg.modbusModelloCol")}</th>
              <th style={S.th}>{t("cfg.modbusMappature")}</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {dispositivi.map((d) => (
              <tr key={d.unit_id} data-testid={`modbus-dev-row-${bus.id}-${d.unit_id}`}>
                <td style={S.td}><PallinoStato stato={statoDispositivo(stato, d.unit_id)} /></td>
                <td style={S.td}>{voceDelModello(elencoCatalogo, d.modello) && <IconaCatalogo voce={voceDelModello(elencoCatalogo, d.modello)!} lato={28} />}</td>
                <td style={S.td}>{d.unit_id}</td>
                <td style={S.td}>{d.nome || "—"}</td>
                <td style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)" }}
                  title={voceDelModello(elencoCatalogo, d.modello)?.descrizione?.[i18n.language?.startsWith("en") ? "en" : "it"]}>
                  {voceDelModello(elencoCatalogo, d.modello)
                    ? `${voceDelModello(elencoCatalogo, d.modello)!.marca} ${voceDelModello(elencoCatalogo, d.modello)!.modello}`
                    : (d.modello ?? "—")}
                </td>
                <td style={S.td}>{d.registers.length}</td>
                <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button style={S.btn("ghost")} onClick={() => navigateToConfig("protocols", focusDispositivo(bus.id, d.unit_id))}>
                    {t("cfg.modbusApri")}
                  </button>{" "}
                  <button style={S.btn("danger")} onClick={() => togli(d.unit_id)}>{t("cfgUi.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={S.btn("ghost")} onClick={aggiungi} data-testid={`modbus-dev-add-${bus.id}`}>
          {t("cfg.modbusAggiungiDispositivo")}
        </button>
        <button style={S.btn("ghost")} onClick={() => setCatalogo(true)} data-testid={`modbus-dev-catalog-${bus.id}`}>
          {t("cfg.modbusDalCatalogo")}
        </button>
      </div>
      {catalogo && <CatalogoDispositiviModal bus={bus} onConferma={daCatalogoConfermato} onClose={() => setCatalogo(false)} />}
    </>
  );
}

/** La card di un dispositivo del bus. */
export function DispositivoModbusCard<B extends BusModbus>({ bus, unit, onChange, onCreateTag }: {
  bus: B;
  unit: number;
  onChange: (b: B) => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const stato = useStatoSorgenti()[bus.id];
  const voceCatalogo = voceDelModello(useElencoCatalogo(), dispositiviDi(bus).find((x) => x.unit_id === unit)?.modello);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  // Il dispositivo c'è nel progetto salvato? Se no, è appena aggiunto: il
  // pulsante dice «Annulla» invece di «Elimina» (richiesta del maintainer,
  // 04-10-2026: dopo «+ Aggiungi dispositivo» non c'era modo di tornare
  // indietro). L'effetto è lo stesso: esce dalla bozza, e finché non si salva
  // niente è definitivo.
  const salvato = useAppStore((s) => {
    const b = s.project?.sources?.find((x) => x.id === bus.id);
    return !!b && eBusModbus(b) && dispositiviDi(b).some((x) => x.unit_id === unit);
  });
  const dispositivi = dispositiviDi(bus);
  const d = dispositivi.find((x) => x.unit_id === unit);
  if (!d) return null;

  const togli = () => {
    onChange(conDispositivi(bus, dispositivi.filter((x) => x.unit_id !== unit)));
    navigateToConfig("protocols", bus.id);
  };

  const cambia = (patch: Partial<DispositivoModbus>) => {
    const nuovo = { ...d, ...patch };
    onChange(conDispositivi(bus, dispositivi.map((x) => (x.unit_id === unit ? nuovo : x))));
    // L'unit id è anche l'id nell'albero: il focus lo segue, o la card sparirebbe.
    if (patch.unit_id !== undefined && patch.unit_id !== unit) navigateToConfig("protocols", focusDispositivo(bus.id, patch.unit_id));
  };
  const setRegister = (idx: number, patch: Partial<RegisterMapping>) =>
    cambia({ registers: d.registers.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  const removeRegister = (idx: number) => cambia({ registers: d.registers.filter((_, i) => i !== idx) });
  const unitDoppio = (u: number) => dispositivi.some((x) => x.unit_id === u && x !== d);
  const numeroOVuoto = (v: string) => (v.trim() === "" ? undefined : Number(v));

  return (
    <div style={S.card} data-testid={`modbus-dev-card-${bus.id}-${unit}`}>
      <div style={S.cardHead}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PallinoStato stato={statoDispositivo(stato, unit)} testid={`modbus-dev-state-${bus.id}-${unit}`} />
          {voceCatalogo && <IconaCatalogo voce={voceCatalogo} lato={32} />}
          <span style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", fontWeight: 700, letterSpacing: 1 }}>
            {bus.kind === "modbus_rtu" ? "MODBUS RTU" : "MODBUS TCP"}
          </span>
          <button style={{ ...S.btn("ghost"), padding: "0 6px" }} onClick={() => navigateToConfig("protocols", bus.id)} title={t("cfg.modbusAlBus")}>
            {bus.id}
          </button>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>›</span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{etichettaDispositivo(d)}</span>
        </div>
        <button style={S.btn(salvato ? "danger" : "ghost")} onClick={togli} data-testid={`modbus-dev-remove-${bus.id}-${unit}`}
          title={t(salvato ? "cfg.modbusEliminaHint" : "cfg.modbusAnnullaHint")}>
          {t(salvato ? "cfgUi.delete" : "common.cancel")}
        </button>
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "90px 1fr 160px 140px 140px", gap: 12 }}>
          <div>
            <label style={ETICHETTA}>{t("cfg.unitId")}</label>
            <input style={S.input} type="number" min={0} max={255} value={d.unit_id}
              onChange={(e) => {
                const u = Number(e.target.value);
                if (Number.isInteger(u) && u >= 0 && u <= 255 && !unitDoppio(u)) cambia({ unit_id: u });
              }} />
          </div>
          <div>
            <label style={ETICHETTA}>{t("cfg.modbusNome")}</label>
            <input style={S.input} value={d.nome ?? ""} spellCheck={false}
              onChange={(e) => cambia({ nome: e.target.value || undefined })} />
          </div>
          <CampoOrdineModbus value={d.ordine} onChange={(o) => cambia({ ordine: o === "abcd" ? undefined : o })} />
          <div>
            <label style={ETICHETTA}>{t("cfg.pollInterval")}</label>
            <input style={S.input} type="number" min={10} value={d.poll_interval_ms ?? ""}
              placeholder={String(bus.poll_interval_ms)} title={t("cfg.modbusPollDelBus")}
              onChange={(e) => cambia({ poll_interval_ms: numeroOVuoto(e.target.value) })} />
          </div>
          <div>
            <label style={ETICHETTA}>{t("cfg.modbusTimeout")}</label>
            <input style={S.input} type="number" min={10} value={d.timeout_ms ?? ""}
              placeholder={String(TIMEOUT_MODBUS_MS)}
              onChange={(e) => cambia({ timeout_ms: numeroOVuoto(e.target.value) })} />
          </div>
        </div>
        {d.modello && (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", marginBottom: 12 }} data-testid="modello-dispositivo">
            {t("cfg.modbusModello", { modello: voceCatalogo ? `${voceCatalogo.marca} ${voceCatalogo.modello} (${d.modello})` : d.modello })}
          </div>
        )}

        <TabellaRegistriModbus registri={d.registers} setRegister={setRegister} removeRegister={removeRegister}
          onQuickCreate={(rowIdx, prefill) => setQuickCreate({ rowIdx, prefill })} />

        <button style={S.btn("ghost")} onClick={() => cambia({ registers: [...d.registers, emptyRegister()] })}>
          {t("cfgUi.addRegister")}
        </button>
      </div>
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setRegister(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  );
}

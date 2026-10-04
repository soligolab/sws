/** Il campo «Porta seriale» di Modbus RTU con la tendina delle porte vere
 *  (04-10-2026). Al collaudo con due MCM260X sul TC620 `/dev/ttyCOM1` era
 *  scritto a mano: giusto per il pannello, ma il runtime gira in un container
 *  che non vedeva nessuna seriale, e niente lo diceva.
 *
 *  Le porte vengono dal **dispositivo connesso** (è lì che il bus girerà);
 *  senza dispositivo, da questa macchina, e il campo lo dice. Sotto, la riga
 *  di stato della porta scelta: dove porta il collegamento, e se il runtime la
 *  può aprire. */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { PorteSeriali } from "@/types";
import { S } from "@/config/comuni";

type Origine = "remoto" | "remoto-vecchio" | "locale" | "nessuna";

const A_MANO = "\u0000a-mano";

export function CampoPortaSeriale({ value, onChange }: { value: string; onChange: (v: string) => void; idLista?: string }) {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const [porte, setPorte] = useState<PorteSeriali | null>(null);
  const [origine, setOrigine] = useState<Origine>("nessuna");
  const [giro, setGiro] = useState(0);
  // «A mano» (richiesta del maintainer, 04-10-2026): il dispositivo può non
  // essere raggiungibile mentre si configura, e la porta si deve poter scrivere
  // lo stesso. Senza porte lette il campo è testo e basta.
  const [aMano, setAMano] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      let remotoFallito = false;
      if (remoteConnected) {
        try {
          const p = await api.remotePorteSeriali();
          if (vivo) { setPorte(p); setOrigine("remoto"); }
          return;
        } catch { remotoFallito = true; }
      }
      try {
        const p = await api.porteSeriali();
        if (vivo) { setPorte(p); setOrigine(remotoFallito ? "remoto-vecchio" : "locale"); }
      } catch {
        if (vivo) { setPorte(null); setOrigine("nessuna"); }
      }
    })();
    return () => { vivo = false; };
  }, [remoteConnected, remoteUrl, giro]);

  const scelta = porte?.porte.find((p) => p.percorso === value.trim());
  const elencabili = (porte?.porte.length ?? 0) > 0;
  const testo = aMano || !elencabili;
  const dove = origine === "remoto" ? t("cfg.serialeDalDispositivo", { url: remoteUrl ?? "" })
    : origine === "remoto-vecchio" ? t("cfg.serialeRemotoVecchio")
    : origine === "locale" ? t("cfg.serialeDaQuestoPc") : "";

  let stato: { testo: string; colore: string } | null = null;
  // Lo stato della porta conta solo per il dispositivo dove il bus girerà: sul
  // PC dell'editor `/dev/ttyCOM1` non c'è, ed è normale.
  if (porte && value.trim() && origine === "remoto") {
    if (!scelta) {
      stato = {
        testo: porte.container ? t("cfg.serialeNonVistaContainer") : t("cfg.serialeNonVista"),
        colore: "var(--brand-danger-soft, #f87171)",
      };
    } else if (scelta.accesso === "ok") {
      stato = { testo: t("cfg.serialeOk", { link: scelta.collegamento ? ` → ${scelta.collegamento}` : "" }), colore: "var(--brand-success, #22c55e)" };
    } else if (scelta.accesso === "occupata") {
      stato = { testo: t("cfg.serialeOccupata"), colore: "var(--brand-warning, #f59e0b)" };
    } else {
      stato = { testo: t("cfg.serialePermesso"), colore: "var(--brand-danger-soft, #f87171)" };
    }
  }

  return (
    <div>
      <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.serialDevice")}</label>
      <div style={{ display: "flex", gap: 4 }}>
        {testo ? (
          <input style={S.input} value={value} spellCheck={false} placeholder="/dev/ttyUSB0" autoFocus={aMano}
            onChange={(e) => onChange(e.target.value)} data-testid="campo-porta-seriale" />
        ) : (
          <select style={S.input} value={value} data-testid="tendina-porta-seriale"
            onChange={(e) => (e.target.value === A_MANO ? setAMano(true) : onChange(e.target.value))}>
            {value === "" && <option value="">{t("cfg.serialeScegli")}</option>}
            {(porte?.porte ?? []).map((p) => (
              <option key={p.percorso} value={p.percorso}>
                {p.percorso}{p.collegamento ? ` → ${p.collegamento}` : ""}{p.accesso !== "ok" ? ` (${t(`cfg.serialeAccesso.${p.accesso}`)})` : ""}
              </option>
            ))}
            {value !== "" && !scelta && <option value={value}>{value} ({t("cfg.serialeAManoEtichetta")})</option>}
            <option value={A_MANO}>{t("cfg.serialeInserisciAMano")}</option>
          </select>
        )}
        {aMano && elencabili && (
          <button type="button" style={{ ...S.btn("ghost"), padding: "4px 8px" }} title={t("cfg.serialeTornaElenco")}
            onClick={() => setAMano(false)} data-testid="torna-elenco-porte">☰</button>
        )}
        <button type="button" style={{ ...S.btn("ghost"), padding: "4px 8px" }} title={t("cfg.serialeRileggi")}
          onClick={() => setGiro((g) => g + 1)}>↻</button>
      </div>
      {dove && <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 3 }}>{dove}</div>}
      {porte && porte.porte.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", marginTop: 3 }}>
          {porte.container ? t("cfg.serialeNessunaContainer") : t("cfg.serialeNessuna")}
        </div>
      )}
      {stato && <div style={{ fontSize: 11, color: stato.colore, marginTop: 3 }} data-testid="stato-porta-seriale">{stato.testo}</div>}
    </div>
  );
}

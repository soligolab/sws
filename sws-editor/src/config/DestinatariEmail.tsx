import { useTranslation } from "react-i18next";
import type { Destinatario } from "@/types";
import { useAppStore } from "@/store";
import { S } from "@/config/comuni";

/** Un elenco di destinatari email, ognuno con la sua lingua (29-09-2026). Lo
 *  usano la scheda Notifiche (destinatari di progetto) e la scheda Allarmi
 *  (destinatari propri e dell'escalation): una forma sola, invece di due campi
 *  di testo separati da virgole. */
export function DestinatariEmail({ value, onChange, compatto = false }: {
  value: (Destinatario | string)[] | undefined;
  onChange: (v: Destinatario[] | undefined) => void;
  compatto?: boolean;
}) {
  const { t } = useTranslation();
  const lingue = useAppStore((s) => s.project?.languages?.langs ?? []);
  // Un progetto letto prima della migrazione può ancora avere stringhe.
  const righe: Destinatario[] = (value ?? []).map((d) => (typeof d === "string" ? { indirizzo: d } : d));
  const scrivi = (nuove: Destinatario[]) => onChange(nuove.length ? nuove : undefined);
  const fs = compatto ? 11 : 12;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {righe.map((d, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            style={{ ...S.inputSm, flex: 1, fontSize: fs }}
            type="email"
            placeholder="nome@esempio.it"
            value={d.indirizzo}
            onChange={(e) => scrivi(righe.map((r, j) => (j === i ? { ...r, indirizzo: e.target.value } : r)))}
          />
          <select
            style={{ ...S.inputSm, width: compatto ? 64 : 110, fontSize: fs }}
            title={t("destinatari.linguaTitolo")}
            value={d.lingua ?? ""}
            onChange={(e) => scrivi(righe.map((r, j) => (j === i ? { ...r, lingua: e.target.value || undefined } : r)))}
          >
            <option value="">{t("destinatari.linguaCanale")}</option>
            {lingue.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button type="button" style={{ fontSize: fs }} title={t("destinatari.togli")}
            onClick={() => scrivi(righe.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" style={{ fontSize: fs, alignSelf: "flex-start" }}
        onClick={() => scrivi([...righe, { indirizzo: "" }])}>
        + {t("destinatari.aggiungi")}
      </button>
    </div>
  );
}

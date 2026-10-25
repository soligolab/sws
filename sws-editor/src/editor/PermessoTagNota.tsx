/** Nel pannello proprietà, sezione Sicurezza: cosa chiede il **tag** che
 *  l'oggetto scrive (25-10-2026, piano 2026-10-25-scrittura-senza-login).
 *
 *  In sola lettura — «una sezione per dato»: la soglia del tag si cambia in
 *  Configurazione → Tag, non da qui. Valgono tutti e due, tag e oggetto, e vince
 *  il più severo; questa riga serve a non scoprirlo davanti al pannello. */
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { sogliaScritturaTag, tagScrittiDa } from "@/auth/permessoScrittura";
import type { SynopticObject } from "@/types";

export function PermessoTagNota({ obj, progettoHaUtenti }: { obj: SynopticObject; progettoHaUtenti: boolean | null }) {
  const { t } = useTranslation();
  const tags = useAppStore((s) => s.project?.tags);
  // Senza utenti chiunque è Admin: non c'è niente da dire.
  if (progettoHaUtenti !== true) return null;
  const scritti = tagScrittiDa(obj);
  if (!scritti.length) return null;
  const nome = (r: string) => (r === "Viewer" ? t("cfg.tagWriteAnyone") : r);
  return (
    <div style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", margin: "2px 0 6px", lineHeight: 1.4 }}>
      {scritti.map((tag) => {
        const soglia = sogliaScritturaTag(tags, tag);
        return (
          <p key={tag} style={{ margin: "0 0 2px" }}>
            {t("props.permessoTag", { tag, ruolo: nome(soglia) })}
            {soglia === "Viewer" && obj.min_role && (
              <span style={{ color: "var(--brand-warning-soft, #fbbf24)" }}> {t("props.permessoTagAperto")}</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

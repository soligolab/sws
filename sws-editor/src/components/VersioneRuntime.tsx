import { useTranslation } from "react-i18next";
import { usaVersioneRuntime } from "@/versioneRuntime";

/** La versione del runtime in uso, scritta piccola accanto al marchio.
 *
 *  Richiesta del maintainer, 28-10-2026. Sta **dopo il login** e non prima:
 *  vedi `versioneRuntime.ts` per il perché.
 *
 *  Non è un pulsante e non apre niente: è un dato che serve quando si scrive
 *  «ho la 2.23.5» in una segnalazione, e il resto del tempo deve stare zitto.
 *  Per questo è piccolo, spento, e sparisce se il runtime non risponde —
 *  meglio niente che una versione falsa. */
export function VersioneRuntime() {
  const { t } = useTranslation();
  const versione = usaVersioneRuntime();
  if (!versione) return null;
  return (
    <span
      data-testid="versione-runtime"
      title={t("header.versioneRuntimeTitle", { versione })}
      style={{
        fontSize: 11,
        color: "var(--brand-text-subtle, #64748b)",
        whiteSpace: "nowrap",
        userSelect: "text",
      }}
    >
      {versione}
    </span>
  );
}

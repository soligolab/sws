import { useTranslation } from "react-i18next";
import { CampoPassword } from "@/components/CampoPassword";
import { CampoNumero } from "@/components/CampoNumero";
import { campo, riga, titoletto } from "@/ui/base";

/** I campi di una posta SMTP come li scrive chi li compila: la porta è testo,
 *  perché vuota vuol dire «quella predefinita». */
export type ValoreSmtp = {
  host: string;
  port: string;
  from: string;
  username: string;
  password: string;
  starttls: boolean;
};

/**
 * I campi di una posta SMTP, condivisi fra la posta dell'**installazione**
 * (`Posta.tsx`) e quella dell'**azienda** (`Aziende.tsx`, 10-11-2026).
 *
 * Solo i campi: caricare, salvare e provare restano di chi li usa. La posta
 * dell'azienda si scrive col «Salva» unico della scheda dell'azienda, e un
 * secondo Salva qui dentro sarebbe un secondo posto che scrive lo stesso dato.
 *
 * La password arriva mascherata dal server: rimandare il segnaposto vuol dire
 * «tieni quella di prima».
 */
export function CampiSmtp({
  valore,
  onChange,
  disabled = false,
  segnapostoMittente,
}: {
  valore: ValoreSmtp;
  onChange: (v: ValoreSmtp) => void;
  disabled?: boolean;
  segnapostoMittente?: string;
}) {
  const { t } = useTranslation();
  const cambia = (parte: Partial<ValoreSmtp>) => onChange({ ...valore, ...parte });
  return (
    <>
      <Campo etichetta={t("console.posta.host")}>
        <input data-testid="smtp-host" value={valore.host} disabled={disabled} onChange={(e) => cambia({ host: e.target.value })} style={campo} />
      </Campo>
      <Campo etichetta={t("console.posta.porta")}>
        <CampoNumero value={valore.port} disabled={disabled} onTesto={(e) => cambia({ port: e })} placeholder="587" style={campo} />
      </Campo>
      <Campo etichetta={t("console.posta.mittente")}>
        <input data-testid="smtp-da" value={valore.from} disabled={disabled} onChange={(e) => cambia({ from: e.target.value })} placeholder={segnapostoMittente} style={campo} />
      </Campo>
      <Campo etichetta={t("console.posta.utente")}>
        <input value={valore.username} disabled={disabled} onChange={(e) => cambia({ username: e.target.value })} autoComplete="off" style={campo} />
      </Campo>
      <Campo etichetta={t("console.posta.password")}>
        <CampoPassword value={valore.password} disabled={disabled} onChange={(e) => cambia({ password: e.target.value })} autoComplete="new-password" style={campo} />
      </Campo>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={valore.starttls} disabled={disabled} onChange={(e) => cambia({ starttls: e.target.checked })} />
        {t("console.posta.starttls")}
      </label>
    </>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div style={riga}>
      <label style={titoletto}>{etichetta}</label>
      {children}
    </div>
  );
}

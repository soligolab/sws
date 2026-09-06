import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { AvvisoRuntime } from "@/api/client";
import { HDR_BTN, DROP_PANEL, useOutsideClose } from "@/components/headerStyles";
import { canConfigureProject } from "@/auth/permissions";
import { useAppStore } from "@/store";

/**
 * Runtime state in the header: acquisition dot + Start/Stop, plus the
 * "project saved by an older version" migration prompt.
 *
 * Reboot deliberately lives in the ☰ menu instead: it is rare and disruptive,
 * and it does not belong next to a control used several times per session.
 *
 * # Il marcatore «impianto», e perché sta fuori dal gate di ruolo
 *
 * Quando l'istanza che serve questa SPA ha un viewer operatori (`mode ===
 * "runtime"`, cioè l'IDE sulla porta admin di un dispositivo) il progetto che si
 * sta modificando è quello dell'impianto in servizio, e il Salva ne ricarica
 * sorgenti e allarmi senza riavvio. Prima niente nella UI distingueva questo
 * caso dal modificare una copia locale.
 *
 * Il resto del componente è riservato a chi può configurare, ma il marcatore
 * no: **salvare un sinottico è tier Supervisor** (`PUT /api/synoptics/:name`),
 * quindi un Supervisor può scrivere sull'impianto senza poter configurare — ed è
 * esattamente la persona che l'avviso deve raggiungere. Un avviso che non
 * compare a chi compie l'azione non serve a niente.
 */
export function RuntimeCtrl() {
  const { t } = useTranslation();
  const authRole              = useAppStore((s) => s.authRole);
  const [running, setRunning] = useState<boolean | null>(null);
  // `null` = non ancora saputo. Un runtime anteriore a Q33 non manda
  // `auth_required`, e in quel caso si tiene il comportamento di prima (solo
  // chi può configurare) invece di aprire un controllo per una supposizione.
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [avvisi, setAvvisi] = useState<AvvisoRuntime[]>([]);
  const [avvisiAperti, setAvvisiAperti] = useState(false);
  const boxAvvisi = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy]       = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [savedBy, setSavedBy] = useState<string | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string>("");
  const [migrating, setMigrating] = useState(false);
  const [serveImpianto, setServeImpianto] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await api.getSystemStatus();
        if (alive) {
          // Q33: `armed` è l'intenzione dell'operatore, `sources_running` è un
          // effetto — un progetto senza sorgenti lo mette a false pur girando.
          // Si guarda il primo, e si ripiega sul secondo solo con un runtime
          // che non lo manda.
          setRunning(s.armed ?? s.sources_running);
          setAuthRequired(s.auth_required ?? null);
          setAvvisi(s.avvisi ?? []);
          setNeedsUpdate(s.project_needs_update);
          setSavedBy(s.project_saved_by);
          setRuntimeVersion(s.runtime_version);
          // `mode` è assente su un runtime più vecchio: in quel caso non si
          // afferma niente, invece di indovinare.
          setServeImpianto(s.mode === "runtime");
        }
      } catch { /* ignore — runtime may be restarting */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useOutsideClose(boxAvvisi, avvisiAperti, () => setAvvisiAperti(false));

  // Il marcatore da solo, per chi non può configurare ma può salvare.
  const marcatore = serveImpianto ? (
    <span
      title={t("header.plantWarnTitle")}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
        whiteSpace: "nowrap",
        color: "var(--brand-warning-soft, #facc15)",
        background: "var(--brand-warning-bg, #78350f)",
        border: "1px solid var(--brand-warning, #f59e0b)",
      }}
    >
      {t("header.plantBadge")}
    </span>
  ) : null;

  // # Gli avvisi stanno FUORI dal gate di ruolo, come il marcatore
  //
  // Dicono che il runtime non sta facendo quello che si crede — uno script che
  // non partirà mai, l'acquisizione ferma — e chi non può configurare può
  // comunque salvare un sinottico su quell'impianto. Un avviso che non arriva a
  // chi compie l'azione non serve a niente, ed è la stessa ragione scritta
  // sopra per il marcatore «impianto».
  const errori = avvisi.filter((a) => a.gravita === "errore").length;
  const pannelloAvvisi = avvisi.length > 0 && (
    <div ref={boxAvvisi} style={{ position: "relative" }}>
      <button
        onClick={() => setAvvisiAperti((v) => !v)}
        title={t("header.avvisiTitle")}
        style={{
          ...HDR_BTN,
          background: errori > 0 ? "var(--brand-danger, #dc2626)" : "var(--brand-warning-bg, #78350f)",
          border: `1px solid ${errori > 0 ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #f59e0b)"}`,
          color: errori > 0 ? "var(--brand-on-danger, #fff)" : "var(--brand-warning-soft, #facc15)",
          fontWeight: 600,
        }}
      >
        {errori > 0 ? "\u26a0" : "\u26a1"} {avvisi.length}
      </button>
      {avvisiAperti && (
        <div style={{ ...DROP_PANEL, minWidth: 340, maxWidth: 460, padding: "6px 0" }}>
          {avvisi.map((a, i) => (
            <div
              key={`${a.dove}-${i}`}
              style={{
                padding: "8px 14px",
                borderTop: i === 0 ? "none" : "1px solid var(--brand-surface-2, #334155)",
              }}
            >
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 3,
                color: a.gravita === "errore" ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #f59e0b)",
              }}>
                {a.dove}
              </div>
              <div style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)", lineHeight: 1.45 }}>
                {a.messaggio}
              </div>
              {/* Il rimedio in grigio e sotto: chi legge vuole prima sapere
                  cosa non va, poi cosa fare. */}
              <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", marginTop: 3, lineHeight: 1.45 }}>
                {a.rimedio}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // # Perché non basta il ruolo
  //
  // In no-auth — nessun utente definito, che è lo stato normale in locale e su
  // un dispositivo appena installato — il runtime apre **tutte** le rotte e
  // `authRole` resta `null`. Con il solo `canConfigureProject` questo
  // componente non si disegnava affatto: niente pallino, niente Stop, niente
  // Avvia, per un permesso che nessuno stava chiedendo. Chi lavorava in locale
  // non aveva modo di fermare l'acquisizione dall'IDE.
  //
  // `authRequired === false` è un **fatto riportato dal server**, non una
  // deduzione dall'assenza di token: un runtime che pretende il login e da cui
  // si è scollegati continua a nascondere i comandi, com'è giusto.
  const puoComandare = canConfigureProject(authRole) || authRequired === false;
  if (!puoComandare) {
    return (marcatore || pannelloAvvisi) ? (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {marcatore}
        {pannelloAvvisi}
      </div>
    ) : null;
  }

  const handleMigrate = async () => {
    if (!confirm(t("header.migrateConfirm", { savedBy: savedBy ?? t("header.unknownVersion"), runtime: runtimeVersion }))) return;
    setMigrating(true);
    try {
      await api.migrateProject();
      setNeedsUpdate(false);
    } catch { /* ignore — banner stays until next poll */ }
    finally { setMigrating(false); }
  };

  // Si comanda lo stato che si vuole, non l'opposto di quello che c'è: `vai` è
  // `true` per RUN e `false` per STOP.
  const comanda = async (vai: boolean) => {
    if (busy || running === vai) return;
    setBusy(true);
    try {
      if (vai) await api.systemStart();
      else     await api.systemStop();
      const s = await api.getSystemStatus();
      setRunning(s.armed ?? s.sources_running);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  // # Perché due pulsanti e non un interruttore
  //
  // Un solo pulsante che porta l'azione («Stop» quando gira) mostra ciò che
  // **farà**, non ciò che **è**, e per leggere lo stato serviva il pallino da 8
  // px accanto: due elementi per un dato solo, e il dato scritto nel più
  // piccolo dei due. Un solo pulsante che porta lo stato («RUN» quando gira) è
  // peggio ancora su un impianto: chi lo preme non sa se sta confermando o
  // invertendo.
  //
  // Due pulsanti con l'attivo evidenziato dicono lo stato **e** rendono
  // l'azione esplicita — si preme RUN per far girare, STOP per fermare, e
  // premere quello già attivo non fa niente. È anche l'idioma che la barra usa
  // già due centimetri più a sinistra per Editor/Configurazione, quindi non
  // introduce un modo nuovo di dire una cosa vecchia.
  const statoNoto = running !== null;
  const titolo = !statoNoto
    ? t("header.acqUnknown")
    : running ? t("header.acqRunning") : t("header.acqStopped");

  /** Un segmento RUN/STOP. `suColore` è il testo da usare **sopra** `colore`
   *  quando il segmento è attivo: bianco fisso non va bene su tutte le tinte —
   *  su `#22c55e` (il verde del tema scuro) dava 2,28:1, cioè sotto la soglia
   *  di leggibilità proprio sul pulsante che dice se l'impianto sta girando.
   *  I token `--brand-on-*` li calcola `readableOn` sul colore vero, quindi
   *  restano giusti anche se il brand cambia le tinte. */
  const seg = (attivo: boolean, colore: string, suColore: string): React.CSSProperties => ({
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: attivo ? 700 : 400,
    border: "1px solid var(--brand-border, #475569)",
    background: attivo ? colore : "var(--brand-surface-2, #334155)",
    color: attivo ? suColore : "var(--brand-text-2, #cbd5e1)",
    cursor: busy || !statoNoto ? "default" : "pointer",
    opacity: busy || !statoNoto ? 0.6 : 1,
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {marcatore}
      {pannelloAvvisi}
      {needsUpdate && (
        <button
          style={{ ...HDR_BTN, background: "var(--brand-warning-bg, #78350f)", border: "1px solid var(--brand-warning, #f59e0b)", color: "var(--brand-warning-soft, #facc15)", opacity: migrating ? 0.6 : 1 }}
          disabled={migrating}
          onClick={handleMigrate}
          title={t("header.updateProjectTitle", { savedBy: savedBy ?? t("header.unknownVersion"), runtime: runtimeVersion })}
        >
          {migrating ? t("header.updating") : t("header.updateProjectBtn")}
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center" }} title={titolo}>
        <button
          style={{ ...seg(running === true, "var(--brand-success, #16a34a)", "var(--brand-on-success, #052e16)"),
                   borderRadius: "4px 0 0 4px", borderRight: "none" }}
          disabled={busy || !statoNoto}
          onClick={() => comanda(true)}
          title={t("header.startTitle")}
        >
          {busy && running === false ? "…" : t("header.acqRunLabel")}
        </button>
        <button
          style={{ ...seg(running === false, "var(--brand-danger, #dc2626)", "var(--brand-on-danger, #fff)"),
                   borderRadius: "0 4px 4px 0" }}
          disabled={busy || !statoNoto}
          onClick={() => comanda(false)}
          title={t("header.stopTitle")}
        >
          {busy && running === true ? "…" : t("header.acqStopLabel")}
        </button>
      </div>
    </div>
  );
}

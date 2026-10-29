import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { IconaUI } from "@/ui/IconaUI";
import { AnteprimaProgetto } from "@/components/benvenuto/AnteprimaProgetto";
import { MARGINE_PAGINA_BENVENUTO, campoAmpio, pulsantePrimario, pulsanteSecondario, schedaCliccabile } from "@/ui/base";
import { VersioneRuntime } from "@/components/VersioneRuntime";
import { NewProjectModal, type NewProjectTab } from "@/components/benvenuto/NuovoProgetto";
import { InstallaRuntimeModal } from "@/components/benvenuto/InstallaRuntime";
import { api, dimenticaVersioneProgetto } from "@/api/client";
import type { ProjectListEntry } from "@/types";
import { BarraIdentita } from "@/components/BarraIdentita";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";

// ── styles ────────────────────────────────────────────────────────────────────
//
// Le costanti locali di prima stanno in `ui/base.ts` dal 28-10-2026: questo file
// si spezza in cinque, e ognuno dei pezzi le usa. I nomi corti restano come
// alias perché le righe che li usano sono centinaia, e cambiarle tutte in un
// commit che sposta file renderebbe illeggibile proprio lo spostamento.
const CARD = schedaCliccabile;
const BTN_PRIMARY = pulsantePrimario;
const BTN_GHOST = pulsanteSecondario;
const INPUT = campoAmpio;

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Il modale «Nuovo progetto», il navigatore di cartelle e l'installazione di
// un runtime vivono in `components/benvenuto/` dal 28-10-2026.
// ── WelcomeScreen ─────────────────────────────────────────────────────────────

interface WelcomeScreenProps {
  /** Called once a project has been opened and the user must log in. */
  onProjectOpened: () => void;
}

/** `rif` e l'indirizzo (`<azienda>/<nome>`), `name` serve solo a mostrarlo e
 *  a precompilare il campo: due aziende possono avere lo stesso nome, quindi
 *  la riga in lavorazione si identifica col riferimento. */
type EditingState = { rif: string; name: string; mode: "rename" | "duplicate"; value: string };

/** I byte in GB, come li legge una persona. */
function gb(n: number): string {
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

/** Dove il browser ricorda se l'elenco era a griglia o a lista. */
const VISTA_SALVATA = "sws.welcome.vista";

export type Gruppo = { titolo?: string; altra: boolean; elenco: ProjectListEntry[] };

/** Il titolo di un gruppo: «WEB · 1024×600», «LVGL», oppure niente. */
export function titoloGruppo(p: ProjectListEntry): string | undefined {
  const motore = p.motore ? p.motore.toUpperCase() : undefined;
  const pezzi = [motore, p.risoluzione || undefined].filter(Boolean);
  return pezzi.length ? pezzi.join(" · ") : undefined;
}

/**
 * Raggruppa i progetti per **tecnologia e risoluzione** (maintainer,
 * 12-10-2026): un progetto LVGL e uno web si somigliano nell'elenco e si
 * scoprono diversi solo dopo averli aperti.
 *
 * **Lo stacco delle aziende altrui resta**, e sta fuori dal raggruppamento.
 * Quello non e' un modo di ordinare: e' la riga che dice «da qui in giu' non e'
 * tuo» a chi amministra la piattaforma (scelta del maintainer, 07-10-2026).
 * Mescolare i progetti di un altro cliente fra i propri perche' hanno la stessa
 * risoluzione sarebbe proprio il guasto che quella riga evita.
 *
 * L'azienda, che prima era il titolo del gruppo, ora sta su ogni scheda: senza,
 * cambiando il criterio si sarebbe persa un'informazione invece di
 * aggiungerne due.
 *
 * Un progetto di cui non si sa niente (runtime piu' vecchio, `project.yaml`
 * illeggibile) finisce in un gruppo senza titolo, che va **in fondo**: e' il
 * posto giusto per «non classificato», e tiene la schermata identica a prima
 * su un'installazione che quei campi non li manda.
 */
export function raggruppa(progetti: ProjectListEntry[]): Gruppo[] {
  const gruppi = new Map<string, Gruppo>();
  for (const p of progetti) {
    const altra = p.altra_azienda === true;
    const titolo = titoloGruppo(p);
    const k = `${altra ? "1" : "0"}\u0000${titolo ?? ""}`;
    const g = gruppi.get(k);
    if (g) g.elenco.push(p);
    else gruppi.set(k, { titolo, altra, elenco: [p] });
  }
  return [...gruppi.values()].sort((a, b) => {
    if (a.altra !== b.altra) return a.altra ? 1 : -1;
    // Senza titolo in fondo: «non si sa» non e' una categoria da leggere per
    // prima.
    if (a.titolo === undefined) return 1;
    if (b.titolo === undefined) return -1;
    return a.titolo.localeCompare(b.titolo);
  });
}

export function WelcomeScreen({ onProjectOpened }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [projects, setProjects]   = useState<ProjectListEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [openingName, setOpening] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [newTab, setNewTab]       = useState<NewProjectTab>("empty");
  const [showInstalla, setShowInstalla] = useState(false);
  const [editing, setEditing]     = useState<EditingState | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Il cambio password volontario, chiesto dal menu della barra. Riusa la
  // schermata del cambio OBBLIGATO invece di una seconda copia del modulo:
  // due punti che scrivono la stessa password sono due punti che divergono.
  const [cambioPassword, setCambioPassword] = useState(false);
  // L'avviso di spazio, in cima all'elenco (decisione del maintainer,
  // 08-10-2026: avvisa prima, rifiuta al limite). Qui, perche e la schermata
  // da cui si crea un progetto — cioe il gesto che verrebbe rifiutato.
  const [spazio, setSpazio] = useState<
    { nome: string | null; usato_byte: number; max_byte: number; vicina: boolean; piena: boolean }[]
  >([]);
  useEffect(() => {
    api.spazioMio().then(setSpazio).catch(() => setSpazio([]));
  }, []);
  // Griglia o lista. La griglia e la predefinita (richiesta del maintainer del
  // 07-10-2026: «l'elenco dei progetti potrebbe essere fatto ad icone stile
  // file browser?»), la lista resta perche con i percorsi lunghi e piu
  // leggibile. La scelta e una comodita del singolo browser, non un dato: vive
  // in `localStorage`, e se `localStorage` non c'e si riparte dalla griglia.
  const [vista, setVista] = useState<"griglia" | "lista">(() => {
    try {
      return localStorage.getItem(VISTA_SALVATA) === "lista" ? "lista" : "griglia";
    } catch {
      return "griglia";
    }
  });
  const [sorvolato, setSorvolato] = useState<string | null>(null);
  const cambiaVista = (v: "griglia" | "lista") => {
    setVista(v);
    try { localStorage.setItem(VISTA_SALVATA, v); } catch { /* finestra privata */ }
  };

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch (e: any) {
      setError(e?.message ?? t("welcome.loadListError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  // Nel cloud ogni progetto ha il suo container: aprirlo vuol dire **andarci**,
  // non cambiare il progetto attivo di questo processo — che nel gateway non
  // esiste nemmeno, perché il gateway non apre progetti, li smista.
  const [gateway, setGateway] = useState(false);
  useEffect(() => {
    let vivo = true;
    api.identitaStato()
      .then((st) => { if (vivo) setGateway(!!st.gateway); })
      .catch(() => { /* runtime vecchio: si continua col modello a istanza singola */ });
    return () => { vivo = false; };
  }, []);

  // Si apre per **riferimento**: `nome` resta solo per i messaggi.
  const handleOpen = async (rif: string, nome: string) => {
    setOpening(rif); setError(null);
    const name = nome;
    if (gateway) {
      // Con la barra finale: è la radice del progetto, e tutto quello che la
      // pagina costruisce da `location.pathname` (il watcher della build, le
      // chiamate con prefisso) deve partire da dentro, non dal livello sopra.
      window.location.assign(`/p/${rif}/`);
      return;
    }
    try {
      await api.openProject(rif);
      // Q30: la versione vista è quella del progetto di **prima**. Tenerla
      // farebbe rifiutare il primo salvataggio su quello nuovo con un 409 che
      // non ha nessuna corsa dietro — un conflitto inventato insegna a
      // ignorare i conflitti veri.
      dimenticaVersioneProgetto();
      onProjectOpened();
    } catch (e: any) {
      setError(t("welcome.errOpen", { name, err: e?.message ?? e }));
    } finally {
      setOpening(null);
    }
  };

  const handleCreated = async (rif: string, nome: string) => {
    setShowNew(false);
    await loadProjects();
    await handleOpen(rif, nome);
  };

  const handleDelete = async (p: ProjectListEntry) => {
    const confirmMsg = p.external
      ? t("welcome.confirmRemoveExternal", { name: p.name })
      : t("welcome.confirmDelete", { name: p.name });
    if (!window.confirm(confirmMsg)) return;
    setActionBusy(p.riferimento); setError(null);
    try {
      await api.deleteProject(p.riferimento);
      await loadProjects();
    } catch (e: any) {
      setError(t(p.external ? "welcome.errRemove" : "welcome.errDelete", { name: p.name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  // L'archivio (18-10-2026): il progetto resta al suo posto, nascosto e non
  // apribile, e continua a contare nella quota di spazio.
  const [archiviAperti, setArchiviAperti] = useState(false);
  const archiviati = projects.filter((p) => p.archiviato);
  const handleArchivia = async (p: ProjectListEntry, archivia: boolean) => {
    if (archivia && !window.confirm(t("welcome.confermaArchivia", { name: p.name }))) return;
    setActionBusy(p.riferimento); setError(null);
    try {
      await (archivia ? api.archiveProject(p.riferimento) : api.unarchiveProject(p.riferimento));
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errArchivia", { name: p.name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  const commitRename = async () => {
    if (!editing || editing.mode !== "rename") return;
    const { rif, name, value } = editing;
    const newName = value.trim();
    if (!newName || newName === name) { setEditing(null); return; }
    setActionBusy(rif); setEditing(null); setError(null);
    try {
      await api.renameProject(rif, newName);
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errRename", { name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  const commitDuplicate = async () => {
    if (!editing || editing.mode !== "duplicate") return;
    const { rif, name, value } = editing;
    const newName = value.trim();
    if (!newName) { setEditing(null); return; }
    setActionBusy(rif); setEditing(null); setError(null);
    try {
      await api.duplicateProject(rif, newName);
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errDuplicate", { name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  // Il cambio password volontario prende tutta la schermata, come quello
  // obbligato: e lo stesso modulo, e mostrarlo in due vesti diverse a seconda
  // di come ci si arriva sarebbe la stessa cosa detta due volte.
  if (cambioPassword) {
    return <ChangePasswordScreen onAnnulla={() => setCambioPassword(false)} />;
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      // `minHeight` e non `height`, `overflowY` e il centraggio affidato al
      // `margin: auto` del figlio invece che a `justify-content: center`.
      //
      // Prima era `height: 100vh` + `justifyContent: center` senza overflow:
      // con pochi progetti si vedeva bene, con qualche decina il contenuto
      // sforava e il centraggio lo spingeva fuori da TUTTI E DUE i lati —
      // quindi i primi progetti diventavano irraggiungibili e non c'era
      // barra di scorrimento. Alzare il solo `overflow` non basta: con
      // `justify-content: center` la parte sopra resta inarrivabile anche in
      // un contenitore scorrevole, mentre un `margin: auto` cede quando lo
      // spazio finisce. Segnalato dal maintainer il 06-10-2026.
      // `height` e non `minHeight`: il documento NON scorre — `index-admin.html`
      // mette `overflow: hidden` su html e body di proposito, perche «viewer e
      // IDE gestiscono lo scorrimento nei propri contenitori». Con `minHeight`
      // questo div cresceva oltre la finestra e il corpo lo tagliava: nessuna
      // barra, contenuto perduto. Primo tentativo del 06-10-2026, sbagliato.
      height: "100vh", overflowY: "auto", padding: `${MARGINE_PAGINA_BENVENUTO}px 0`, boxSizing: "border-box",
      background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
      fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
    }}>
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreated}
          initialTab={newTab}
        />
      )}
      {showInstalla && <InstallaRuntimeModal gateway={gateway} onClose={() => setShowInstalla(false)} />}

      <BarraIdentita onCambiaPassword={() => setCambioPassword(true)} />

      {/* Solo chi e vicino o oltre: un avviso che c'e sempre non e un
          avviso. */}
      {spazio.filter((a) => a.vicina).map((a) => (
        <div
          key={a.nome ?? ""}
          style={{
            alignSelf: "stretch", margin: "0 0 18px", padding: "10px 20px",
            fontSize: 13, lineHeight: 1.5,
            color: a.piena ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-warning-soft, #fbbf24)",
            background: a.piena ? "#7f1d1d33" : "#78350f33",
            borderBottom: "1px solid var(--brand-surface-2, #334155)",
          }}
        >
          <IconaUI nome={a.piena ? "chiudi" : "avviso"} px={14} />{" "}
          {t(a.piena ? "welcome.spazioEsaurito" : "welcome.spazioQuasiEsaurito", {
            azienda: a.nome ?? t("welcome.aziendaQuestaInstallazione"),
            usato: gb(a.usato_byte),
            massimo: gb(a.max_byte),
          })}
        </div>
      ))}

      {/* La griglia vuole spazio: con 480px starebbero tre piastrelle per
          riga e il resto della finestra resterebbe vuoto. La lista no — i
          percorsi lunghi si leggono meglio in una colonna stretta. */}
      {/* Larghezza **massima**, non fissa (28-10-2026): con `width` secca la
          colonna restava larga anche quando la finestra no, e il `92vw`
          serviva a tamponarlo. Con `maxWidth` la colonna si stringe da sola e
          la griglia qui sotto rifluisce. */}
      <div style={{ width: "100%", maxWidth: vista === "griglia" ? 1080 : 480, margin: "auto", padding: "0 16px", boxSizing: "border-box" }}>
        {/* Il marchio, non la stringa «SWS» cablata (28-10-2026). Prima
            dell'accesso vale `active.json`; dopo, `useMarchioDellAzienda()` ha
            già rimesso quello dell'azienda — cioè il marchio per azienda
            funziona qui senza una riga di backend.
            Sotto, la versione del runtime: questo è il primo posto in cui si
            arriva dopo il login, ed è qui che «quale versione sto usando»
            viene in mente. */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 40 }}>
            <BrandLogo />
          </div>
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 14, marginTop: 4 }}>
            {t("welcome.selectOrCreate")}
          </div>
          <div style={{ marginTop: 6 }}>
            <VersioneRuntime />
          </div>
        </div>

        {/* Griglia o lista. Due icone e basta: e una comodita, non
            un'impostazione, e non merita ne una pagina ne un menu. */}
        {!loading && projects.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 10 }}>
            {(["griglia", "lista"] as const).map((quale) => (
              <button
                key={quale}
                onClick={() => cambiaVista(quale)}
                title={t(quale === "griglia" ? "welcome.vistaGriglia" : "welcome.vistaLista")}
                aria-pressed={vista === quale}
                style={{
                  background: vista === quale ? "var(--brand-surface-2, #334155)" : "transparent",
                  color: vista === quale ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #64748b)",
                  border: "1px solid var(--brand-surface-2, #334155)",
                  borderRadius: 4, padding: "3px 9px", cursor: "pointer", fontSize: 13, lineHeight: 1.4,
                }}
              >
                <IconaUI nome={quale === "griglia" ? "griglia" : "lista"} px={15}
                  titolo={t(quale === "griglia" ? "welcome.vistaGriglia" : "welcome.vistaLista")} />
              </button>
            ))}
          </div>
        )}

        {/* project list */}
        <div style={{ marginBottom: 16 }}>
          {loading && (
            <div style={{ textAlign: "center", color: "var(--brand-text-subtle, #64748b)", padding: 24 }}>{t("welcome.loading")}</div>
          )}
          {!loading && projects.length === 0 && (
            <div style={{
              textAlign: "center", color: "var(--brand-text-subtle, #64748b)", padding: 32,
              border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 8,
            }}>
              {t("welcome.noProjects")}
            </div>
          )}
          {/* Raggruppati per azienda (scelta del maintainer, 07-10-2026).
              I progetti senza azienda — quella implicita — vengono per primi e
              SENZA titolo: chi ha un'installazione sola non deve incontrare un
              concetto che per lui non esiste. Il titolo compare solo dove c'e
              davvero un'azienda da nominare. */}
          {!loading && raggruppa(projects.filter((p) => !p.archiviato)).map((g, i, tutti) => (
            <div key={`${g.altra ? "1" : "0"}-${g.titolo ?? ""}`}>
              {/* Lo stacco prima della PRIMA azienda altrui: tutto quello che
                  sta sotto non e tuo, e va detto una volta sola invece che
                  ripetuto su ogni riga (scelta del maintainer, 07-10-2026). */}
              {g.altra && !tutti[i - 1]?.altra && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  margin: "26px 0 2px", paddingTop: 14,
                  borderTop: "1px solid var(--brand-surface-2, #334155)",
                  fontSize: 11, letterSpacing: 0.4,
                  color: "var(--brand-text-subtle, #64748b)",
                }}>
                  <IconaUI nome="bandiera" px={13} />
                  <span>{t("welcome.altreAziende")}</span>
                </div>
              )}
              <div style={{
                fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                color: "var(--brand-text-subtle, #64748b)",
                margin: "18px 0 6px", paddingLeft: 2,
              }}>
                {g.titolo ?? t("welcome.senzaFormato")}
              </div>
              {/* Griglia vera invece di `flex-wrap` (28-10-2026). Con il
                  wrap le piastrelle avevano una larghezza fissa di 158 px, e
                  da quella nascevano **due** difetti insieme: i nomi lunghi
                  tagliati con i puntini, e una fila che sotto i 360 px di
                  finestra sforava. `auto-fill` + `minmax` li risolve tutti e
                  due — è la forma già usata in `EditorShell` e nel catalogo
                  dispositivi. */}
              <div style={vista === "griglia"
                ? {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                    gap: 12,
                    marginTop: 4,
                  }
                : {}}
              >
              {g.elenco.map((p) => {
            const isOpening  = openingName === p.riferimento;
            const isBusy     = actionBusy  === p.riferimento;
            const isEditing  = editing?.rif === p.riferimento;
            const isRenaming = isEditing && editing?.mode === "rename";
            const isDuping   = isEditing && editing?.mode === "duplicate";
            const dimmed     = (openingName || actionBusy) && !isOpening && !isBusy;

            const ACT_BTN: React.CSSProperties = {
              background: "none", border: "none", cursor: "pointer",
              color: "var(--brand-text-muted, #94a3b8)", fontSize: 15, padding: "2px 5px",
              borderRadius: 4, lineHeight: 1,
            };

            // ── I pezzi interattivi, definiti UNA volta ──────────────────
            //
            // Griglia e lista sono due disposizioni della stessa cosa, non due
            // schermate: se la rinomina esistesse in due copie di JSX, alla
            // prima correzione ne resterebbe corretta una sola. Qui si
            // definiscono i pezzi, sotto si compongono.
            const campoNome = (
              <input
                autoFocus
                style={{ ...INPUT, padding: "3px 8px", fontSize: 14, width: "100%" }}
                value={editing?.value ?? ""}
                onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
              />
            );

            const distintivoEsterno = p.external ? (
              <span style={{
                fontSize: 10, fontWeight: 500, color: "var(--brand-text-subtle, #64748b)",
                border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "1px 5px",
              }}>
                {t("welcome.externalBadge")}
              </span>
            ) : null;

            // L'azienda era il titolo del gruppo; adesso che i gruppi dicono
            // altro, sta qui — o cambiando criterio si sarebbe persa.
            const distintivoAzienda = p.azienda ? (
              <span style={{
                fontSize: 10, fontWeight: 500, color: "var(--brand-text-subtle, #64748b)",
                border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "1px 5px",
              }}>
                {p.azienda}
              </span>
            ) : null;

            const quando = p.last_opened_ms
              ? t("welcome.lastOpened", { date: formatDate(p.last_opened_ms) })
              : t("welcome.lastModified", { date: formatDate(p.last_modified_ms) });

            const azioni = (
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  title={t("editor.rename")}
                  style={{ ...ACT_BTN, color: isRenaming ? "var(--brand-primary, #3b82f6)" : "var(--brand-text-muted, #94a3b8)" }}
                  onClick={() => setEditing({ rif: p.riferimento, name: p.name, mode: "rename", value: p.name })}
                ><IconaUI nome="matita" titolo={t("editor.rename")} /></button>
                <button
                  title={t("editor.duplicate")}
                  style={{ ...ACT_BTN, color: isDuping ? "#a855f7" : "var(--brand-text-muted, #94a3b8)" }}
                  onClick={() => setEditing({ rif: p.riferimento, name: p.name, mode: "duplicate", value: `${p.name} ${t("common.copiaSuffisso")}` })}
                ><IconaUI nome="duplica" titolo={t("editor.duplicate")} /></button>
                {!p.external && (
                  <button
                    title={t("welcome.archivia")}
                    data-testid={`archive-${p.riferimento}`}
                    style={{ ...ACT_BTN }}
                    onClick={() => handleArchivia(p, true)}
                  ><IconaUI nome="archivio" titolo={t("welcome.archivia")} /></button>
                )}
                <button
                  title={p.external ? t("welcome.removeFromList") : t("editor.delete")}
                  style={{ ...ACT_BTN }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand-danger, #ef4444)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--brand-text-muted, #94a3b8)")}
                  onClick={() => handleDelete(p)}
                ><IconaUI nome="chiudi" titolo={t("editor.delete")} /></button>
              </div>
            );

            const pannelloDuplica = (
              <div
                style={{
                  display: "flex", gap: 8, alignItems: "center",
                  padding: "8px 12px", background: "var(--brand-surface, #1e293b)",
                  border: "1px solid #a855f7", borderTop: "none",
                  borderRadius: "0 0 8px 8px",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "nowrap" }}>{t("welcome.copyName")}</span>
                <input
                  autoFocus
                  style={{ ...INPUT, padding: "4px 8px", fontSize: 13, flex: 1, minWidth: 0 }}
                  value={editing?.value ?? ""}
                  onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  { e.preventDefault(); commitDuplicate(); }
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
                <button style={{ ...BTN_PRIMARY, padding: "4px 12px", fontSize: 13 }}
                  onClick={commitDuplicate} title={t("common.conferma")}><IconaUI nome="conferma" titolo={t("common.conferma")} /></button>
                <button style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 13 }}
                  onClick={() => setEditing(null)} title={t("common.annulla")}><IconaUI nome="chiudi" titolo={t("common.annulla")} /></button>
              </div>
            );

            const apriSePossibile = () => {
              if (!openingName && !actionBusy && !isEditing) handleOpen(p.riferimento, p.name);
            };

            // ── La piastrella ────────────────────────────────────────────
            if (vista === "griglia") {
              const mostraAzioni = sorvolato === p.name || isEditing;
              return (
                <div
                  key={p.name}
                  onMouseEnter={() => setSorvolato(p.name)}
                  onMouseLeave={() => setSorvolato((v) => (v === p.name ? null : v))}
                  onClick={apriSePossibile}
                  // Il **nome**, non il percorso: il percorso è già scritto
                  // sotto, e un suggerimento che ripete qualcosa di visibile
                  // sottrae il posto all'unica cosa che qui può non starci.
                  title={p.name}
                  role="button"
                  // Un appiglio stabile per i test e2e (28-10-2026). Fino a
                  // oggi cercavano un pulsante di nome «Apri» che non esiste
                  // più — è un `div`, e in vista griglia non c'è affatto — e
                  // il `.catch(() => false)` lo faceva fallire **in
                  // silenzio**: il test proseguiva come se la schermata non ci
                  // fosse. Un aiutante che non trova niente e non lo dice è
                  // peggio di un aiutante che non c'è.
                  data-testid="scheda-progetto"
                  style={{
                    position: "relative", minWidth: 0, boxSizing: "border-box",
                    padding: "14px 10px 12px", borderRadius: 8, textAlign: "center",
                    background: "var(--brand-surface, #1e293b)",
                    border: `1px solid ${isOpening ? "var(--brand-primary, #3b82f6)" : isBusy ? "var(--brand-warning, #f59e0b)" : "var(--brand-surface-2, #334155)"}`,
                    opacity: dimmed ? 0.45 : 1,
                    cursor: (openingName || actionBusy || isEditing) ? "default" : "pointer",
                  }}
                >
                  {/* Le azioni appaiono al passaggio del mouse. Restano visibili
                      mentre si rinomina o si duplica: sparire sotto il cursore
                      che le ha appena usate e il modo piu rapido di perdere il
                      filo di cosa si stava facendo. */}
                  <div style={{
                    position: "absolute", top: 4, right: 4,
                    opacity: mostraAzioni ? 1 : 0,
                    transition: "opacity .12s",
                    pointerEvents: mostraAzioni ? "auto" : "none",
                  }}>
                    {!isOpening && !isBusy && azioni}
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <AnteprimaProgetto riferimento={p.riferimento} ms={p.anteprima_ms} />
                  </div>

                  {isRenaming ? campoNome : (
                    <div style={{
                      fontWeight: 600, fontSize: 13, color: "var(--brand-text, #e2e8f0)",
                      // Due righe invece dei puntini a una riga: un nome di
                      // progetto lungo è la norma, non l'eccezione, e
                      // «CasaDomotica (WP6…» non distingue due varianti dello
                      // stesso impianto — che è esattamente quando serve.
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflowWrap: "anywhere",
                    }}>
                      {p.name}
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 3 }}>
                    {isOpening ? t("welcome.opening") : isBusy ? "…" : quando}
                  </div>

                  {(distintivoEsterno || distintivoAzienda) && (
                    <div style={{ marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {distintivoAzienda}{distintivoEsterno}
                    </div>
                  )}

                  {isDuping && <div style={{ marginTop: 8, textAlign: "left" }}>{pannelloDuplica}</div>}
                </div>
              );
            }

            return (
              <div key={p.name} style={{ marginBottom: 8 }}>
                {/* main card row */}
                <div
                  style={{
                    ...CARD,
                    opacity: dimmed ? 0.45 : 1,
                    borderColor: isOpening ? "var(--brand-primary, #3b82f6)" : isBusy ? "var(--brand-warning, #f59e0b)" : "var(--brand-surface-2, #334155)",
                    cursor: (openingName || actionBusy || isEditing) ? "default" : "pointer",
                  }}
                  onClick={apriSePossibile}
                  role="button"
                  title={p.name}
                  data-testid="scheda-progetto"
                >
                  {/* la miniatura della pagina iniziale, o l'icona */}
                  <AnteprimaProgetto riferimento={p.riferimento} ms={p.anteprima_ms} riga />

                  {/* name + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? campoNome : (
                      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--brand-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 6 }}>
                        {p.name}
                        {distintivoAzienda}
                        {distintivoEsterno}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>
                      {quando}
                    </div>
                    <div
                      style={{
                        fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 1,
                        fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                      title={p.path}
                    >
                      {p.path}
                    </div>
                  </div>

                  {/* action buttons */}
                  {!isOpening && !isBusy && azioni}

                  {/* status label */}
                  {isOpening && <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", flexShrink: 0 }}>{t("welcome.opening")}</div>}
                  {isBusy   && <div style={{ fontSize: 13, color: "var(--brand-warning, #f59e0b)", flexShrink: 0 }}>…</div>}
                  {!isOpening && !isBusy && (
                    <div style={{ fontSize: 13, color: "var(--brand-primary-testo, #3b82f6)", fontWeight: 500, flexShrink: 0, marginLeft: 4 }}>{t("welcome.open")}</div>
                  )}
                </div>

                {isDuping && pannelloDuplica}
              </div>
            );
          })}
              </div>
            </div>
          ))}
          {/* Gli archiviati: in fondo e chiusi, per riprenderli o cancellarli. */}
          {!loading && archiviati.length > 0 && (
            <div style={{ marginTop: 22, paddingTop: 12, borderTop: "1px solid var(--brand-surface-2, #334155)" }}>
              <button type="button" data-testid="archiviati-toggle" onClick={() => setArchiviAperti((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0,
                  color: "var(--brand-text-subtle, #64748b)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                {archiviAperti ? "▾" : "▸"} {t("welcome.archiviati", { n: archiviati.length })}
              </button>
              {archiviAperti && archiviati.map((p) => (
                <div key={p.riferimento} data-testid={`archiviato-${p.riferimento}`} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginTop: 6,
                  border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 8, opacity: 0.85,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{p.name}{p.azienda ? ` · ${p.azienda}` : ""}</div>
                    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
                      {t("welcome.archiviatoIl", { date: formatDate(p.archiviato?.quando_ms ?? null), da: p.archiviato?.da || "?" })}
                    </div>
                  </div>
                  <button type="button" data-testid={`unarchive-${p.riferimento}`} disabled={actionBusy === p.riferimento}
                    onClick={() => handleArchivia(p, false)}>{t("welcome.ripristina")}</button>
                  <button type="button" title={t("editor.delete")} disabled={actionBusy === p.riferimento}
                    onClick={() => handleDelete(p)}><IconaUI nome="chiudi" titolo={t("editor.delete")} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 13, marginBottom: 14, textAlign: "center" }}>
            {error}
          </div>
        )}

        {/* new project + open a copy that lives on the user's PC. The ZIP
            path is non-destructive (POST /api/projects/upload creates a new
            project) — unlike ☰ → "Sostituisci da copia sul PC". */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...BTN_PRIMARY, flex: 1, padding: "12px 0", fontSize: 15 }}
            onClick={() => { setNewTab("empty"); setShowNew(true); }}
            disabled={!!openingName}
          >
            {t("welcome.newProjectBtn")}
          </button>
          <button
            style={{ ...BTN_GHOST, padding: "12px 16px", fontSize: 14 }}
            onClick={() => { setNewTab("zip"); setShowNew(true); }}
            disabled={!!openingName}
            title={t("welcome.openFromZipTitle")}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <IconaUI nome="archivio" px={15} />
              {t("welcome.openFromZip")}
            </span>
          </button>
        </div>

        {/* Riga in fondo: l'unica via al modale di installazione.
            Prima diceva a quale runtime puntava la SPA («runtime locale» /
            «connesso a X»), ma quel dato non poteva cambiare — vedi il commento
            di `InstallaRuntimeModal`. Ora dice l'unica cosa che qui si può
            davvero fare. Collegare un runtime remoto vive in Configurazione →
            Runtime, dove funziona. */}
        <div style={{
          marginTop: 20, paddingTop: 14,
          borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: 12, color: "var(--brand-text-subtle, #64748b)",
        }}>
          <IconaUI nome="archivio" px={15} />
          <button
            style={{ background: "transparent", border: "none", color: "var(--brand-primary-testo, #3b82f6)", cursor: "pointer", fontSize: 12, textDecoration: "underline dotted" }}
            onClick={() => setShowInstalla(true)}
          >
            {t("welcome.installRuntime")}
          </button>
        </div>
      </div>
    </div>
  );
}

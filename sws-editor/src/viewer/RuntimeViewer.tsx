import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  AuthError,
  PasswordChangeRequiredError,
  RuntimeUnavailableError,
} from "@/api/client";
import { useAppStore } from "@/store";
import { tokenDelViewer } from "@/auth/sessioneViewer";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { ordinaPagine } from "@/pageTree";
import { pickInitialPageId } from "@/pageLayout";
import { useProjectWatcher } from "@/ws/projectWatcher";
import { useBuildWatcher } from "@/ws/buildWatcher";
import { riprovaFlussoTag } from "@/ws/tagStream";
import { riprovaFlussoAllarmi } from "@/ws/alarmStream";
import { testoSistema } from "@/i18n/testiSistema";
import { effectiveProjectLang, getStoredProjectLang } from "@/i18n/projectI18n";

/** Ogni quanto la schermata «si sta riavviando» richiede il progetto. */
export const RIPROVA_RIAVVIO_MS = 2_000;

// ── Idle screen (no active project on this runtime) ───────────────────────────

function RuntimeIdleScreen() {
  const { t } = useTranslation();
  return (
    <div data-testid="nessun-progetto" style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", gap: 16,
      fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
           stroke="var(--brand-primary, #3b82f6)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t("viewerMsg.noActiveProject")}</h2>
      <p style={{ margin: 0, color: "var(--brand-text-muted, #94a3b8)", textAlign: "center", maxWidth: 320 }}>
        {t("viewerMsg.noProjectHasBeenLoaded")}<br/>
        {t("viewerMsg.contactAdmin")}
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 20px", borderRadius: 6, background: "var(--brand-surface, #1e293b)",
          color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", cursor: "pointer", fontSize: 14,
        }}
      >
        {t("common.riprova")}
      </button>
    </div>
  );
}

// ── Il runtime non risponde (10-11-2026) ──────────────────────────────────────
//
// La pagina del viewer caricata (o ricaricata) mentre il runtime è fermo: un
// riavvio, un aggiornamento. Fino a oggi finiva su «No active project», che non
// era vero — il progetto c'è, è il runtime che non risponde ancora — e non se ne
// andava da solo. Ora la schermata lo dice e riprova da sé; «No active project»
// resta per il 503 vero.
//
// È un testo di sistema, nella lingua dei contenuti: quella del progetto se lo
// si era già letto, se no quella scelta l'ultima volta su questo schermo, se no
// quella del browser (il progetto, per definizione, non si può ancora leggere).

function linguaSenzaProgetto(): string {
  const tabella = useAppStore.getState().project?.languages;
  return effectiveProjectLang(tabella)
    || getStoredProjectLang()
    || (typeof navigator !== "undefined" ? (navigator.language ?? "").slice(0, 2) : "");
}

function RuntimeRestartingScreen() {
  return (
    <div data-testid="pannello-in-riavvio" style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", gap: 16,
      fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
           stroke="var(--brand-primary, #3b82f6)" strokeWidth="1.5">
        <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>
      </svg>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
        {testoSistema("pannello_in_riavvio", linguaSenzaProgetto())}
      </h2>
    </div>
  );
}

// ── RuntimeViewer — top-level SPA for port 7443 ───────────────────────────────
//
// Anonymous access via optional_auth on 7443 (Viewer role by default).
// No login prompt, no project management — just the live synoptic.

export function RuntimeViewer() {
  const { t } = useTranslation();
  const [updatedNotice, setUpdatedNotice] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);
  const noActiveProject     = useAppStore((s) => s.noActiveProject);
  // Il runtime non ha ancora risposto al caricamento della pagina: si mostra
  // «si sta riavviando» e si riprova (10-11-2026).
  const [inRiavvio, setInRiavvio] = useState(false);
  const setNoActiveProject  = useAppStore((s) => s.setNoActiveProject);
  const setProject          = useAppStore((s) => s.setProject);
  const setPages            = useAppStore((s) => s.setPages);
  const setFaceplates       = useAppStore((s) => s.setFaceplates);
  const clearAuth           = useAppStore((s) => s.clearAuth);
  const setAuth             = useAppStore((s) => s.setAuth);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);

  // Carica (o ricarica) progetto, pagine e faceplate dal runtime.
  // `keepPageId`: se quella pagina esiste ancora si resta lì — a un ricarico
  // automatico l'operatore non deve vedersi spostare la pagina sotto le mani.
  const loadProjectData = useCallback(async (keepPageId?: string) => {
    const p = await api.getProject();
    setNoActiveProject(false);
    setProject(p);

    const names = await api.listSynoptics();
    if (names.length > 0) {
      const pages = await Promise.all(names.map((n) => api.getPaginaComposta(n)));
      const keep = keepPageId && pages.some((x) => x.id === keepPageId)
        ? keepPageId
        : pickInitialPageId(ordinaPagine(pages, p.page_layout?.page_tree), p.page_layout?.home_page_id);
      setPages(pages, keep);
    } else {
      setPages([], "");
    }

    const ids = await api.listFaceplates().catch(() => [] as string[]);
    if (ids.length > 0) {
      const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
      setFaceplates(loaded);
    }
  }, [setNoActiveProject, setProject, setPages, setFaceplates]);

  // Il runtime ricarica il progetto da solo a ogni open/deploy, ma non lo dice
  // ai client: senza questo, dopo un deploy il pannello continua a mostrare la
  // versione precedente finché non lo si ricarica a mano.
  //
  // Un runtime che non risponde **non** passa di qui (10-11-2026): il
  // sorvegliante tiene l'impronta di prima, la pagina resta, e la fascia «Dati
  // in ritardo» con gli oggetti grigi dice che i valori sono vecchi. Prima un
  // errore di rete valeva «progetto chiuso», e il WP630 col runtime fermo 15 s
  // ha mostrato «No active project». Al ritorno i socket giù si riaprono subito
  // (`onRitorno`), senza aspettare il loro giro di attesa fino a 30 s.
  useProjectWatcher((fp) => {
    if (fp === null) { setNoActiveProject(true); return; }
    const current = useAppStore.getState().currentPageId;
    return loadProjectData(current)
      .then(() => {
        // **Chi sono, adesso?** (22-10-2026, piano
        // `docs/plans/2026-10-22-sessione-che-non-sopravvive-al-deploy.md`).
        //
        // Un deploy può aver cambiato gli utenti del progetto, e sulla porta
        // del viewer un token morto NON dà 401: `optional_auth` lo declassa in
        // silenzio ad anonimo. Le letture continuano a rispondere 200, quindi
        // senza questa riga l'interfaccia resta a dire che sei Admin finché
        // non provi a scrivere — e il 403 che arriva lì è muto.
        //
        // È l'unico punto in cui si richiede: il momento esatto in cui il
        // progetto è cambiato. Niente controllo periodico, che su un kiosk
        // acceso h24 sarebbe traffico, e nasconderebbe la prossima causa
        // invece di mostrarla.
        //
        // `tokenDelViewer` fa il resto: con un token morto `whoami` risponde
        // 200 con `username: ""`, quindi torna il sentinella `no-auth`, i
        // cancelli lato client si richiudono — e `authToken` cambia, il che
        // fa riaprire il flusso tag e butta via il ruolo stantio rimasto sul
        // socket aperto.
        void api.whoami()
          .then((me) => setAuth(tokenDelViewer(useAppStore.getState().authToken, me.username), me.username, me.role))
          .catch(() => { /* niente risposta: si resta com'era, ci riprova al prossimo deploy */ });
        // Avviso breve: l'operatore deve capire PERCHÉ la schermata è
        // cambiata sotto le sue mani, senza dovere premere nulla.
        setUpdatedNotice(true);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setUpdatedNotice(false), 4000);
      })
      .catch((e) => {
        // Il runtime è caduto a metà del ricarico: la pagina di prima resta, e
        // il sorvegliante richiama al prossimo giro (la promessa fallita).
        if (e instanceof RuntimeUnavailableError) throw e;
        setNoActiveProject(true);
      });
  }, undefined, () => {
    riprovaFlussoTag();
    riprovaFlussoAllarmi();
  });

  // Frontend nuovo distribuito → ricarica. Un bundle nuovo si carica solo
  // ricaricando la pagina, e sul pannello non c'è nessuno che possa premere un
  // pulsante. Scelta del maintainer: viewer automatico, IDE con avviso.
  useBuildWatcher(() => window.location.reload());

  // On mount: detect whether a project is active and load its data.
  //
  // Se il runtime non risponde (fermo, in riavvio, in aggiornamento) non è
  // «nessun progetto»: si mostra «Il pannello si sta riavviando, riprovo…» e si
  // riprova ogni 2 s finché risponde (10-11-2026). Il 503 vero resta
  // `RuntimeIdleScreen`.
  useEffect(() => {
    let vivo = true;
    let timer: number | null = null;

    const prova = () => {
      // Initialize authToken so useTagStream() can open the WebSocket.
      // In no-auth mode whoami() returns 200 with a synthetic admin — we use
      // the "no-auth" sentinel token (ignored by optional_auth on the server).
      // Una sessione vera salvata invece si **tiene** (`tokenDelViewer`): prima
      // la si sostituiva col sentinella, e l'operatore perdeva il login.
      // A ogni tentativo: col runtime fermo anche questa fallisce.
      api.whoami()
        .then((me) => { if (vivo) setAuth(tokenDelViewer(useAppStore.getState().authToken, me.username), me.username, me.role); })
        .catch(() => { /* anonymous viewer — reads work, writes need auth */ });

      loadProjectData()
        .then(() => { if (vivo) setInRiavvio(false); })
        .catch((e) => {
          if (!vivo) return;
          if (e instanceof RuntimeUnavailableError) {
            setInRiavvio(true);
            timer = window.setTimeout(prova, RIPROVA_RIAVVIO_MS);
            return;
          }
          setInRiavvio(false);
          if (e instanceof AuthError) {
            clearAuth();
          } else if (e instanceof PasswordChangeRequiredError) {
            setMustChangePassword(true);
          }
          // NoProjectError (503) e il resto: nessun progetto da mostrare.
          setNoActiveProject(true);
        });
    };
    prova();
    return () => {
      vivo = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  if (inRiavvio) return <RuntimeRestartingScreen />;
  if (noActiveProject) return <RuntimeIdleScreen />;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      fontFamily: "system-ui, sans-serif, 'SWS Emoji'", color: "var(--brand-text, #e2e8f0)", background: "var(--brand-bg, #0f172a)",
    }}>
      {updatedNotice && (
        <div style={{
          position: "fixed", top: 12, right: 12, zIndex: 9500,
          background: "var(--brand-surface, #1e293b)",
          border: "1px solid var(--brand-success, #22c55e)",
          color: "var(--brand-success-soft, #86efac)",
          borderRadius: 6, padding: "6px 12px", fontSize: 13,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)", pointerEvents: "none",
        }}>
          ⟳ {t("viewer.projectUpdated")}
        </div>
      )}
      <RuntimeView />
    </div>
  );
}

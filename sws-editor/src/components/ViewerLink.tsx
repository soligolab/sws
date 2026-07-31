import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getRuntimeBaseUrl } from "@/api/client";
import { HDR_BTN } from "@/components/headerStyles";
import { viewerUrlFromAdmin } from "@/runtimeUrl";
import { useAppStore } from "@/store";

/** Quanto si aspetta il runtime prima di dichiararlo non raggiungibile. */
const PROBE_TIMEOUT_MS = 4000;
/** Per quanto resta a schermo l'esito di un sondaggio fallito. */
const MESSAGE_MS = 8000;

/**
 * Apre la pagina operatore del runtime in una scheda nuova del browser.
 *
 * **Quale runtime**: quello a cui l'IDE è connesso, se c'è — dopo un deploy è
 * l'unico che interessa guardare. Senza connessione ricade sul runtime che sta
 * servendo questa SPA. Su `start_editor.sh`, che è solo-IDE e non ha viewer, il
 * sondaggio fallisce e lo dice invece di aprire una scheda bianca.
 *
 * **Perché sonda prima di aprire**: il caso normale in cui si preme questo
 * bottone è "il dispositivo non risponde più". Aprire comunque darebbe una
 * scheda vuota con un errore del browser, che non distingue "spento" da
 * "certificato non accettato" — due problemi con due rimedi diversi.
 */
export function ViewerLink() {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl       = useAppStore((s) => s.remoteUrl);
  const [probing, setProbing] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  // `remoteUrl` nello store lo scrive RuntimeConnectionTab, quindi resta vuoto
  // finché in questa sessione non si è aperta Configurazione → Runtime. Chi
  // ricarica l'IDE e vuole subito guardare il dispositivo si troverebbe il
  // bottone puntato al runtime locale. Una domanda al server al montaggio
  // dell'header costa una richiesta e toglie il caso.
  const [serverRemoteUrl, setServerRemoteUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    let alive = true;
    api.remoteStatus()
      .then((s) => { if (alive) setServerRemoteUrl(s.connected ? (s.url ?? null) : null); })
      .catch(() => { /* non critico: si ricade sul runtime locale */ });

    // Senza questi ascoltatori una disconnessione lascerebbe il vecchio
    // indirizzo qui dentro, e il bottone continuerebbe a puntare a un
    // dispositivo da cui l'utente si è appena staccato. Sono gli stessi eventi
    // che già usa l'header per la pill di Deploy.
    const onConn = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      setServerRemoteUrl(url ?? null);
    };
    const onDisc = () => setServerRemoteUrl(null);
    window.addEventListener("sws:runtime-connected", onConn);
    window.addEventListener("sws:runtime-disconnected", onDisc);
    return () => {
      alive = false;
      window.removeEventListener("sws:runtime-connected", onConn);
      window.removeEventListener("sws:runtime-disconnected", onDisc);
    };
  }, []);

  // Il runtime connesso vince sul locale. Lo store ha la parola definitiva
  // quando c'è (l'utente può essersi appena connesso o disconnesso senza
  // ricaricare); la risposta del server copre l'avvio a freddo.
  // `getRuntimeBaseUrl()` copre il caso in cui la SPA punta a un'origine
  // diversa (ARCH-004); altrimenti è la finestra stessa a dire da dove è
  // stata servita.
  const connectedUrl = remoteConnected ? (remoteUrl ?? serverRemoteUrl) : serverRemoteUrl;
  // `||` e non `??`: getRuntimeBaseUrl() restituisce la stringa **vuota**
  // quando la SPA è servita dalla sua stessa origine, non `null`.
  const adminUrl = connectedUrl || getRuntimeBaseUrl() || window.location.origin;
  const viewerUrl = viewerUrlFromAdmin(adminUrl);
  if (!viewerUrl) return null;

  const showError = (msg: string) => {
    setError(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setError(null), MESSAGE_MS);
  };

  const handleClick = async () => {
    if (probing) return;
    setProbing(true);
    setError(null);
    try {
      // `/health` è pre-auth su entrambe le porte e il runtime manda CORS
      // permissivo, quindi la risposta è leggibile davvero — non un opaco che
      // costringerebbe a indovinare.
      const res = await fetch(`${viewerUrl}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        showError(t("header.viewerBadStatus", { status: res.status }));
        return;
      }
      window.open(viewerUrl, "_blank", "noopener");
    } catch {
      // Il fetch fallisce allo stesso modo per host spento, porta chiusa e
      // certificato self-signed non ancora accettato: il messaggio nomina
      // l'ultimo caso perché è l'unico che si risolve senza toccare il
      // dispositivo, ed è quello che sorprende.
      showError(
        viewerUrl.startsWith("https:")
          ? t("header.viewerUnreachableTls", { url: viewerUrl })
          : t("header.viewerUnreachable", { url: viewerUrl }),
      );
    } finally {
      setProbing(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        style={{ ...HDR_BTN, opacity: probing ? 0.6 : 1 }}
        disabled={probing}
        onClick={() => void handleClick()}
        title={t("header.openViewerTitle", { url: viewerUrl })}
      >
        {probing ? t("header.viewerProbing") : t("header.openViewer")}
      </button>
      {error && (
        <span
          role="status"
          style={{
            fontSize: 11,
            maxWidth: 320,
            color: "var(--brand-danger, #ef4444)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}

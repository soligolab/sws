/** Le immagini del progetto dentro un sinottico, anche **nel cloud**
 *  (25-10-2026).
 *
 *  Un `<image href>` di SVG non manda l'intestazione `Authorization`, e le
 *  immagini del progetto (`/api/project/images/…`) chiedono una sessione. In
 *  locale non si vedeva: l'IDE non si autentica, e il viewer del pannello le
 *  serve anche agli anonimi. Nel cloud l'URL andava per giunta alla **radice**
 *  del sito, cioè al gateway, invece che sotto `/p/<azienda>/<progetto>`: il
 *  browser riceveva 401 e il rettangolo con l'immagine di sfondo mostrava
 *  altro — il maintainer: «sembra mostri solo un pezzo piccolo molto
 *  ingrandito». Nel cloud quindi l'immagine si scarica con la sessione, come fa
 *  già l'immagine di boot (`boot/rasterizza.ts`), e si disegna da un `blob:`
 *  tenuto in memoria. Altrove l'URL resta com'è: lì funziona già. */
import { useEffect, useState } from "react";
import type { ImgHTMLAttributes, SVGProps } from "react";
import { getAuthToken, getBaseUrl } from "@/api/client";
import { prefissoGateway, prefissoSchermo } from "@/api/prefisso";

const pronte = new Map<string, string>();
const inVolo = new Map<string, Promise<string | null>>();
/** Il `Blob` dietro ogni `blob:` che abbiamo creato, tenuto **in memoria**.
 *
 *  Serve a chi quell'immagine deve rileggerla invece che solo disegnarla — il
 *  PNG di boot. E non è un'ottimizzazione: un `fetch("blob:…")` nel cloud **non
 *  si può fare**, lo rifiuta la Content Security Policy del runtime, che in
 *  `connect-src` elenca `'self' http: https: ws: wss:` e non `blob:`
 *  (`sws-web/src/sicurezza_http.rs`). Il browser lo disegna volentieri — `img-src`
 *  è un'altra direttiva — ma leggerlo via rete no, e il messaggio arriva solo
 *  nella console: «Refused to connect because it violates the document's
 *  Content Security Policy».
 *
 *  Trovato il 27-10-2026 sul PNG di boot nel cloud, con la console del
 *  maintainer. L'alternativa era allargare la CSP a `blob:`; tenersi il Blob
 *  costa meno, non tocca la politica di sicurezza, e risparmia pure un giro. */
const corpi = new Map<string, Blob>();

/** Il `Blob` dietro un `blob:` che abbiamo creato noi, se ce l'abbiamo ancora. */
export function blobDi(url: string): Blob | undefined {
  return corpi.get(url);
}

/** Quest'immagine va scaricata con la sessione invece che lasciata al browser? */
export function serveScaricare(href: string | undefined): href is string {
  // Anche sullo schermo di un pannello aperto dal cloud (29-10-2026): lì
  // l'indirizzo alla radice andrebbe al gateway, non al pannello.
  return !!href && href.startsWith("/api/") && (!!prefissoGateway() || !!prefissoSchermo());
}

/** Scarica (una volta sola per URL) e restituisce un `blob:` da disegnare. */
export function scaricaImmagine(href: string): Promise<string | null> {
  const fatta = pronte.get(href);
  if (fatta) return Promise.resolve(fatta);
  const giaInVolo = inVolo.get(href);
  if (giaInVolo) return giaInVolo;
  const headers = new Headers();
  const tok = getAuthToken();
  if (tok && tok !== "no-auth") headers.set("Authorization", `Bearer ${tok}`);
  const p = fetch(`${getBaseUrl()}${href}`, { headers })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => {
      if (!b) return null;
      const url = URL.createObjectURL(b);
      pronte.set(href, url);
      corpi.set(url, b);
      return url;
    })
    .catch(() => null)
    .finally(() => inVolo.delete(href));
  inVolo.set(href, p);
  return p;
}

/** Un'immagine ricaricata con lo stesso nome: la copia in memoria non vale più. */
export function dimenticaImmagine(href: string): void {
  const u = pronte.get(href);
  if (u) {
    URL.revokeObjectURL(u);
    corpi.delete(u);
  }
  pronte.delete(href);
}

/** L'URL da dare al disegno: quello vero, o il `blob:` nel cloud. */
export function useHrefImmagine(href: string | undefined): string | undefined {
  const [v, setV] = useState<string | undefined>(() => (serveScaricare(href) ? pronte.get(href) : href));
  useEffect(() => {
    if (!serveScaricare(href)) { setV(href); return; }
    const gia = pronte.get(href);
    if (gia) { setV(gia); return; }
    let vivo = true;
    void scaricaImmagine(href).then((u) => { if (vivo) setV(u ?? undefined); });
    return () => { vivo = false; };
  }, [href]);
  return v;
}

/** `<image>` che sa disegnare anche le immagini del progetto nel cloud. */
export function ImmagineSvg(props: SVGProps<SVGImageElement>) {
  const href = useHrefImmagine(typeof props.href === "string" ? props.href : undefined);
  if (!href) return null;
  return <image {...props} href={href} />;
}

/** Lo stesso per un `<img>` dell'interfaccia (anteprime, icone dei simboli). */
export function ImgProgetto(props: ImgHTMLAttributes<HTMLImageElement>) {
  const src = useHrefImmagine(typeof props.src === "string" ? props.src : undefined);
  if (!src) return null;
  return <img {...props} src={src} />;
}

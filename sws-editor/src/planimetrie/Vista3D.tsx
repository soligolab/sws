/** La vista 3D di una planimetria (29-10-2026, ramo 2 del piano
 *  `docs/archive/2026-10-25-planimetrie-3d.md`).
 *
 *  three.js si carica **qui e solo qui**, con un `import()` dinamico: non
 *  entra nell'avvio dell'IDE, e né il viewer web né quello LVGL lo vedono mai —
 *  consumano il PNG che «Genera sfondo» produce. La geometria arriva già fatta
 *  da `scena.ts`; questo file la traduce in mesh e basta.
 *
 *  L'inquadratura si muove col mouse (OrbitControls) e si salva nella
 *  planimetria. Sopra la vista c'è la **cornice della pagina** (30-10-2026):
 *  il rettangolo con le proporzioni dello sfondo da generare, fuori scurito.
 *  Lo sfondo generato è quello che sta dentro la cornice, né più né meno. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type * as THREE_T from "three";
import { useTranslation } from "react-i18next";
import type { Camera, Planimetria } from "./modello";
import { costruisciScena, inquadraturaDiPartenza, riquadroPagina, spigoliScena } from "./scena";

export interface Vista3DApi {
  /** Rende la vista attuale alla misura chiesta, al doppio e poi ridotta: un
   *  PNG senza scalini sugli spigoli dei muri. */
  genera: (larghezza: number, altezza: number) => Promise<Blob>;
  /** Avvicina o allontana la camera, nella direzione da cui guarda adesso,
   *  finché la pianta sta tutta dentro la cornice, quasi a filo. */
  inquadra: () => void;
}

/** La misura dello sfondo da generare, in pixel: dà le proporzioni alla cornice. */
export interface Formato {
  larghezza: number;
  altezza: number;
}

/** Quanto lasciare fra la pianta e la cornice, quando si inquadra: in unità
 *  normalizzate della camera (1 = bordo), quindi il 4% per lato. */
const FILO = 0.92;

interface Motore {
  THREE: typeof THREE_T;
  renderer: THREE_T.WebGLRenderer;
  scena: THREE_T.Scene;
  camera: THREE_T.PerspectiveCamera;
  gruppo: THREE_T.Group;
  controlli: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
}

/** La camera che vede **solo la cornice**: la stessa della vista, con
 *  `setViewOffset` sul pezzo dentro la cornice. Così il PNG e la cornice
 *  coincidono qualunque sia la forma del riquadro. */
function cameraDellaCornice(m: Motore, W: number, H: number, f: Formato): THREE_T.PerspectiveCamera {
  const c = m.camera.clone();
  if (W > 0 && H > 0) {
    const r = riquadroPagina(W, H, f.larghezza, f.altezza);
    c.aspect = W / H;
    c.setViewOffset(W, H, r.x, r.y, r.w, r.h);
  } else {
    c.aspect = f.larghezza / Math.max(1, f.altezza);
  }
  c.updateProjectionMatrix();
  return c;
}

/** L'inquadratura che mette la pianta a filo della cornice: stessa direzione
 *  di adesso, puntata al centro della pianta, alla distanza più corta a cui
 *  tutti gli spigoli (muri compresi) stanno dentro. Una ricerca per
 *  bisezione invece di una formula: la prospettiva e il riquadro scentrato
 *  di `setViewOffset` la renderebbero lunga e fragile. */
function inquadraturaAFilo(m: Motore, pianta: Planimetria, W: number, H: number, f: Formato): Camera | null {
  const { THREE, camera, controlli } = m;
  const s = costruisciScena(pianta);
  const [x0, z0, x1, z1] = s.limiti;
  const bersaglio = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const dir = camera.position.clone().sub(controlli.target);
  if (dir.lengthSq() < 1e-9) dir.set(0.15, 1.1, 0.9);
  dir.normalize();
  const punti = spigoliScena(s).map((p) => new THREE.Vector3(...p));
  const c = cameraDellaCornice(m, W, H, f);
  const entra = (d: number) => {
    c.position.copy(bersaglio).addScaledVector(dir, d);
    c.lookAt(bersaglio);
    c.updateMatrixWorld();
    return punti.every((p) => {
      const q = p.clone().project(c);
      return Math.abs(q.x) <= FILO && Math.abs(q.y) <= FILO && q.z > -1 && q.z < 1;
    });
  };
  let vicino = 0.2, lontano = 400;
  if (!entra(lontano)) return null;
  for (let i = 0; i < 40; i++) {
    const mezzo = (vicino + lontano) / 2;
    if (entra(mezzo)) lontano = mezzo; else vicino = mezzo;
  }
  const pos = bersaglio.clone().addScaledVector(dir, lontano);
  return { pos: [pos.x, pos.y, pos.z], target: [bersaglio.x, bersaglio.y, bersaglio.z], fov: camera.fov };
}

export const Vista3D = forwardRef<Vista3DApi, { pianta: Planimetria; formato: Formato; onCamera: (c: Camera) => void }>(
  function Vista3D({ pianta, formato, onCamera }, ref) {
    const { t } = useTranslation();
    const contenitore = useRef<HTMLDivElement | null>(null);
    const motore = useRef<Motore | null>(null);
    const [errore, setErrore] = useState<string | null>(null);
    const [pronto, setPronto] = useState(false);
    // La misura del riquadro, per disegnare la cornice e per sapere quale pezzo
    // della vista rendere.
    const [dim, setDim] = useState<{ W: number; H: number }>({ W: 0, H: 0 });
    const onCameraRef = useRef(onCamera);
    onCameraRef.current = onCamera;
    const formatoRef = useRef(formato);
    formatoRef.current = formato;
    const piantaRef = useRef(pianta);
    piantaRef.current = pianta;
    // L'inquadratura si mette una volta sola, alla prima scena: quella salvata
    // o una di partenza. Dopo la muove chi guarda, e un muro aggiunto non deve
    // far saltare la vista.
    const primaScena = useRef(true);

    // Il motore nasce una volta, alla prima apertura della vista.
    useEffect(() => {
      let vivo = true;
      let ferma = () => {};
      (async () => {
        try {
          const THREE = await import("three");
          const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
          const el = contenitore.current;
          if (!vivo || !el) return;
          const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
          renderer.setPixelRatio(window.devicePixelRatio);
          renderer.setSize(el.clientWidth, el.clientHeight);
          el.appendChild(renderer.domElement);
          setDim({ W: el.clientWidth, H: el.clientHeight });
          const scena = new THREE.Scene();
          scena.add(new THREE.AmbientLight(0xffffff, 0.55));
          const sole = new THREE.DirectionalLight(0xffffff, 1.1);
          sole.position.set(8, 20, 12);
          scena.add(sole);
          const gruppo = new THREE.Group();
          scena.add(gruppo);
          const camera = new THREE.PerspectiveCamera(45, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 500);
          const controlli = new OrbitControls(camera, renderer.domElement);
          controlli.enableDamping = false;
          let attesa: ReturnType<typeof setTimeout> | undefined;
          controlli.addEventListener("change", () => {
            renderer.render(scena, camera);
            // L'inquadratura si salva quando ci si ferma, non a ogni passo.
            clearTimeout(attesa);
            attesa = setTimeout(() => onCameraRef.current({
              pos: [camera.position.x, camera.position.y, camera.position.z],
              target: [controlli.target.x, controlli.target.y, controlli.target.z],
              fov: camera.fov,
            }), 400);
          });
          const ridimensiona = new ResizeObserver(() => {
            const w = el.clientWidth, h = el.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            setDim({ W: w, H: h });
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.render(scena, camera);
          });
          ridimensiona.observe(el);
          motore.current = { THREE, renderer, scena, camera, gruppo, controlli };
          ferma = () => {
            clearTimeout(attesa);
            ridimensiona.disconnect();
            controlli.dispose();
            renderer.dispose();
            renderer.domElement.remove();
          };
          setPronto(true);
        } catch (e) {
          // Niente WebGL (un browser senza, o i test): si dice e si va avanti.
          if (vivo) setErrore(e instanceof Error ? e.message : String(e));
        }
      })();
      return () => { vivo = false; ferma(); motore.current = null; };
    }, []);

    // La scena si rifà quando cambia la pianta.
    useEffect(() => {
      const m = motore.current;
      if (!m || !pronto) return;
      const { THREE, gruppo, scena, camera, controlli, renderer } = m;
      for (const figlio of [...gruppo.children]) {
        gruppo.remove(figlio);
        const mesh = figlio as THREE_T.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE_T.Material | THREE_T.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      }
      const s = costruisciScena(pianta);
      scena.background = new THREE.Color(pianta.sfondo ?? "#0f172a");
      // Il pavimento: appena più chiaro dello sfondo, quanto basta a leggere le ombre.
      const [x0, z0, x1, z1] = s.limiti;
      const pavimento = new THREE.Mesh(
        new THREE.PlaneGeometry(x1 - x0 + 4, z1 - z0 + 4),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(pianta.sfondo ?? "#0f172a").offsetHSL(0, 0, 0.06) }),
      );
      pavimento.rotation.x = -Math.PI / 2;
      pavimento.position.set((x0 + x1) / 2, -0.01, (z0 + z1) / 2);
      gruppo.add(pavimento);
      for (const a of s.pavimenti) {
        const forma = new THREE.Shape(a.punti.map(([x, y]) => new THREE.Vector2(x, -y)));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(forma), new THREE.MeshStandardMaterial({ color: a.colore }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.005;
        gruppo.add(mesh);
        if (a.etichetta) {
          const xs = a.punti.map((q) => q[0]);
          gruppo.add(etichetta(THREE, a.etichetta, [a.centro[0], 0.05, a.centro[1]], true, 0.5, (Math.max(...xs) - Math.min(...xs)) * 0.8));
        }
      }
      for (const b of s.scatole) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(...b.misure),
          new THREE.MeshStandardMaterial({ color: b.colore, roughness: 0.8 }),
        );
        mesh.position.set(...b.centro);
        mesh.rotation.y = b.rotazioneY;
        gruppo.add(mesh);
        if (b.etichetta) gruppo.add(etichetta(THREE, b.etichetta, [b.centro[0], b.centro[1] * 2 + 0.25, b.centro[2]], false, 0.3, b.misure[0] * 1.2));
      }
      if (primaScena.current) {
        // Senza un'inquadratura salvata si parte dal sbieco di sempre, poi la
        // pianta si mette a filo della cornice.
        const partenza = inquadraturaDiPartenza(s);
        const cam = pianta.camera ?? partenza;
        camera.position.set(...cam.pos);
        controlli.target.set(...cam.target);
        camera.fov = cam.fov;
        camera.updateProjectionMatrix();
        controlli.update();
        const el = contenitore.current;
        if (!pianta.camera && el) {
          const filo = inquadraturaAFilo(m, pianta, el.clientWidth, el.clientHeight, formatoRef.current);
          if (filo) {
            camera.position.set(...filo.pos);
            controlli.target.set(...filo.target);
          }
        }
        primaScena.current = false;
      }
      controlli.update();
      renderer.render(scena, camera);
    }, [pianta, pronto]);

    useImperativeHandle(ref, () => ({
      genera: async (larghezza, altezza) => {
        const m = motore.current;
        if (!m) throw new Error(t("planimetrie.senzaVista"));
        const { THREE, scena } = m;
        const el = contenitore.current;
        const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        try {
          r.setPixelRatio(1);
          r.setSize(larghezza * 2, altezza * 2);
          // Il pezzo dentro la cornice, non la vista intera: la cornice ha
          // le proporzioni di `formato`, che sono quelle chieste qui.
          const c = cameraDellaCornice(m, el?.clientWidth ?? 0, el?.clientHeight ?? 0, { larghezza, altezza });
          r.render(scena, c);
          const ridotta = document.createElement("canvas");
          ridotta.width = larghezza;
          ridotta.height = altezza;
          const ctx = ridotta.getContext("2d");
          if (!ctx) throw new Error("canvas 2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(r.domElement, 0, 0, larghezza, altezza);
          return await new Promise<Blob>((ok, ko) => ridotta.toBlob((b) => (b ? ok(b) : ko(new Error("toBlob"))), "image/png"));
        } finally {
          r.dispose();
        }
      },
      inquadra: () => {
        const m = motore.current;
        const el = contenitore.current;
        if (!m || !el) return;
        const filo = inquadraturaAFilo(m, piantaRef.current, el.clientWidth, el.clientHeight, formatoRef.current);
        if (!filo) return;
        m.camera.position.set(...filo.pos);
        m.controlli.target.set(...filo.target);
        m.controlli.update();
        m.renderer.render(m.scena, m.camera);
        onCameraRef.current(filo);
      },
    }), [t]);

    return (
      <div ref={contenitore} data-testid="vista-3d" style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", background: pianta.sfondo ?? "#0f172a" }}>
        {dim.W > 0 && dim.H > 0 && !errore && <CornicePagina dim={dim} formato={formato} />}
        {errore && (
          <div style={{ position: "absolute", inset: 0, padding: 16, fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)" }}>
            {t("planimetrie.senza3d", { message: errore })}
          </div>
        )}
      </div>
    );
  },
);

/** Un'etichetta come immagine: a terra per un'area, in piedi sopra un blocco.
 *  `alta` è l'altezza in metri, e la larghezza non supera `massimo`: un nome
 *  lungo si rimpicciolisce invece di uscire da ciò che descrive. */
function etichetta(THREE: typeof THREE_T, testo: string, dove: [number, number, number], aTerra: boolean, alta: number, massimo: number): THREE_T.Object3D {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const corpo = 48;
  if (ctx) {
    ctx.font = `600 ${corpo}px sans-serif`;
    c.width = Math.ceil(ctx.measureText(testo).width) + 24;
    c.height = corpo + 20;
    ctx.font = `600 ${corpo}px sans-serif`;
    ctx.fillStyle = "#e2e8f0";
    ctx.textBaseline = "middle";
    ctx.fillText(testo, 12, c.height / 2);
  }
  const trama = new THREE.CanvasTexture(c);
  const proporzione = c.width / c.height;
  const scala = Math.min(alta, massimo > 0 ? massimo / proporzione : alta);
  if (aTerra) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(proporzione * scala, scala),
      new THREE.MeshBasicMaterial({ map: trama, transparent: true }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(...dove);
    return mesh;
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: trama, transparent: true }));
  sprite.scale.set(proporzione * scala, scala, 1);
  sprite.position.set(...dove);
  return sprite;
}

/** La cornice della pagina sopra la vista: fuori scurito (un'ombra enorme
 *  attorno al riquadro), dentro limpido, e la misura in un angolo. Non prende
 *  il mouse: la vista sotto si gira come prima. */
function CornicePagina({ dim, formato }: { dim: { W: number; H: number }; formato: Formato }) {
  const r = riquadroPagina(dim.W, dim.H, formato.larghezza, formato.altezza);
  return (
    <div data-testid="cornice-pagina" style={{
      position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, pointerEvents: "none",
      boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)", outline: "1px dashed rgba(226, 232, 240, 0.8)",
    }}>
      <span style={{ position: "absolute", right: 4, bottom: 2, fontSize: 11, color: "#e2e8f0", textShadow: "0 0 3px #000" }}>
        {Math.round(formato.larghezza)} × {Math.round(formato.altezza)}
      </span>
    </div>
  );
}

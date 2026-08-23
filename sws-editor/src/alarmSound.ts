// ── Segnalazione acustica degli allarmi (F7.5) ──────────────────────────────
//
// Un pannello SCADA in sala quadri non viene guardato di continuo: la
// campanella lampeggia e nessuno la vede. Qui c'è il suono, opt-in.
//
// Perché sintetizzato con Web Audio e non un file audio: le pagine del viewer
// girano anche da un runtime senza asset extra (e su LVGL non c'è affatto
// audio), un mp3 andrebbe versionato, servito e mantenuto. Un oscillatore
// costa zero byte e dà toni distinguibili per severità.
//
// Nota: i browser bloccano l'audio finché l'utente non ha interagito con la
// pagina almeno una volta. Su un pannello kiosk che nessuno tocca il primo
// beep può quindi non uscire: è un limite del browser, non un difetto qui —
// il primo tocco sblocca tutto e da lì in poi suona.

import type { AlarmSeverity } from "@/types";

let ctx: AudioContext | null = null;

/** Contesto audio condiviso, creato al primo suono (non al caricamento). */
function audioCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { return null; }
  return ctx;
}

/** Timbro per severità: più è grave, più il tono è basso e insistente. */
const TONE: Record<AlarmSeverity, { freq: number; beeps: number; ms: number }> = {
  Critical: { freq: 440, beeps: 3, ms: 140 },
  Warning:  { freq: 660, beeps: 2, ms: 120 },
  Info:     { freq: 880, beeps: 1, ms: 110 },
};

/** Emette la sequenza di beep della severità indicata. */
export function playAlarmBeep(sev: AlarmSeverity, volume = 0.2): void {
  const ac = audioCtx();
  if (!ac) return;
  // Il contesto può essere sospeso (autoplay policy): un resume è innocuo.
  if (ac.state === "suspended") void ac.resume().catch(() => {});
  const { freq, beeps, ms } = TONE[sev] ?? TONE.Info;
  const gap = ms + 70;
  for (let i = 0; i < beeps; i++) {
    const t0 = ac.currentTime + (i * gap) / 1000;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    // Inviluppo breve: senza rampa si sente un "click" a inizio e fine nota.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }
}

/** La severità più grave di un insieme (l'ordine in cui va suonata). */
export function worstSeverity(sevs: (AlarmSeverity | undefined)[]): AlarmSeverity | null {
  if (sevs.includes("Critical")) return "Critical";
  if (sevs.includes("Warning")) return "Warning";
  if (sevs.some((s) => s === "Info")) return "Info";
  return null;
}

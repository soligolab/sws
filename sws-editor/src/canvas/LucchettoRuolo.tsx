/** Il lucchetto col ruolo che serve (regola R7 dei template, 04-11-2026):
 *  una pastiglia nell'angolo in alto a destra dell'oggetto, sopra il bordo.
 *  Forma A della tavola `sws/tmp/lucchetto/tavola.html`, scelta dal
 *  maintainer. Non prende i tocchi: il tocco resta all'oggetto, che apre
 *  l'accesso quando è la variabile a chiedere il ruolo. Il gemello LVGL è
 *  `lucchetto_ruolo` in `lvgl_render.rs`. */
export function LucchettoRuolo({ destra, alto, ruolo }: { destra: number; alto: number; ruolo: string }) {
  const corpo = 11;
  const largo = Math.round(ruolo.length * corpo * 0.62 + 26);
  const x = destra + 9 - largo;
  const y = alto - 9;
  return (
    <g data-lucchetto={ruolo} style={{ pointerEvents: "none" }}>
      <rect x={x} y={y} width={largo} height={18} rx={9}
        fill="#0b1220" stroke="#fbbf24" strokeOpacity={0.45} strokeWidth={1} />
      <g transform={`translate(${x + 5}, ${y + 3})`} fill="#fbbf24">
        <rect x={2} y={5.2} width={8} height={6} rx={1.2} />
        <path d="M3.8 5.4V3.8a2.2 2.2 0 0 1 4.4 0v1.6" fill="none" stroke="#fbbf24" strokeWidth={1.4} />
      </g>
      <text x={x + 19} y={y + 13} fontSize={corpo} fontWeight={600} fill="#fbbf24">{ruolo}</text>
    </g>
  );
}

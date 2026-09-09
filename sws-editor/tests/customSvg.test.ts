// La sanificazione dei simboli SVG — revisione del 2026-09-09.
//
// I simboli custom sono markup incollato da un utente e iniettato nel DOM con
// `dangerouslySetInnerHTML`, nel canvas dell'editor E nel viewer servito agli
// operatori anonimi. La prima versione era cinque regex; questi test sono le
// scappatoie che le regex lasciavano aperte, e devono restare chiuse.
import { describe, expect, it } from "vitest";
import { applyStateColor, parseSvg, sanitizeSvg } from "@/symbols/customSvg";

const esegue = (s: string) =>
  /<script|\son\w+\s*=|javascript:|<foreignobject|<iframe|<embed|<object|<set\b|<animate/i.test(s);

describe("sanitizeSvg — cosa cade", () => {
  it("script, con e senza tag di chiusura", () => {
    expect(esegue(sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><script src="x"/><rect/></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><SCRIPT>alert(1)</SCRIPT></svg>'))).toBe(false);
  });

  it("handler on* in ogni forma: virgolette doppie, singole, nessuna, maiuscole", () => {
    expect(esegue(sanitizeSvg('<svg><rect onload="alert(1)"/></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg("<svg><rect onload='alert(1)'/></svg>"))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><rect onload=alert(1) /></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><rect ONCLICK="alert(1)"/></svg>'))).toBe(false);
  });

  it("javascript: in href, xlink:href, con l'apice e con spazi davanti", () => {
    expect(esegue(sanitizeSvg('<svg><a href="javascript:alert(1)"><rect/></a></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg("<svg><a href='javascript:alert(1)'><rect/></a></svg>"))).toBe(false);
    expect(esegue(sanitizeSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="javascript:alert(1)"/></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><a href="  javascript:alert(1)"><rect/></a></svg>'))).toBe(false);
  });

  it("foreignObject, iframe, embed, object, e le animazioni che riscrivono href", () => {
    expect(esegue(sanitizeSvg('<svg><foreignObject><body onload="alert(1)"/></foreignObject></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><iframe src="javascript:alert(1)"/></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><a><animate attributeName="href" values="javascript:alert(1)"/><rect/></a></svg>'))).toBe(false);
    expect(esegue(sanitizeSvg('<svg><a><set attributeName="href" to="javascript:alert(1)"/><rect/></a></svg>'))).toBe(false);
  });

  it("style con url(): un CSS che carica da fuori esfiltra", () => {
    const out = sanitizeSvg('<svg><rect style="fill:url(http://evil/x)"/></svg>');
    expect(/url\s*\(/i.test(out)).toBe(false);
  });

  it("href a documenti esterni o data:text/html cadono, #id e data:image restano", () => {
    expect(sanitizeSvg('<svg><use href="#pump"/></svg>')).toContain('href="#pump"');
    expect(sanitizeSvg('<svg><image href="data:image/png;base64,AAAA"/></svg>')).toContain("data:image/png");
    expect(sanitizeSvg('<svg><image href="data:text/html,<script>alert(1)</script>"/></svg>')).not.toContain("text/html");
    expect(sanitizeSvg('<svg><use href="http://evil/x.svg#a"/></svg>')).not.toContain("evil");
  });
});

describe("sanitizeSvg — cosa resta", () => {
  it("un simbolo normale passa intatto nella sostanza", () => {
    const svg = '<svg viewBox="0 0 100 100"><g id="body"><rect id="r" x="1" y="2" width="10" height="20" fill="#f00"/><circle cx="5" cy="5" r="3"/></g><path d="M0 0L10 10"/></svg>';
    const out = sanitizeSvg(svg);
    for (const pezzo of ['id="body"', 'id="r"', 'width="10"', 'fill="#f00"', "<circle", "<path", 'd="M0 0L10 10"']) {
      expect(out).toContain(pezzo);
    }
  });

  it("gradienti, maschere, clip e filtri sono grafica e restano", () => {
    const svg = '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><clipPath id="c"><rect width="1" height="1"/></clipPath><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><rect fill="url(#g)" clip-path="url(#c)" filter="url(#f)"/></svg>';
    const out = sanitizeSvg(svg);
    for (const pezzo of ["<linearGradient", "<stop", "<clipPath", "<feGaussianBlur", 'fill="url(#g)"']) {
      expect(out).toContain(pezzo);
    }
  });

  it("lavora insieme a parseSvg e applyStateColor come prima", () => {
    const svg = '<svg viewBox="0 0 10 10"><rect id="a" fill="#000"/><script>x()</script></svg>';
    const { viewBox, inner } = parseSvg(sanitizeSvg(svg));
    expect(viewBox).toBe("0 0 10 10");
    const colored = applyStateColor(inner, ["a"], "#0f0");
    expect(colored).toContain('fill="#0f0"');
    expect(esegue(colored)).toBe(false);
  });

  it("markup rotto non fa passare niente di eseguibile", () => {
    // parsererror → ripiego regex, che deve comunque togliere il pericoloso.
    expect(esegue(sanitizeSvg('<svg><rect onload="alert(1)"><script>x</script>'))).toBe(false);
  });
});

/* Pre-paint del tema: data-theme dalla preferenza salvata (predefinito: segue il
   sistema) prima che React e il marchio partano, così non c'è il lampo scuro/chiaro.
   Rispecchia src/theme.ts resolveMode(). È un file e non uno script in linea dal
   17-10-2026: la Content-Security-Policy (`script-src 'self'`) blocca gli script in
   linea. Caricato in modo sincrono nell'<head>, gira comunque prima del primo disegno. */
(function () {
  try {
    var m = localStorage.getItem("sws.theme") || "system";
    var dark = m === "dark" || (m !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.style.setProperty("color-scheme", dark ? "dark" : "light");
  } catch (e) {}
})();

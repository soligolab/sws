/* Registra il service worker del viewer. Un file e non uno script in linea dal
   17-10-2026, per la Content-Security-Policy (`script-src 'self'`). */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}

/* Registra il service worker del viewer. Un file e non uno script in linea dal
   17-10-2026, per la Content-Security-Policy (`script-src 'self'`). */
/* Non sullo schermo di un pannello aperto dal cloud (29-10-2026): `/sw.js`
   starebbe alla radice di sws.soligo.net, e un service worker registrato lì
   governerebbe tutto il sito, IDE compreso. */
if ("serviceWorker" in navigator && location.pathname.indexOf("/schermo/") !== 0) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}

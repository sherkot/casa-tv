/*
 * Avvio della schermata Casa.
 *
 * Questo file viene caricato in due modi:
 *  - dalla TV, tramite il modulo TizenBrew (app/index.html), che imposta window.CASA_BASE
 *    all'indirizzo GitHub Pages: la schermata gira così dentro il modulo e può usare
 *    le API della TV (aprire app, tasti del telecomando);
 *  - dal browser del computer, tramite docs/index.html, con CASA_BASE vuoto (percorsi relativi).
 *
 * Cosa fa: scarica corpo.html (la struttura della pagina), lo inserisce nel documento,
 * poi carica style.css e app.js. Tutto con un parametro v=… sempre nuovo,
 * così la cache della TV non trattiene mai la versione vecchia.
 */
(function () {
  "use strict";

  var BASE = window.CASA_BASE || "";
  var v = Date.now();

  /**
   * Aggiunge al documento il foglio di stile della schermata.
   */
  function caricaStile() {
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = BASE + "style.css?v=" + v;
    document.head.appendChild(l);
  }

  /**
   * Aggiunge al documento il codice dei widget (app.js).
   * Viene caricato per ultimo, quando la struttura della pagina è già al suo posto.
   */
  function caricaCodice() {
    var s = document.createElement("script");
    s.src = BASE + "app.js?v=" + v;
    document.body.appendChild(s);
  }

  /**
   * Scarica corpo.html e lo mette nel body al posto del messaggio di caricamento.
   * Se la rete non risponde, lo segnala al caricatore (window.CASA_ERRORE) che riprova.
   */
  function caricaCorpo() {
    var x = new XMLHttpRequest();
    x.open("GET", BASE + "corpo.html?v=" + v, true);
    x.timeout = 10000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 400) {
        document.body.innerHTML = x.responseText;
        caricaCodice();
      } else if (window.CASA_ERRORE) {
        window.CASA_ERRORE("corpo.html HTTP " + x.status);
      }
    };
    x.onerror = x.ontimeout = function () {
      if (window.CASA_ERRORE) { window.CASA_ERRORE("rete assente"); }
    };
    x.send();
  }

  caricaStile();
  caricaCorpo();
})();

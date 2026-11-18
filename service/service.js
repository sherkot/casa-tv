/*
 * Servizio del modulo "Casa" per TizenBrew.
 *
 * Perché esiste: dentro TizenBrew la pagina del modulo NON ha accesso alle API
 * della TV (window.tizen non c'è). TizenBrew però esegue questo file nel suo
 * Node.js, in un ambiente separato a cui passa l'oggetto `tizen`. Il servizio
 * fa quindi da ponte: apre un piccolo server HTTP solo su 127.0.0.1 (non è
 * raggiungibile dalla rete di casa) e la pagina gli chiede di elencare e
 * aprire le app della TV.
 *
 * Limiti dell'ambiente: il Node di TizenBrew è vecchio (4.x), quindi solo
 * JavaScript ES5 (niente let/const, frecce, template string) e solo moduli
 * interni di Node.
 *
 * Indirizzi:
 *   GET /stato          → { ok, versione, tizen }
 *   GET /app            → { app: [ { id, name, show, icona } ] }
 *   GET /apri?id=ID     → apre l'app indicata
 *   GET /icona?id=ID    → l'icona dell'app (immagine)
 */
(function () {
  "use strict";

  var http = require("http");
  var fs = require("fs");
  var urlLib = require("url");

  var PORTA = 8187;
  var VERSIONE = "1";
  var CACHE_MS = 60000;

  var haTizen = typeof tizen !== "undefined" && !!tizen && !!tizen.application;
  var cache = null;
  var cacheQuando = 0;

  /**
   * Invia una risposta JSON. Aggiunge l'intestazione CORS perché la pagina
   * gira su un'altra porta (8081, quella di TizenBrew) e senza questa il
   * browser della TV bloccherebbe la lettura della risposta.
   */
  function invia(res, stato, corpo) {
    res.writeHead(stato, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(corpo));
  }

  /**
   * Usata da /app e /apri: accetta la richiesta solo se ha un'intestazione
   * Origin di una pagina servita in locale (TizenBrew su 127.0.0.1 o
   * localhost). La pagina del modulo chiama il servizio su un'altra porta,
   * quindi il browser invia sempre Origin. Le richieste senza Origin (per
   * esempio un <img> in una pagina web qualsiasi aperta sulla TV) vengono
   * rifiutate, così nessun sito può aprire app. /stato e /icona non passano
   * da qui: restano accessibili anche senza Origin perché non cambiano nulla.
   */
  function origineAmmessa(req) {
    var o = req.headers.origin || "";
    return o !== "" && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o);
  }

  /**
   * Restituisce l'elenco delle app installate, tenendolo in memoria per un
   * minuto per non interrogare la TV a ogni richiesta. Chiama fatto(errore, lista).
   */
  function elencoApp(fatto) {
    if (!haTizen) { return fatto("API tizen non disponibile", []); }
    if (cache && Date.now() - cacheQuando < CACHE_MS) { return fatto(null, cache); }
    try {
      tizen.application.getAppsInfo(function (infos) {
        cache = (infos || []).map(function (a) {
          return { id: a.id, name: a.name, show: a.show !== false, iconPath: a.iconPath || "" };
        });
        cacheQuando = Date.now();
        fatto(null, cache);
      }, function (e) {
        fatto((e && e.message) || "errore getAppsInfo", []);
      });
    } catch (e) {
      fatto(e.message, []);
    }
  }

  /**
   * Cerca un'app nell'elenco in memoria a partire dal suo ID.
   */
  function trovaPerId(lista, id) {
    for (var i = 0; i < lista.length; i++) { if (lista[i].id === id) { return lista[i]; } }
    return null;
  }

  var server = http.createServer(function (req, res) {
    var u = urlLib.parse(req.url, true);
    var percorso = u.pathname;

    if (req.method === "OPTIONS") { return invia(res, 204, {}); }

    if (percorso === "/stato") {
      return invia(res, 200, { ok: true, versione: VERSIONE, tizen: haTizen });
    }

    if (percorso === "/app") {
      if (!origineAmmessa(req)) { return invia(res, 403, { errore: "origine non ammessa" }); }
      return elencoApp(function (err, lista) {
        if (err) { return invia(res, 500, { errore: err }); }
        invia(res, 200, {
          app: lista.map(function (a) { return { id: a.id, name: a.name, show: a.show, icona: !!a.iconPath }; })
        });
      });
    }

    if (percorso === "/apri") {
      if (!origineAmmessa(req)) { return invia(res, 403, { errore: "origine non ammessa" }); }
      var id = String(u.query.id || "");
      if (!id) { return invia(res, 400, { errore: "manca id" }); }
      if (!haTizen) { return invia(res, 500, { errore: "API tizen non disponibile" }); }
      try {
        tizen.application.launch(id, function () {
          invia(res, 200, { ok: true });
        }, function (e) {
          invia(res, 500, { errore: (e && e.message) || "apertura non riuscita" });
        });
      } catch (e) {
        invia(res, 500, { errore: e.message });
      }
      return;
    }

    if (percorso === "/icona") {
      return elencoApp(function (err, lista) {
        var app = trovaPerId(lista, String(u.query.id || ""));
        if (err || !app || !app.iconPath) { res.writeHead(404); return res.end(); }
        var file = app.iconPath.replace(/^file:\/\//, "");
        fs.readFile(file, function (e, dati) {
          if (e) { res.writeHead(404); return res.end(); }
          var tipo = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
          res.writeHead(200, { "Content-Type": tipo, "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400" });
          res.end(dati);
        });
      });
    }

    invia(res, 404, { errore: "indirizzo sconosciuto" });
  });

  // Se la porta è già occupata (servizio già avviato), non fa nulla.
  server.on("error", function () {});
  server.listen(PORTA, "127.0.0.1");

  // Solo per le prove sul computer: TizenBrew non legge module.exports.
  if (typeof module !== "undefined" && module) { module.exports = { server: server, PORTA: PORTA }; }
})();

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
 *   GET /icona?id=ID    → l'icona dell'app (immagine). Se la TV indica
 *                         l'icona generica (la "girandola" condivisa da più app)
 *                         o nessuna, il servizio cerca l'icona vera dentro la
 *                         cartella di installazione dell'app.
 */
(function () {
  "use strict";

  var http = require("http");
  var fs = require("fs");
  var urlLib = require("url");

  var PORTA = 8187;
  var VERSIONE = "2";
  var CACHE_MS = 60000;

  var haTizen = typeof tizen !== "undefined" && !!tizen && !!tizen.application;
  var cache = null;
  var cacheQuando = 0;
  var iconeTrovate = {};   // id app → percorso dell'icona scelta ("" se nessuna)
  var CARTELLE_APP = ["/opt/usr/globalapps/", "/usr/apps/", "/opt/usr/apps/", "/opt/usr/home/owner/apps_rw/"];

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
   * Usata da /app e /apri: accetta solo richieste che dichiarano un Origin
   * locale (pagine servite da TizenBrew su 127.0.0.1 o localhost). Le richieste
   * senza Origin vengono rifiutate, così una pagina web qualsiasi aperta nel
   * browser della TV non può aprire app (per esempio con un'immagine nascosta).
   * /stato e /icona non usano questo controllo perché non cambiano nulla.
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
        // Conta quante app indicano lo stesso file di icona: se è condiviso,
        // è l'icona generica di Samsung e non quella vera dell'app.
        var uso = {};
        (infos || []).forEach(function (a) { if (a.iconPath) { uso[a.iconPath] = (uso[a.iconPath] || 0) + 1; } });
        cache = (infos || []).map(function (a) {
          return {
            id: a.id,
            name: a.name,
            show: a.show !== false,
            iconPath: a.iconPath || "",
            packageId: a.packageId || String(a.id).split(".")[0],
            generica: !!(a.iconPath && uso[a.iconPath] > 1)
          };
        });
        iconeTrovate = {};
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

  /**
   * Dà un punteggio a un file immagine trovato nella cartella di un'app, per
   * scegliere quello che più probabilmente è la sua icona: premia i nomi con
   * "icon" o "logo" e le cartelle shared/res (dove Tizen tiene le icone),
   * penalizza sfondi, banner e schermate, a parità preferisce i file più grandi.
   */
  function punteggioIcona(percorso, dimensione) {
    var n = percorso.toLowerCase();
    var p = Math.min(dimensione, 400000) / 1000;
    if (/icon|logo/.test(n)) { p += 500; }
    if (/\/shared\/res\//.test(n)) { p += 200; }
    if (/splash|background|bg_|banner|preview|screenshot/.test(n)) { p -= 800; }
    return p;
  }

  /**
   * Cerca l'icona vera di un'app nella sua cartella di installazione,
   * scendendo al massimo di 4 livelli. Legge solo i nomi dei file e le loro
   * dimensioni, e solo dentro le cartelle delle app. Chiama fatto(percorso o null).
   */
  function cercaIconaNellaCartella(pacchetto, fatto) {
    if (!pacchetto || !/^[A-Za-z0-9_.-]{2,80}$/.test(pacchetto)) { return fatto(null); }
    var migliore = null, punti = -Infinity, inCorso = 0, chiuso = false;
    function forseFinito() { if (!chiuso && inCorso === 0) { chiuso = true; fatto(migliore); } }
    function esplora(cartella, livello) {
      inCorso++;
      fs.readdir(cartella, function (err, nomi) {
        if (!err && nomi) {
          nomi.forEach(function (nome) {
            if (nome.charAt(0) === ".") { return; }
            var pieno = cartella + "/" + nome;
            inCorso++;
            fs.stat(pieno, function (e2, st) {
              if (!e2 && st) {
                if (st.isDirectory() && livello < 4 && !/node_modules|locale/i.test(nome)) {
                  esplora(pieno, livello + 1);
                } else if (st.isFile() && /\.(png|jpe?g|webp)$/i.test(nome) && st.size > 1500 && st.size < 2000000) {
                  var pt = punteggioIcona(pieno, st.size);
                  if (pt > punti) { punti = pt; migliore = pieno; }
                }
              }
              inCorso--;
              forseFinito();
            });
          });
        }
        inCorso--;
        forseFinito();
      });
    }
    var i = 0;
    (function prossimaRadice() {
      if (i >= CARTELLE_APP.length) { forseFinito(); return; }
      var dir = CARTELLE_APP[i++] + pacchetto;
      fs.stat(dir, function (e, st) {
        if (!e && st && st.isDirectory()) { esplora(dir, 0); return; }
        prossimaRadice();
      });
    })();
  }

  /**
   * Trova il file dell'icona di un'app: usa quello indicato dalla TV se esiste
   * e non è l'icona generica, altrimenti lo cerca nella cartella dell'app.
   * Ricorda il risultato per non ripetere la ricerca. Chiama fatto(percorso o null).
   */
  function iconaDellApp(app, fatto) {
    if (iconeTrovate[app.id] !== undefined) { return fatto(iconeTrovate[app.id] || null); }
    var indicata = String(app.iconPath || "").replace(/^file:\/\//, "");
    function cerca() {
      cercaIconaNellaCartella(app.packageId, function (trovata) {
        iconeTrovate[app.id] = trovata || "";
        fatto(trovata || null);
      });
    }
    if (!indicata || app.generica) { return cerca(); }
    fs.stat(indicata, function (e, st) {
      if (!e && st && st.isFile() && st.size > 200) { iconeTrovate[app.id] = indicata; return fatto(indicata); }
      cerca();
    });
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
          app: lista.map(function (a) { return { id: a.id, name: a.name, show: a.show, icona: true }; })
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
        var app = err ? null : trovaPerId(lista, String(u.query.id || ""));
        if (!app) { res.writeHead(404); return res.end(); }
        iconaDellApp(app, function (file) {
          if (!file) { res.writeHead(404); return res.end(); }
          fs.readFile(file, function (e, dati) {
            if (e) { res.writeHead(404); return res.end(); }
            var tipo = /\.jpe?g$/i.test(file) ? "image/jpeg" : (/\.webp$/i.test(file) ? "image/webp" : "image/png");
            res.writeHead(200, { "Content-Type": tipo, "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400" });
            res.end(dati);
          });
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

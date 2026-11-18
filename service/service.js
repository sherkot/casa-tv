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
 *   GET /stato          → { ok, versione, tizen, guardiano }
 *   GET /app            → { app: [ { id, name, show, icona } ] }
 *   GET /apri?id=ID     → apre l'app indicata; con &torna=1 riapre Casa quando
 *                         l'app viene chiusa
 *   GET /osserva?self=1 → riapre Casa quando si chiude TizenBrew stesso (serve
 *                         quando Casa passa la finestra a TizenTube)
 *   GET /osserva?stop=1 → Casa è di nuovo a schermo: smette di osservare
 *   GET /icona?id=ID    → l'icona dell'app (immagine). Se la TV indica
 *                         l'icona generica (la "girandola", riconosciuta anche
 *                         quando è copiata in più cartelle) o nessuna, il servizio
 *                         cerca l'icona vera nella cartella dell'app e poi, per
 *                         nome, nelle cartelle condivise della TV.
 */
(function () {
  "use strict";

  var http = require("http");
  var fs = require("fs");
  var urlLib = require("url");

  var PORTA = 8187;
  var VERSIONE = "6";
  // Tag con cui questo modulo è installato in TizenBrew: va aggiornato a ogni nuovo tag v….
  var TAG_MODULO = "v0.7.1";
  var CACHE_MS = 60000;

  var haTizen = typeof tizen !== "undefined" && !!tizen && !!tizen.application;
  var cache = null;
  var cacheQuando = 0;
  var iconeTrovate = {};   // id app → percorso dell'icona scelta ("" se nessuna)
  var CARTELLE_APP = ["/opt/usr/globalapps/", "/usr/apps/", "/opt/usr/apps/", "/opt/usr/home/owner/apps_rw/"];
  // Cartelle condivise in cui alcune app di sistema (es. Netflix) tengono le icone.
  // Esclusa di proposito la cartella dei dati dell'utente della TV: lì non ci sono
  // icone di app e non deve essere letta.
  var CARTELLE_CONDIVISE = ["/opt/share", "/opt/usr/share", "/usr/share",
                            "/opt/usr/globalapps", "/usr/apps", "/opt/usr/apps", "/opt/usr/home/owner/apps_rw"];
  var dimensioniGeneriche = {};  // dimensione in byte → true se è quella dell'icona generica

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
        segnaIconeGeneriche(cache, function () { fatto(null, cache); });
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
                } else if (st.isFile() && /\.(png|jpe?g|webp)$/i.test(nome) && st.size > 1500 && st.size < 2000000 &&
                           !dimensioniGeneriche[st.size]) {
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
   * Riconosce l'icona generica di Samsung (la "girandola"). La TV a volte la
   * indica come stesso file per più app, a volte come copie identiche in
   * cartelle diverse: per questo confronta anche la dimensione dei file.
   * Se tre o più app indicano un file della stessa dimensione, quella
   * dimensione è considerata "generica" e quelle icone vengono scartate.
   * Al termine chiama fatto().
   */
  function segnaIconeGeneriche(lista, fatto) {
    var conteggio = {}, daFare = 0, chiamato = false;
    dimensioniGeneriche = {};
    function fine() {
      if (chiamato || daFare > 0) { return; }
      chiamato = true;
      Object.keys(conteggio).forEach(function (d) { if (conteggio[d] >= 3) { dimensioniGeneriche[d] = true; } });
      lista.forEach(function (a) { if (a.dimIcona && dimensioniGeneriche[a.dimIcona]) { a.generica = true; } });
      fatto();
    }
    lista.forEach(function (a) {
      var f = String(a.iconPath || "").replace(/^file:\/\//, "");
      if (!f) { return; }
      daFare++;
      fs.stat(f, function (e, st) {
        if (!e && st && st.isFile()) {
          a.dimIcona = st.size;
          conteggio[st.size] = (conteggio[st.size] || 0) + 1;
        }
        daFare--;
        fine();
      });
    });
    fine();
  }

  /**
   * Ultima possibilità: cerca nelle cartelle condivise della TV i file immagine
   * il cui percorso contiene una delle parole indicate (es. "netflix").
   * Ricerca limitata: 6 livelli, 30.000 elementi, 6 secondi. Sceglie il file
   * con il punteggio migliore, scartando l'icona generica.
   * Chiama fatto(percorso o null).
   */
  function cercaIconaPerNome(parole, fatto) {
    parole = (parole || []).filter(function (p) { return p && p.length >= 4; });
    if (!parole.length) { return fatto(null); }
    var migliore = null, punti = -Infinity, inCorso = 0, visti = 0, chiuso = false;
    var scadenza = Date.now() + 6000;
    function forseFinito() { if (!chiuso && inCorso === 0) { chiuso = true; fatto(migliore); } }
    function contieneParola(percorso) {
      var n = percorso.toLowerCase().replace(/[^a-z0-9\/]/g, "");
      for (var i = 0; i < parole.length; i++) { if (n.indexOf(parole[i]) !== -1) { return true; } }
      return false;
    }
    function esplora(cartella, livello, trovato) {
      if (visti > 30000 || Date.now() > scadenza) { return; }
      inCorso++;
      fs.readdir(cartella, function (err, nomi) {
        if (!err && nomi) {
          nomi.forEach(function (nome) {
            if (nome.charAt(0) === ".") { return; }
            visti++;
            var pieno = cartella + "/" + nome;
            var corrisponde = trovato || contieneParola(pieno);
            inCorso++;
            fs.stat(pieno, function (e2, st) {
              if (!e2 && st) {
                if (st.isDirectory() && livello < 6) {
                  esplora(pieno, livello + 1, corrisponde);
                } else if (st.isFile() && corrisponde && /\.(png|jpe?g|webp)$/i.test(nome) &&
                           st.size > 1500 && st.size < 2000000 && !dimensioniGeneriche[st.size]) {
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
    CARTELLE_CONDIVISE.forEach(function (r) { esplora(r, 0, false); });
    forseFinito();
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
        if (trovata) { iconeTrovate[app.id] = trovata; return fatto(trovata); }
        // Parole da cercare nei percorsi: nome dell'app senza spazi e simboli
        // (es. "primevideo"), la sua prima parola (es. "netflix") e il pacchetto.
        var nome = String(app.name || "").toLowerCase();
        var parole = [nome.replace(/[^a-z0-9]/g, ""), nome.split(/[^a-z0-9]+/)[0], String(app.packageId || "").toLowerCase()];
        cercaIconaPerNome(parole, function (perNome) {
          iconeTrovate[app.id] = perNome || "";
          fatto(perNome || null);
        });
      });
    }
    if (!indicata || app.generica) { return cerca(); }
    fs.stat(indicata, function (e, st) {
      if (!e && st && st.isFile() && st.size > 200) { iconeTrovate[app.id] = indicata; return fatto(indicata); }
      cerca();
    });
  }

  /* ---------------------------------------------------------------------
   * Ritorno a Casa quando si chiude un'app
   * --------------------------------------------------------------------- */

  var osservata = null;      // { id, visto, assenze, inizio, inCorso }
  var timerOsserva = null;
  var OSSERVA_OGNI = 600;    // millisecondi tra un controllo e l'altro
  var OSSERVA_MAX = 8 * 3600 * 1000;

  /**
   * Restituisce l'ID dell'app TizenBrew (quella che, riaperta, fa ripartire
   * Casa grazie all'avvio automatico), cercandola nell'elenco delle app.
   */
  function idTizenBrew() {
    var lista = cache || [];
    for (var i = 0; i < lista.length; i++) {
      if (/tizenbrew/i.test(lista[i].id) && !/service/i.test(lista[i].id)) { return lista[i].id; }
    }
    return "xvvl3S1bvH.TizenBrewStandalone";
  }

  /**
   * Interroga l'API locale della TV (porta 8001, la stessa usata per
   * leggere i dati della TV) e restituisce il corpo JSON, oppure null.
   */
  function chiediTv(percorso, fatto) {
    var finito = false;
    function fine(dati) { if (!finito) { finito = true; fatto(dati); } }
    var t = setTimeout(function () { fine(null); }, 1500);
    try {
      http.get({ host: "127.0.0.1", port: 8001, path: percorso }, function (res) {
        var corpo = "";
        res.on("data", function (c) { corpo += c; });
        res.on("end", function () {
          clearTimeout(t);
          var j = null;
          try { j = JSON.parse(corpo); } catch (e) {}
          fine(res.statusCode === 200 ? j : null);
        });
      }).on("error", function () { clearTimeout(t); fine(null); });
    } catch (e) { clearTimeout(t); fine(null); }
  }

  /**
   * Dice se l'app osservata è ancora a schermo. Prima chiede alla TV se è
   * "visible" (molte app quando le chiudi si nascondono soltanto); se la TV
   * non lo sa, guarda se l'app è ancora in esecuzione. Chiama fatto(true/false).
   */
  function appAncoraAperta(id, fatto) {
    var app = trovaPerId(cache || [], id);
    var candidati = [id];
    if (app && app.packageId && candidati.indexOf(app.packageId) < 0) { candidati.push(app.packageId); }
    (function prova(i) {
      if (i >= candidati.length) {
        try {
          tizen.application.getAppsContext(function (contesti) {
            for (var k = 0; k < contesti.length; k++) { if (contesti[k].appId === id) { return fatto(true); } }
            fatto(false);
          }, function () { fatto(true); });
        } catch (e) { fatto(true); }
        return;
      }
      chiediTv("/api/v2/applications/" + encodeURIComponent(candidati[i]), function (j) {
        if (j && typeof j.visible === "boolean") { return fatto(j.visible); }
        prova(i + 1);
      });
    })(0);
  }

  /**
   * Smette di osservare (Casa è tornata, TV spenta, tempo scaduto).
   */
  function smettiDiOsservare() {
    osservata = null;
    if (timerOsserva) { clearInterval(timerOsserva); timerOsserva = null; }
  }

  /**
   * Riapre TizenBrew (che riparte su Casa), ma solo se la TV è accesa:
   * se l'app è sparita perché hai spento la TV, non deve riaccendersi da sola.
   */
  function tornaACasa() {
    smettiDiOsservare();
    chiediTv("/api/v2/", function (j) {
      var accesa = !j || !j.device || !j.device.PowerState || j.device.PowerState === "on";
      if (!accesa) { return; }
      try { tizen.application.launch(idTizenBrew(), function () {}, function () {}); } catch (e) {}
    });
  }

  /**
   * Un controllo dell'osservazione: appena l'app risulta aperta la segna come
   * "vista"; dopo, se risulta chiusa per due controlli di fila, torna a Casa.
   */
  function controllaOsservata() {
    if (!osservata) { return smettiDiOsservare(); }
    if (Date.now() - osservata.inizio > OSSERVA_MAX) { return smettiDiOsservare(); }
    if (osservata.inCorso) { return; }
    osservata.inCorso = true;
    var o = osservata;
    appAncoraAperta(o.id, function (aperta) {
      o.inCorso = false;
      if (osservata !== o) { return; }
      if (aperta) { o.visto = true; o.assenze = 0; return; }
      if (!o.visto) {
        // L'app non è ancora comparsa: dopo 30 secondi rinuncia.
        if (Date.now() - o.inizio > 30000) { smettiDiOsservare(); }
        return;
      }
      o.assenze++;
      if (o.assenze >= 2) { tornaACasa(); }
    });
  }

  /**
   * Inizia a osservare un'app: quando verrà chiusa, la TV tornerà su Casa.
   */
  function osserva(id) {
    smettiDiOsservare();
    if (!id || !/^[A-Za-z0-9_.-]{3,80}$/.test(id)) { return; }
    osservata = { id: id, visto: false, assenze: 0, inizio: Date.now(), inCorso: false };
    timerOsserva = setInterval(controllaOsservata, OSSERVA_OGNI);
  }


  /* =====================================================================
   * Guardiano dell'accensione: riporta la TV su Casa appena la riaccendi.
   *
   * Perché qui: la regola SmartThings arriva con circa un minuto di ritardo e a
   * volte la TV non segnala proprio lo spegnimento. Questo servizio invece gira
   * sulla TV stessa, dentro il servizio di TizenBrew che resta attivo anche
   * con la TV in standby, e se ne accorge da solo in un paio di secondi.
   *
   * Come capisce che la TV è stata riaccesa (due segnali, basta uno):
   *   1. la TV dice "PowerState: standby" e poi "on" (API locale, porta 8001);
   *   2. il timer si è fermato per più di 15 secondi: in standby profondo il
   *      sistema viene congelato, quindi un "buco" vuol dire che si è appena
   *      risvegliato. Se in quel momento la TV dice ancora "standby" si aspetta
   *      che diventi "on", così non si apre niente a schermo spento.
   * ===================================================================== */
  var ID_CASA = "CasaTVmrco.Casa";
  var BATTITO_MS = 2000;
  var SALTO_MS = 15000;
  var guardiano = { ultimo: Date.now(), stato: null, rientro: false, inCorso: false, aperture: 0, ultimaApertura: 0, avvio: Date.now() };
  var registro = [];
  var mioGettone = { versione: VERSIONE };

  /**
   * Annota un evento del guardiano (al massimo gli ultimi 30), con l'ora.
   * Il registro si legge da /stato e la schermata Casa lo mostra nel pannello
   * di diagnosi: serve a capire cosa succede sulla TV quando la spegni e riaccendi.
   */
  function annota(testo) {
    var d = new Date();
    function due(n) { return (n < 10 ? "0" : "") + n; }
    registro.push(due(d.getHours()) + ":" + due(d.getMinutes()) + ":" + due(d.getSeconds()) + " " + testo);
    if (registro.length > 30) { registro.shift(); }
  }

  /**
   * Restituisce un riassunto dello stato del guardiano, mostrato da /stato
   * per controllare da fuori che stia funzionando.
   */
  function statoGuardiano() {
    return {
      attivo: !!(typeof process !== "undefined" && process && process.__casaGuardianoGettone === mioGettone),
      registro: registro,
      accensione: guardiano.stato,
      aperture: guardiano.aperture,
      ultimaApertura: guardiano.ultimaApertura ? new Date(guardiano.ultimaApertura).toISOString() : null,
      attivoDa: new Date(guardiano.avvio).toISOString()
    };
  }

  /**
   * Legge dall'API locale della TV se lo schermo è acceso ("on"), in standby
   * ("standby") oppure se la TV non lo dice (null).
   */
  function leggiAccensione(fatto) {
    chiediTv("/api/v2/", function (j) {
      var s = j && j.device && j.device.PowerState;
      fatto(s === "on" || s === "standby" ? s : null);
    });
  }

  /**
   * Apre l'app Casa. Dopo 4 secondi controlla che sia davvero a schermo: se
   * nel frattempo la TV ha rimesso davanti l'ultima app usata, la riapre una volta.
   * Non apre Casa più di una volta ogni 30 secondi.
   */
  function apriCasaDopoAccensione() {
    if (!haTizen) { return; }
    if (Date.now() - guardiano.ultimaApertura < 30000) { return; }
    guardiano.ultimaApertura = Date.now();
    guardiano.aperture++;
    smettiDiOsservare();
    var attese = [0, 2500, 5000, 9000, 14000, 20000];
    var visto = false;
    annota("riaccensione: apro Casa");
    function lancia(n) {
      try {
        tizen.application.launch(ID_CASA, function () { annota("apertura " + n + " riuscita"); },
          function (e) { annota("apertura " + n + " fallita: " + ((e && e.message) || "errore")); });
      } catch (e) { annota("apertura " + n + " errore: " + e.message); }
    }
    // Riprova per circa 20 secondi: subito dopo il risveglio la TV può rimettere
    // davanti l'ultima app usata. Smette appena la TV conferma che Casa è a schermo.
    attese.forEach(function (ms, i) {
      setTimeout(function () {
        if (visto) { return; }
        chiediTv("/api/v2/applications/" + ID_CASA, function (j) {
          if (j && j.visible === true && i > 0) { visto = true; annota("Casa a schermo"); return; }
          lancia(i + 1);
        });
      }, ms);
    });
  }

  /**
   * Un controllo del guardiano, ogni 2 secondi.
   */
  function battitoGuardiano() {
    if (process.__casaGuardianoGettone !== mioGettone) { return; }
    var ora = Date.now();
    if (ora - guardiano.ultimo > SALTO_MS) {
      guardiano.rientro = true;
      annota("risveglio dopo " + Math.round((ora - guardiano.ultimo) / 1000) + " s di pausa");
    }
    guardiano.ultimo = ora;
    if (guardiano.inCorso) { return; }
    guardiano.inCorso = true;
    leggiAccensione(function (s) {
      guardiano.inCorso = false;
      var prima = guardiano.stato;
      if (s !== guardiano.ultimoLetto) {
        annota("PowerState: " + (s === null ? "non disponibile" : s));
        guardiano.ultimoLetto = s;
      }
      if (s) { guardiano.stato = s; }
      if (s === "standby") { return; }
      if ((s === "on" && prima === "standby") || guardiano.rientro) {
        guardiano.rientro = false;
        apriCasaDopoAccensione();
      }
    });
  }

  /**
   * Fa partire il guardiano una sola volta, anche se TizenBrew avvia questo
   * servizio più volte (per esempio una versione vecchia e una nuova): il
   * segnale "già attivo" sta sull'oggetto process, comune a tutti i servizi.
   */
  function avviaGuardiano() {
    if (typeof process === "undefined" || !process) { return; }
    // Una versione più nuova prende il posto di una più vecchia (che smette da sola
    // al battito successivo); una uguale o più vecchia non parte.
    var attuale = process.__casaGuardianoGettone;
    if (attuale && Number(attuale.versione) >= Number(VERSIONE)) { return; }
    if (process.__casaGuardiano && Number(process.__casaGuardiano) >= Number(VERSIONE)) { return; }
    process.__casaGuardianoGettone = mioGettone;
    process.__casaGuardiano = VERSIONE;
    guardiano.ultimoLetto = undefined;
    annota("guardiano avviato (versione " + VERSIONE + ")");
    setInterval(battitoGuardiano, BATTITO_MS);
  }

  /**
   * Fa in modo che TizenBrew avvii questo servizio da solo ogni volta che parte:
   * nel file di configurazione di TizenBrew mette questa versione del modulo al
   * posto delle precedenti e la aggiunge ai servizi ad avvio automatico.
   * Gli altri moduli e servizi restano come sono.
   */
  function registraAvvioAutomatico() {
    var FILE = "/home/owner/share/tizenbrewConfig.json";
    var mio = "gh/sherkot/casa-tv@" + TAG_MODULO;
    var mioNome = mio.substring(mio.indexOf("/") + 1);
    function nonCasa(m) { return !/sherkot\/casa-tv/i.test(String(m)); }
    fs.readFile(FILE, "utf8", function (e, testo) {
      if (e) { return; }
      var c;
      try { c = JSON.parse(testo); } catch (x) { return; }
      var moduli = (c.modules || []).filter(nonCasa).concat([mio]);
      var servizi = (c.autoLaunchServiceList || []).filter(nonCasa).concat([mioNome]);
      if (JSON.stringify(moduli) === JSON.stringify(c.modules) &&
          JSON.stringify(servizi) === JSON.stringify(c.autoLaunchServiceList)) { return; }
      c.modules = moduli;
      c.autoLaunchServiceList = servizi;
      var tmp = FILE + ".casa-tmp";
      fs.writeFile(tmp, JSON.stringify(c, null, 4), function (err) {
        if (err) { return; }
        fs.rename(tmp, FILE, function () {});
      });
    });
  }

  var server = http.createServer(function (req, res) {
    var u = urlLib.parse(req.url, true);
    var percorso = u.pathname;

    if (req.method === "OPTIONS") { return invia(res, 204, {}); }

    if (percorso === "/stato") {
      return invia(res, 200, { ok: true, versione: VERSIONE, tizen: haTizen, porta: portaInUso, guardiano: statoGuardiano() });
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
          if (u.query.torna === "1") { osserva(id); }
          invia(res, 200, { ok: true });
        }, function (e) {
          invia(res, 500, { errore: (e && e.message) || "apertura non riuscita" });
        });
      } catch (e) {
        invia(res, 500, { errore: e.message });
      }
      return;
    }

    if (percorso === "/osserva") {
      if (!origineAmmessa(req)) { return invia(res, 403, { errore: "origine non ammessa" }); }
      if (u.query.stop === "1") { smettiDiOsservare(); }
      if (u.query.self === "1") { osserva(idTizenBrew()); }
      return invia(res, 200, { osservata: osservata ? osservata.id : null });
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

  // Se la porta è già occupata (per esempio da una versione vecchia del servizio,
  // che resta attiva finché TizenBrew non si riavvia) prova la porta successiva.
  var portaInUso = null;
  var porte = [PORTA, PORTA + 1];
  server.on("error", function () {
    porte.shift();
    if (porte.length) { try { server.listen(porte[0], "127.0.0.1"); } catch (e) {} }
  });
  server.on("listening", function () { portaInUso = porte[0]; });
  server.listen(porte[0], "127.0.0.1");

  // Il guardiano e la registrazione non dipendono dal server HTTP.
  if (haTizen) {
    avviaGuardiano();
    registraAvvioAutomatico();
  }

  // Solo per le prove sul computer: TizenBrew non legge module.exports.
  if (typeof module !== "undefined" && module) { module.exports = { server: server, PORTA: PORTA }; }
})();

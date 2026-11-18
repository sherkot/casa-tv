/*
 * Schermata Casa — logica dei widget.
 *
 * Come funziona, in breve:
 *  1. legge config.json, che dice quali widget mostrare e in quale area (sinistra, destra, basso);
 *  2. per ogni voce chiama la funzione del widget corrispondente nel registro WIDGET;
 *  3. ogni 2 minuti controlla version.json: se il numero è cambiato, ricarica la pagina,
 *     così una modifica pubblicata su GitHub arriva alla TV senza toccare il telecomando.
 *
 * Il codice è scritto in JavaScript "vecchio stile" (niente ?. o ??) perché il browser
 * della TV del 2019 è basato su una versione datata di Chromium.
 *
 * Aprendo la pagina con ?mock=1 i dati del meteo sono finti: serve per le prove dal computer.
 */
(function () {
  "use strict";

  var MOCK = /[?&]mock=1/.test(location.search);
  // Indirizzo da cui leggere config.json e version.json (vuoto = stessa cartella).
  var BASE = window.CASA_BASE || "";
  var GIORNI_BREVI = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  var GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
              "agosto", "settembre", "ottobre", "novembre", "dicembre"];

  /* =====================================================================
   * Utilità
   * ===================================================================== */

  /**
   * Scarica un file JSON aggiungendo un parametro sempre diverso all'indirizzo,
   * così la TV non usa una copia vecchia salvata in cache.
   * Restituisce una Promise con l'oggetto già convertito da testo a JSON.
   */
  function scaricaJson(url) {
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return fetch(url + sep + "v=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) { throw new Error("HTTP " + r.status + " su " + url); }
      return r.json();
    });
  }

  /**
   * Aggiunge uno zero davanti ai numeri di una cifra (7 → "07").
   * Serve per ore e minuti dell'orologio.
   */
  function dueCifre(n) { return (n < 10 ? "0" : "") + n; }

  /**
   * Crea il contenitore standard di un widget dentro l'area indicata
   * e lo restituisce, così ogni widget deve solo riempirlo.
   * conScheda = true aggiunge lo sfondo arrotondato.
   */
  function creaContenitore(area, tipo, conScheda) {
    var el = document.createElement("div");
    el.className = "widget w-" + tipo + (conScheda ? " scheda" : "");
    var dest = document.getElementById("area-" + area) || document.getElementById("area-sinistra");
    dest.appendChild(el);
    return el;
  }

  /* =====================================================================
   * Icone del meteo (SVG disegnati qui, niente immagini esterne)
   * ===================================================================== */

  var SVG_SOLE = '<g stroke="#f6bd4a" stroke-width="3.5" stroke-linecap="round">' +
    '<line x1="32" y1="6" x2="32" y2="13"/><line x1="32" y1="51" x2="32" y2="58"/>' +
    '<line x1="6" y1="32" x2="13" y2="32"/><line x1="51" y1="32" x2="58" y2="32"/>' +
    '<line x1="13.6" y1="13.6" x2="18.5" y2="18.5"/><line x1="45.5" y1="45.5" x2="50.4" y2="50.4"/>' +
    '<line x1="13.6" y1="50.4" x2="18.5" y2="45.5"/><line x1="45.5" y1="18.5" x2="50.4" y2="13.6"/>' +
    '</g><circle cx="32" cy="32" r="12" fill="#f6bd4a"/>';
  var SVG_LUNA = '<path d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z" fill="#d9e1ee"/>';
  var SVG_NUVOLA = '<path d="M20 50h27a11 11 0 0 0 0-22 15 15 0 0 0-29-3A12.5 12.5 0 0 0 20 50z" fill="#cfd7e4"/>';
  var SVG_NUVOLA_SCURA = '<path d="M20 44h27a11 11 0 0 0 0-22 15 15 0 0 0-29-3A12.5 12.5 0 0 0 20 44z" fill="#9aa6b8"/>';

  /**
   * Traduce il codice meteo WMO (quello usato da Open-Meteo) in una descrizione
   * in italiano e in un "tipo" di icona. Restituisce { testo, tipo }.
   */
  function descriviCodice(c) {
    if (c === 0) { return { testo: "Sereno", tipo: "sereno" }; }
    if (c === 1) { return { testo: "Quasi sereno", tipo: "sereno" }; }
    if (c === 2) { return { testo: "Parzialmente nuvoloso", tipo: "poco" }; }
    if (c === 3) { return { testo: "Coperto", tipo: "nuvoloso" }; }
    if (c === 45 || c === 48) { return { testo: "Nebbia", tipo: "nebbia" }; }
    if (c >= 51 && c <= 57) { return { testo: "Pioviggine", tipo: "pioggia" }; }
    if (c === 61) { return { testo: "Pioggia debole", tipo: "pioggia" }; }
    if (c === 63) { return { testo: "Pioggia", tipo: "pioggia" }; }
    if (c === 65) { return { testo: "Pioggia forte", tipo: "pioggia" }; }
    if (c === 66 || c === 67) { return { testo: "Pioggia gelata", tipo: "pioggia" }; }
    if (c === 71) { return { testo: "Neve debole", tipo: "neve" }; }
    if (c === 73) { return { testo: "Neve", tipo: "neve" }; }
    if (c === 75) { return { testo: "Neve forte", tipo: "neve" }; }
    if (c === 77) { return { testo: "Nevischio", tipo: "neve" }; }
    if (c >= 80 && c <= 82) { return { testo: c === 82 ? "Rovesci forti" : "Rovesci", tipo: "pioggia" }; }
    if (c === 85 || c === 86) { return { testo: "Rovesci di neve", tipo: "neve" }; }
    if (c === 95) { return { testo: "Temporale", tipo: "temporale" }; }
    if (c === 96 || c === 99) { return { testo: "Temporale con grandine", tipo: "temporale" }; }
    return { testo: "—", tipo: "nuvoloso" };
  }

  /**
   * Restituisce l'SVG completo dell'icona per un codice meteo.
   * giorno = false usa la luna al posto del sole per sereno e poco nuvoloso.
   */
  function icona(codice, giorno) {
    var tipo = descriviCodice(codice).tipo;
    var dentro;
    if (tipo === "sereno") {
      dentro = giorno ? SVG_SOLE : SVG_LUNA;
    } else if (tipo === "poco") {
      dentro = '<g transform="translate(-8,-8) scale(0.8)">' + (giorno ? SVG_SOLE : SVG_LUNA) + "</g>" + SVG_NUVOLA;
    } else if (tipo === "nuvoloso") {
      dentro = SVG_NUVOLA;
    } else if (tipo === "nebbia") {
      dentro = '<g stroke="#b9c2d0" stroke-width="4" stroke-linecap="round">' +
        '<line x1="10" y1="24" x2="54" y2="24"/><line x1="16" y1="34" x2="48" y2="34"/>' +
        '<line x1="10" y1="44" x2="54" y2="44"/></g>';
    } else if (tipo === "pioggia") {
      dentro = SVG_NUVOLA_SCURA + '<g stroke="#62aaff" stroke-width="3.5" stroke-linecap="round">' +
        '<line x1="22" y1="50" x2="19" y2="58"/><line x1="32" y1="50" x2="29" y2="58"/>' +
        '<line x1="42" y1="50" x2="39" y2="58"/></g>';
    } else if (tipo === "neve") {
      dentro = SVG_NUVOLA_SCURA + '<g fill="#ffffff"><circle cx="21" cy="53" r="3"/>' +
        '<circle cx="32" cy="57" r="3"/><circle cx="43" cy="53" r="3"/></g>';
    } else {
      dentro = SVG_NUVOLA_SCURA + '<path d="M34 42l-8 11h7l-4 10 12-14h-7l4-7z" fill="#f6bd4a"/>';
    }
    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' + dentro + "</svg>";
  }

  /* =====================================================================
   * Dati meteo (Open-Meteo, gratuito e senza chiave)
   * ===================================================================== */

  var meteoAscoltatori = [];
  var ultimoMeteo = null;

  /**
   * Registra una funzione che verrà chiamata ogni volta che arrivano dati meteo nuovi.
   * Se i dati ci sono già, la chiama subito. Così meteo attuale e previsioni
   * usano una sola richiesta alla rete invece di due.
   */
  function suMeteo(fn) {
    meteoAscoltatori.push(fn);
    if (ultimoMeteo) { fn(ultimoMeteo); }
  }

  /**
   * Scarica le previsioni per la città di config.json e avvisa tutti i widget interessati.
   * In modalità prova (?mock=1) usa dati finti per non dipendere dalla rete.
   */
  function aggiornaMeteo(citta) {
    var promessa;
    if (MOCK) {
      promessa = Promise.resolve(meteoFinto());
    } else {
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + citta.lat + "&longitude=" + citta.lon +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
        "&hourly=temperature_2m,precipitation_probability,weather_code,is_day" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
        "&timezone=Europe%2FRome&forecast_days=7";
      promessa = fetch(url).then(function (r) {
        if (!r.ok) { throw new Error("Meteo HTTP " + r.status); }
        return r.json();
      });
    }
    return promessa.then(function (dati) {
      ultimoMeteo = dati;
      meteoAscoltatori.forEach(function (fn) { fn(dati); });
    }).catch(function (e) {
      console.log("Meteo non disponibile: " + e.message);
    });
  }

  /**
   * Costruisce dati meteo finti ma realistici, con la stessa forma della risposta
   * di Open-Meteo. Usati solo con ?mock=1 per le prove e per le anteprime.
   */
  function meteoFinto() {
    var ora = new Date();
    ora.setMinutes(0, 0, 0);
    var hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [] };
    for (var i = 0; i < 48; i++) {
      var t = new Date(ora.getTime() + i * 3600000);
      var h = t.getHours();
      hourly.time.push(t.toISOString().slice(0, 13) + ":00");
      hourly.temperature_2m.push(Math.round(8 + 5 * Math.sin((h - 9) / 24 * 2 * Math.PI)));
      hourly.precipitation_probability.push(h > 17 ? 40 : 5);
      hourly.weather_code.push(h > 17 ? 61 : (h > 13 ? 2 : 1));
      hourly.is_day.push(h >= 7 && h < 17 ? 1 : 0);
    }
    var daily = { time: [], weather_code: [1, 61, 3, 2, 0, 80, 71], temperature_2m_max: [13, 11, 10, 12, 14, 9, 5],
                  temperature_2m_min: [4, 6, 5, 3, 2, 3, -1], precipitation_probability_max: [10, 80, 30, 10, 0, 60, 70] };
    for (var d = 0; d < 7; d++) {
      var g = new Date(ora.getTime() + d * 86400000);
      daily.time.push(g.getFullYear() + "-" + dueCifre(g.getMonth() + 1) + "-" + dueCifre(g.getDate()));
    }
    return {
      current: { temperature_2m: 12.4, apparent_temperature: 10.8, relative_humidity_2m: 71,
                 weather_code: 2, wind_speed_10m: 9.5, is_day: 1, time: hourly.time[0] },
      hourly: hourly,
      daily: daily
    };
  }

  /* =====================================================================
   * Registro dei widget
   * Per aggiungere un widget: scrivi qui una funzione con lo stesso schema
   * (riceve la sua voce di config.json e il config completo) e aggiungi
   * una voce con il suo "tipo" in config.json.
   * ===================================================================== */

  var WIDGET = {

    /**
     * Orologio grande con saluto e data in italiano.
     * Si aggiorna ogni 5 secondi (basta per i minuti e non pesa sulla TV).
     */
    orologio: function (voce) {
      var el = creaContenitore(voce.area || "sinistra", "orologio", false);
      el.innerHTML = '<p class="saluto"></p><div class="ora numeri"></div><p class="data"></p>';
      var saluto = el.querySelector(".saluto");
      var ora = el.querySelector(".ora");
      var data = el.querySelector(".data");
      function disegna() {
        var d = new Date();
        var h = d.getHours();
        saluto.textContent = h < 5 ? "Buonanotte" : (h < 13 ? "Buongiorno" : (h < 18 ? "Buon pomeriggio" : "Buonasera"));
        ora.textContent = dueCifre(h) + ":" + dueCifre(d.getMinutes());
        data.textContent = GIORNI[d.getDay()] + " " + d.getDate() + " " + MESI[d.getMonth()];
      }
      disegna();
      setInterval(disegna, 5000);
    },

    /**
     * Meteo di adesso: icona, temperatura, descrizione, temperatura percepita,
     * umidità, vento e una striscia in basso. Con "striscia": "giorni" la striscia
     * mostra i prossimi giorni (opzione "giorni", default 5); altrimenti le prossime
     * ore (opzioni "passoOre", default 2, e "quanteOre", default 6).
     */
    meteo: function (voce, config) {
      var el = creaContenitore(voce.area || "destra", "meteo", true);
      el.innerHTML = '<p class="etichetta">Meteo adesso</p><div class="vuoto">Carico il meteo…</div>';
      suMeteo(function (dati) {
        var c = dati.current;
        var info = descriviCodice(c.weather_code);
        var html = '<p class="etichetta">Meteo adesso</p>' +
          '<div class="riga"><div class="icona-grande">' + icona(c.weather_code, c.is_day === 1) + "</div>" +
          '<div><div class="temp numeri">' + Math.round(c.temperature_2m) + "°</div>" +
          '<p class="descr">' + info.testo + "</p>" +
          '<p class="citta">' + ((config.citta && config.citta.nome) || "") + "</p></div></div>" +
          '<div class="dettagli"><span>Percepita <b class="numeri">' + Math.round(c.apparent_temperature) + "°</b></span>" +
          '<span>Umidità <b class="numeri">' + Math.round(c.relative_humidity_2m) + "%</b></span>" +
          '<span>Vento <b class="numeri">' + Math.round(c.wind_speed_10m) + " km/h</b></span></div>" +
          '<div class="ore">' + (voce.striscia === "giorni"
            ? strisciaGiorni(dati.daily, voce.giorni || 5)
            : striscia(dati.hourly, voce.passoOre || 2, voce.quanteOre || 6)) + "</div>";
        el.innerHTML = html;
      });
    },

    /**
     * Previsioni dei prossimi giorni: nome del giorno, icona, massima, minima
     * e probabilità di pioggia (mostrata solo se almeno 20%).
     */
    previsioni: function (voce) {
      var el = creaContenitore(voce.area || "basso", "previsioni", true);
      el.innerHTML = '<p class="etichetta">Prossimi giorni</p><div class="vuoto">Carico le previsioni…</div>';
      suMeteo(function (dati) {
        var d = dati.daily;
        var n = Math.min(voce.giorni || 6, d.time.length);
        var html = '<p class="etichetta">Prossimi giorni</p><div class="giorni">';
        for (var i = 0; i < n; i++) {
          var parti = d.time[i].split("-");
          var giorno = new Date(+parti[0], +parti[1] - 1, +parti[2]);
          var p = d.precipitation_probability_max[i];
          html += '<div class="giorno">' +
            '<div class="nome' + (i === 0 ? " oggi" : "") + '">' + (i === 0 ? "Oggi" : GIORNI_BREVI[giorno.getDay()] + " " + giorno.getDate()) + "</div>" +
            icona(d.weather_code[i], true) +
            '<div class="numeri"><span class="max">' + Math.round(d.temperature_2m_max[i]) + '°</span>' +
            '<span class="min">' + Math.round(d.temperature_2m_min[i]) + "°</span></div>" +
            '<div class="p numeri">' + (p >= 20 ? "☂ " + p + "%" : "") + "</div></div>";
        }
        el.innerHTML = html + "</div>";
      });
    },

    /**
     * Riga di app da aprire con il telecomando.
     * In config.json ogni app si indica per "nome" (come appare sulla TV): la TV
     * cerca da sola l'ID giusto tra le app installate. Altre opzioni per ogni app:
     *  - "etichetta": testo mostrato nel riquadro, se diverso dal nome;
     *  - "cerca": lista di nomi alternativi da provare (es. ["NOW", "NOW TV"]);
     *  - "id": forza l'ID esatto (l'elenco completo si vede col tasto blu);
     *  - "modulo": apre un modulo di TizenBrew invece di un'app (es. "tizentube");
     *  - "colore": colore di sfondo del riquadro;
     *  - "icona": indirizzo di un'immagine da usare al posto dell'icona della TV;
     *  - "iconaDa": nome di un'altra app installata da cui prendere l'icona.
     *  Il "colore" si usa solo quando l'icona manca.
     */
    app: function (voce) {
      var el = creaContenitore(voce.area || "basso", "app", false);
      el.innerHTML = '<p class="etichetta"></p><div class="riquadri"></div>';
      el.querySelector(".etichetta").textContent = voce.titolo || "App";
      var contenitore = el.querySelector(".riquadri");

      elencoAppInstallate().then(function (installate) {
        (voce.app || []).forEach(function (a) {
          var trovata = a.modulo ? { modulo: a.modulo } : cercaApp(installate, a);
          var testo = a.etichetta || a.nome;
          var r = document.createElement("div");
          r.className = "riquadro tasto" + (trovata ? "" : " assente");
          var nome = document.createElement("div");
          nome.className = "nome-app";
          nome.textContent = testo;
          // Icona, in ordine di preferenza: un'immagine indicata in config.json
          // ("icona"), l'icona di un'altra app installata ("iconaDa", es. TizenTube
          // con l'icona di YouTube), l'icona dell'app stessa presa dalla TV.
          // Se non c'è o non si carica, il riquadro mostra il nome su sfondo "colore".
          var prestata = a.iconaDa ? cercaApp(installate, { nome: a.iconaDa }) : null;
          var srcIcona = a.icona || (prestata && prestata.iconPath) || (trovata && trovata.iconPath) || "";
          function senzaIcona() {
            r.className += " senza-icona";
            if (a.colore) { r.style.background = a.colore; }
          }
          if (trovata && srcIcona) {
            var img = document.createElement("img");
            img.src = srcIcona;
            img.onerror = function () { if (img.parentNode) { img.parentNode.removeChild(img); } senzaIcona(); };
            r.appendChild(img);
          } else {
            senzaIcona();
          }
          r.appendChild(nome);
          r.attivare = function () {
            if (!trovata) { avviso("Non trovo «" + testo + "» tra le app della TV (tasto blu per l'elenco)"); return; }
            if (trovata.modulo) { apriModulo(trovata.modulo, testo, a); return; }
            apriApp(trovata.id, testo);
          };
          contenitore.appendChild(r);
        });
        if (!fuoco) { metti(document.querySelector(".tasto")); }
      });
    },

    /**
     * Riquadro di testo libero: un titolo piccolo e un testo grande.
     * Utile per promemoria, frasi, avvisi di casa. Il testo si cambia in config.json.
     */
    nota: function (voce) {
      var el = creaContenitore(voce.area || "sinistra", "nota", true);
      el.innerHTML = (voce.titolo ? '<p class="etichetta"></p>' : "") + '<p class="testo"></p>';
      if (voce.titolo) { el.querySelector(".etichetta").textContent = voce.titolo; }
      el.querySelector(".testo").textContent = voce.testo || "";
    }
  };

  /**
   * Costruisce l'HTML della striscia "prossimi giorni" del widget meteo:
   * per ogni giorno nome, icona, massima/minima e pioggia (se almeno 20%).
   */
  function strisciaGiorni(daily, quanti) {
    var html = "";
    var n = Math.min(quanti, daily.time.length);
    for (var i = 0; i < n; i++) {
      var parti = daily.time[i].split("-");
      var g = new Date(+parti[0], +parti[1] - 1, +parti[2]);
      var p = daily.precipitation_probability_max[i];
      html += '<div class="ora-col"><div class="h">' + (i === 0 ? "Oggi" : GIORNI_BREVI[g.getDay()]) + "</div>" +
        icona(daily.weather_code[i], true) +
        '<div class="t numeri">' + Math.round(daily.temperature_2m_max[i]) + '° <span class="tmin">' +
        Math.round(daily.temperature_2m_min[i]) + "°</span></div>" +
        '<div class="p numeri">' + (p >= 20 ? p + "%" : "") + "</div></div>";
    }
    return html;
  }

  /**
   * Costruisce l'HTML della striscia oraria del widget meteo.
   * Parte dall'ora successiva a quella attuale e prende "quante" colonne a distanza di "passo" ore.
   */
  function striscia(hourly, passo, quante) {
    var adesso = Date.now();
    var inizio = 0;
    for (var i = 0; i < hourly.time.length; i++) {
      if (new Date(hourly.time[i]).getTime() > adesso) { inizio = i; break; }
    }
    var html = "";
    for (var k = 0; k < quante; k++) {
      var j = inizio + k * passo;
      if (j >= hourly.time.length) { break; }
      var ora = hourly.time[j].slice(11, 13);
      var p = hourly.precipitation_probability[j];
      html += '<div class="ora-col"><div class="h numeri">' + ora + ":00</div>" +
        icona(hourly.weather_code[j], hourly.is_day[j] === 1) +
        '<div class="t numeri">' + Math.round(hourly.temperature_2m[j]) + "°</div>" +
        '<div class="p numeri">' + (p >= 20 ? p + "%" : "") + "</div></div>";
    }
    return html;
  }

  /* =====================================================================
   * App della TV: elenco, ricerca per nome, apertura
   * ===================================================================== */

  /* Indirizzo del servizio del modulo (service/service.js), attivo solo sulla TV. */
  var SERVIZIO = "http://127.0.0.1:8187";
  // DIRETTA: la schermata gira dentro l'app "Casa" installata sulla TV e può usare
  // direttamente le API della TV. Altrimenti gira dentro TizenBrew (porta 8081) e
  // passa dal servizio del modulo, oppure è un'anteprima sul computer.
  var DIRETTA = !!(window.CASA_STANDALONE && window.tizen && tizen.application);
  var SULLA_TV = DIRETTA || (location.hostname === "127.0.0.1" && location.port === "8081");
  var ID_TIZENBREW = "xvvl3S1bvH.TizenBrewStandalone";

  /**
   * Chiede una risposta JSON al servizio del modulo, con un limite di tempo.
   * Restituisce una Promise che fallisce se il servizio non risponde.
   */
  function chiediServizio(percorso, attesaMs) {
    return new Promise(function (ok, ko) {
      var x = new XMLHttpRequest();
      x.open("GET", SERVIZIO + percorso, true);
      x.timeout = attesaMs || 4000;
      x.onload = function () {
        var dati = null;
        try { dati = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) { ok(dati); } else { ko(new Error((dati && dati.errore) || ("HTTP " + x.status))); }
      };
      x.onerror = function () { ko(new Error("servizio non raggiungibile")); };
      x.ontimeout = function () { ko(new Error("servizio lento")); };
      x.send();
    });
  }

  /**
   * Restituisce (in una Promise) l'elenco delle app installate sulla TV, ognuna
   * con id, name e iconPath (indirizzo dell'icona servita dal servizio).
   * Sulla TV il servizio parte insieme al modulo e può metterci qualche secondo:
   * per questo riprova fino a 6 volte. Fuori dalla TV restituisce un elenco finto.
   */
  function elencoAppInstallate() {
    if (DIRETTA) {
      // Dentro l'app Casa: chiede l'elenco direttamente alla TV. Le icone condivise
      // da più app sono l'icona generica di Samsung (la girandola) e vengono scartate.
      return new Promise(function (ok) {
        try {
          tizen.application.getAppsInfo(function (lista) {
            var uso = {};
            (lista || []).forEach(function (a) { if (a.iconPath) { uso[a.iconPath] = (uso[a.iconPath] || 0) + 1; } });
            ok((lista || []).map(function (a) {
              var icona = a.iconPath && uso[a.iconPath] === 1 ? a.iconPath : "";
              if (icona && icona.charAt(0) === "/") { icona = "file://" + icona; }
              return { id: a.id, name: a.name, show: a.show !== false, iconPath: icona };
            }));
          }, function () { ok([]); });
        } catch (e) { ok([]); }
      });
    }
    if (!SULLA_TV) {
      return Promise.resolve(["Netflix", "Prime Video", "Disney+", "RaiPlay", "Mediaset Infinity", "NOW", "YouTube", "TizenBrew"]
        .map(function (n, i) { return { id: "finto." + i, name: n, iconPath: "" }; }));
    }
    return new Promise(function (ok) {
      var tentativi = 0;
      function prova() {
        tentativi++;
        chiediServizio("/app", 5000).then(function (r) {
          ok(((r && r.app) || []).map(function (a) {
            return { id: a.id, name: a.name, show: a.show, iconPath: a.icona ? SERVIZIO + "/icona?id=" + encodeURIComponent(a.id) : "" };
          }));
        }).catch(function (e) {
          if (tentativi < 6) { setTimeout(prova, 1500); return; }
          avviso("Il servizio di Casa non risponde: " + e.message);
          ok([]);
        });
      }
      prova();
    });
  }

  /**
   * Riduce un nome a sole lettere e numeri minuscoli ("Disney+" → "disney"),
   * così il confronto tra il nome in config.json e quello della TV è tollerante.
   */
  function normalizza(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

  /**
   * Cerca un'app nell'elenco delle installate: prima per ID esatto (se indicato),
   * poi per nome identico (provando anche i nomi alternativi in "cerca"),
   * infine per nome che contiene quello cercato. Restituisce l'app o null.
   */
  function cercaApp(installate, voce) {
    var i, k;
    if (voce.id) {
      for (i = 0; i < installate.length; i++) { if (installate[i].id === voce.id) { return installate[i]; } }
    }
    var nomi = [voce.nome].concat(voce.cerca || []).map(normalizza).filter(function (n) { return n; });
    for (k = 0; k < nomi.length; k++) {
      for (i = 0; i < installate.length; i++) { if (normalizza(installate[i].name) === nomi[k]) { return installate[i]; } }
    }
    for (k = 0; k < nomi.length; k++) {
      for (i = 0; i < installate.length; i++) {
        if (normalizza(installate[i].name).indexOf(nomi[k]) !== -1) { return installate[i]; }
      }
    }
    return null;
  }

  /**
   * Apre un'app della TV dato il suo ID, passando dal servizio del modulo.
   * Fuori dalla TV mostra solo un avviso.
   */
  function apriApp(id, nome) {
    if (!SULLA_TV) { avviso("Sulla TV qui si aprirebbe " + nome); return; }
    if (DIRETTA) {
      avviso("Apro " + nome + "…");
      try {
        tizen.application.launch(id, function () {}, function (e) {
          avviso("Non riesco ad aprire " + nome + ": " + ((e && e.message) || "errore"));
        });
      } catch (e) { avviso("Errore aprendo " + nome + ": " + e.message); }
      return;
    }
    avviso("Apro " + nome + "…");
    // torna=1: quando chiudi l'app, il servizio riporta la TV su Casa.
    chiediServizio("/apri?id=" + encodeURIComponent(id) + "&torna=1", 8000).catch(function (e) {
      avviso("Non riesco ad aprire " + nome + ": " + e.message);
    });
  }

  /**
   * Dentro l'app Casa: apre TizenTube passando da TizenBrew.
   *
   * Non si chiede più a TizenBrew quale modulo aprire: le richieste dall'esterno
   * (dato di avvio, messaggi al servizio) vengono perse in modo imprevedibile da
   * TizenBrew e si finisce sulla sua home. Si usa invece il suo meccanismo
   * standard: in TizenBrew l'avvio automatico è impostato su TizenTube, quindi
   * basta aprire TizenBrew. Se TizenBrew è già aperto in sottofondo, torna davanti
   * dov'era (di solito proprio TizenTube).
   *
   * "voce" non serve più qui, ma resta come parametro per compatibilità con config.json.
   */
  function apriModuloDaApp(nome, voce) {
    avviso("Apro " + nome + "…");
    try {
      tizen.application.launch(ID_TIZENBREW, function () {}, function (e) {
        avviso("Non riesco ad aprire " + nome + ": " + ((e && e.message) || "errore"));
      });
    } catch (e) {
      avviso("Errore aprendo " + nome + ": " + e.message);
    }
  }

  /**
   * Apre un modulo di TizenBrew (per esempio TizenTube) nella stessa finestra,
   * come fa l'elenco dei moduli di TizenBrew: chiede la lista dei moduli al
   * servizio di TizenBrew (WebSocket su 127.0.0.1:8081), comunica quale modulo
   * sta partendo (così TizenBrew inietta il suo codice, es. il blocco pubblicità)
   * e poi passa all'indirizzo del modulo.
   * "cercato" è una parte del nome del modulo, es. "tizentube".
   */
  function apriModulo(cercato, nome, voce) {
    if (!SULLA_TV) { avviso("Sulla TV qui si aprirebbe " + nome); return; }
    if (DIRETTA) { apriModuloDaApp(nome, voce || {}); return; }
    var re = new RegExp(cercato, "i");
    var ws, modulo = null, chiesto = 0, finito = false;
    var timer = setTimeout(function () { fine("TizenBrew non risponde"); }, 6000);
    function fine(errore) {
      if (finito) { return; }
      finito = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      if (errore) { avviso("Non riesco ad aprire " + nome + ": " + errore); }
    }
    avviso("Apro " + nome + "…");
    try { ws = new WebSocket("ws://127.0.0.1:8081"); } catch (e) { return fine("WebSocket non disponibile"); }
    ws.onerror = function () { fine("collegamento a TizenBrew non riuscito"); };
    ws.onopen = function () { chiesto++; ws.send(JSON.stringify({ type: 4, payload: false })); };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      // Risposta di TizenBrew al lancio: per i moduli che iniettano il codice
      // all'inizio della pagina bisogna aspettare questo via libera.
      if (m.type === 5 && modulo) { clearTimeout(timer); location.href = modulo.appPath; return; }
      if (m.type !== 4 || finito || modulo) { return; }
      var lista = m.payload || [];
      if (!lista.length && chiesto < 2) { chiesto++; ws.send(JSON.stringify({ type: 4, payload: true })); return; }
      for (var i = 0; i < lista.length && !modulo; i++) {
        var x = lista[i];
        if (x && x.appPath && (re.test(x.fullName || "") || re.test(x.name || "") || re.test(x.appName || ""))) { modulo = x; }
      }
      if (!modulo) { return fine("modulo «" + cercato + "» non installato in TizenBrew"); }
      // Il modulo prenderà la finestra di TizenBrew. Prima di lasciare la pagina
      // chiede al servizio di riaprire TizenBrew (e quindi Casa) quando il modulo
      // verrà chiuso, e ASPETTA la risposta: cambiando pagina subito, la richiesta
      // verrebbe interrotta e il ritorno a Casa non scatterebbe.
      var lanciato = false;
      function lancia() {
        if (lanciato) { return; }
        lanciato = true;
        ws.send(JSON.stringify({ type: 5, payload: modulo }));
        if (!modulo.evaluateScriptOnDocumentStart) { clearTimeout(timer); location.href = modulo.appPath; }
      }
      chiediServizio("/osserva?self=1", 2000).then(lancia, lancia);
    };
  }

  /**
   * Mostra per 4 secondi un messaggio in basso al centro dello schermo.
   */
  function avviso(testo) {
    var el = document.getElementById("avviso");
    if (!el) { return; }
    el.textContent = testo;
    el.className = "visibile";
    clearTimeout(avviso.timer);
    avviso.timer = setTimeout(function () { el.className = ""; }, 4000);
  }

  /**
   * Tasto blu: mostra/nasconde un pannello con tutte le app installate e il loro ID.
   * Serve per sapere il nome esatto da scrivere in config.json.
   */
  function pannelloApp() {
    var p = document.getElementById("pannello-app");
    if (p) { p.parentNode.removeChild(p); return; }
    elencoAppInstallate().then(function (lista) {
      p = document.createElement("div");
      p.id = "pannello-app";
      var righe = lista.filter(function (a) { return a.show !== false; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
        .map(function (a) { return "<div><b></b><span></span></div>"; }).join("");
      p.innerHTML = "<h2>App installate (tasto blu per chiudere)</h2><div class=\"lista\">" + righe + "</div>";
      var ordinate = lista.filter(function (a) { return a.show !== false; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      var celle = p.querySelectorAll(".lista > div");
      for (var i = 0; i < celle.length; i++) {
        celle[i].querySelector("b").textContent = ordinate[i].name;
        celle[i].querySelector("span").textContent = ordinate[i].id;
      }
      document.body.appendChild(p);
    });
  }

  /* =====================================================================
   * Navigazione con il telecomando (frecce + OK)
   * ===================================================================== */

  var fuoco = null;

  /**
   * Sposta il "fuoco" (il riquadro evidenziato) sull'elemento indicato.
   */
  function metti(el) {
    if (!el) { return; }
    if (fuoco) { fuoco.className = fuoco.className.replace(/\s*attivo/g, ""); }
    fuoco = el;
    fuoco.className += " attivo";
  }

  /**
   * Trova il riquadro più vicino nella direzione premuta (sinistra, destra, su, giù)
   * guardando la posizione sullo schermo. Funziona con qualsiasi disposizione
   * dei widget, senza doverla descrivere a mano.
   */
  function muovi(dx, dy) {
    var tasti = document.querySelectorAll(".tasto");
    if (!fuoco) { metti(tasti[0]); return; }
    var a = fuoco.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var migliore = null, punteggio = Infinity;
    for (var i = 0; i < tasti.length; i++) {
      if (tasti[i] === fuoco) { continue; }
      var b = tasti[i].getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var lungo = dx ? (bx - ax) * dx : (by - ay) * dy;
      if (lungo <= 0) { continue; }
      var largo = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
      var p = lungo + largo * 2;
      if (p < punteggio) { punteggio = p; migliore = tasti[i]; }
    }
    if (migliore) { metti(migliore); }
  }

  /**
   * Gestione dei tasti: frecce per muoversi, OK per aprire,
   * rosso per ricaricare la schermata, blu per l'elenco delle app.
   */
  document.addEventListener("keydown", function (e) {
    switch (e.keyCode) {
      case 37: muovi(-1, 0); break;
      case 39: muovi(1, 0); break;
      case 38: muovi(0, -1); break;
      case 40: muovi(0, 1); break;
      case 13: if (fuoco && fuoco.attivare) { fuoco.attivare(); } break;
      case 403: location.reload(); break;
      case 406: pannelloApp(); break;
      default: return;
    }
    e.preventDefault();
  });

  /* =====================================================================
   * Aggiornamento automatico quando pubblichi una nuova versione
   * ===================================================================== */

  /**
   * Legge version.json all'avvio e poi ogni 2 minuti.
   * Se il valore "versione" cambia, ricarica la pagina: il caricatore riscarica
   * tutto con parametri nuovi, quindi la cache della TV non trattiene la versione vecchia.
   */
  function controllaVersioni() {
    var iniziale = null;
    function controlla() {
      scaricaJson(BASE + "version.json").then(function (v) {
        if (iniziale === null) { iniziale = v.versione; return; }
        if (v.versione !== iniziale) {
          location.reload();
        }
      }).catch(function () { /* rete assente: si riprova al giro dopo */ });
    }
    controlla();
    setInterval(controlla, 120000);
  }

  /**
   * Mostra in basso a destra l'ora dell'ultimo caricamento della pagina.
   * Serve a capire a colpo d'occhio se la TV ha preso l'ultima versione.
   */
  function mostraAggiornato() {
    var d = new Date();
    var el = document.createElement("div");
    el.className = "aggiornato numeri";
    el.textContent = "aggiornata alle " + dueCifre(d.getHours()) + ":" + dueCifre(d.getMinutes());
    document.body.appendChild(el);
  }

  /**
   * Punto di partenza: legge la configurazione, crea i widget nell'ordine indicato,
   * avvia il meteo (ogni 15 minuti) e il controllo delle nuove versioni.
   */
  function avvia() {
    // Casa è di nuovo a schermo: il servizio può smettere di osservare l'app di prima.
    if (SULLA_TV && !DIRETTA) { chiediServizio("/osserva?stop=1", 3000).catch(function () {}); }
    scaricaJson(BASE + "config.json").then(function (config) {
      (config.widgets || []).forEach(function (voce) {
        var fn = WIDGET[voce.tipo];
        if (fn) {
          try { fn(voce, config); } catch (e) { console.log("Widget " + voce.tipo + ": " + e.message); }
        } else {
          console.log("Widget sconosciuto: " + voce.tipo);
        }
      });
      if (config.citta) {
        aggiornaMeteo(config.citta);
        setInterval(function () { aggiornaMeteo(config.citta); }, 15 * 60000);
      }
      mostraAggiornato();
      controllaVersioni();
    }).catch(function (e) {
      document.getElementById("area-sinistra").innerHTML =
        '<div class="vuoto">Non riesco a leggere config.json (' + e.message + ")</div>";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", avvia);
  } else {
    avvia();
  }
})();

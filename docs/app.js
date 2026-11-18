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
     * umidità, vento e una striscia con le prossime ore (ogni 2 ore).
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
          '<div class="ore">' + striscia(dati.hourly, voce.passoOre || 2, voce.quanteOre || 6) + "</div>";
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
   * Aggiornamento automatico quando pubblichi una nuova versione
   * ===================================================================== */

  /**
   * Legge version.json all'avvio e poi ogni 2 minuti.
   * Se il valore "versione" cambia, ricarica la pagina con un indirizzo nuovo
   * (così la cache della TV non può trattenere la versione vecchia).
   */
  function controllaVersioni() {
    var iniziale = null;
    function controlla() {
      scaricaJson("version.json").then(function (v) {
        if (iniziale === null) { iniziale = v.versione; return; }
        if (v.versione !== iniziale) {
          location.replace(location.pathname + "?v=" + Date.now() + (MOCK ? "&mock=1" : ""));
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
    scaricaJson("config.json").then(function (config) {
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

# Casa — schermata per la TV Samsung

Schermata personale per la TV Samsung (Q60R, Tizen 5.0), caricata come modulo **TizenBrew**:
orologio, meteo di Reggio Emilia, promemoria e previsioni dei prossimi giorni.

## Come è fatta

| Parte | Cosa fa | Si modifica? |
|---|---|---|
| `package.json` | Manifesto del modulo TizenBrew (`packageType: app`, `serviceFile`) | Quasi mai |
| `service/service.js` | Servizio che TizenBrew esegue nel suo Node: la pagina del modulo non ha le API della TV, il servizio sì. Ascolta solo su `127.0.0.1:8187` e serve elenco app, apertura app e icone | Raramente (ES5, Node 4) |
| `app/index.html` | Caricatore: scarica da GitHub Pages `avvio.js`, che inserisce nella pagina struttura (`corpo.html`), stile e widget. Così la schermata gira dentro il modulo e può aprire app e ricevere i tasti | No, solo `REMOTE_BASE` la prima volta |
| `docs/config.json` | Quali widget mostrare, in che area e con che testi | **Sì, qui si cambia la schermata** |
| `docs/app.js` | Codice dei widget (registro `WIDGET`) | Per aggiungere widget nuovi |
| `docs/style.css` | Aspetto | Per cambiare colori e dimensioni |
| `docs/version.json` | Numero di versione | Va aumentato a ogni modifica |

La TV controlla `docs/version.json` ogni 2 minuti: quando il numero cambia, ricarica la schermata da sola.

## Widget disponibili

- `orologio`: saluto, ora e data.
- `meteo`: meteo adesso più una striscia in basso. Con `"striscia": "giorni"` mostra i prossimi giorni (`giorni`, default 5), altrimenti le prossime ore (`passoOre`, default 2; `quanteOre`, default 6).
- `previsioni`: prossimi giorni. Opzione: `giorni` (default 6).
- `nota`: testo libero. Opzioni: `titolo`, `testo`.
- `app`: riga di app da aprire col telecomando. Opzioni: `titolo`, `app`, una lista in cui ogni voce ha:
  - `nome`: il nome dell'app come appare sulla TV (obbligatorio);
  - `etichetta`: testo del riquadro, se diverso dal nome;
  - `cerca`: nomi alternativi da provare, es. `["NOW TV", "NOWTV"]`;
  - `id`: ID esatto, solo se il nome è ambiguo (tasto blu per l'elenco);
  - `modulo`: apre un modulo TizenBrew invece di un'app, es. `"tizentube"`;
  - `colore`: colore di sfondo del riquadro;
  - `icona`: indirizzo di un'immagine da usare al posto dell'icona fornita dalla TV;
  - `iconaDa`: nome di un'altra app installata da cui prendere l'icona (TizenTube usa quella di YouTube).

Le icone sono quelle installate sulla TV. Se la TV indica l'icona generica di Samsung (la girandola), il servizio cerca l'icona vera nella cartella dell'app. Se non trova nulla, il riquadro mostra il nome sullo sfondo `colore`.

### Aggiungere un'app

1. Sulla TV, nella schermata Casa, premi il tasto blu e leggi il nome esatto dell'app.
2. In `docs/config.json` aggiungi una voce alla lista `app`, per esempio `{ "nome": "DAZN" }`.
3. Aumenta di 1 il numero in `docs/version.json` e pubblica: entro 2 minuti la TV si aggiorna da sola.

## Ritorno a Casa

Quando apri un'app dalla schermata, il servizio la osserva: appena la chiudi, riapre TizenBrew, che riparte su Casa. Se invece hai spento la TV, non riapre niente. Con "Esegui automaticamente l'ultima applicazione" attivo nelle impostazioni della TV, alla riaccensione si ritrova Casa.

## Telecomando

- Frecce: spostano il riquadro evidenziato. OK: apre l'app.
- Tasto rosso: ricarica la schermata.
- Tasto blu: mostra/nasconde l'elenco di tutte le app installate con il loro ID.

Ogni widget accetta `area`: `sinistra`, `destra` o `basso`.

## Pubblicazione

1. Repository **pubblico** su GitHub chiamato `casa-tv` (TizenBrew e GitHub Pages leggono solo repository pubblici).
2. GitHub Pages attivo sul ramo `main`, cartella `/docs`.
3. In `app/index.html` sostituire `__GITHUB_USER__` con il proprio utente GitHub.
4. Sulla TV: TizenBrew → gestione moduli (tasto verde) → aggiungi il modulo GitHub `UTENTE/casa-tv@main`.
5. In TizenBrew, nelle impostazioni, scegliere **Casa** come modulo ad avvio automatico.

## Prova dal computer

```
cd docs && python3 -m http.server 8765
```

Poi aprire `http://localhost:8765/index.html?mock=1` (meteo finto, niente rete).

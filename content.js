/*
 * Segnalibro notizie — content script generico (multi-sito).
 * La configurazione del sito arriva da sites.js (caricato prima di questo file).
 *
 * Logica del segnalibro — DOPPIO SEGNALIBRO (registro a scorrimento), uguale per ogni sito:
 *  - PRIMA VOLTA -> marker = pending = ultima notizia attuale.
 *  - Caricamento successivo (apertura O refresh: è la stessa cosa), SE nella visita
 *    precedente il segnalibro era stato RAGGIUNTO (visto nel viewport) -> avanza di un passo:
 *      marker = pending precedente; pending = ultima notizia attuale.
 *  - Se invece il segnalibro NON era mai stato raggiunto (es. oltre il lazy-load) ->
 *      marker RESTA FERMO; si aggiorna solo pending. Così l'ultima letta vera non si
 *      perde mai, anche se sta molti scroll più in basso.
 *
 * Per sito:
 *   marker  = notizia evidenziata ora (1° segnalibro)
 *   pending = ultima notizia vista al caricamento precedente (2° segnalibro)
 *   reached = flag: in questa visita l'utente è arrivato a vedere il marker
 */

(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const site = findSiteForUrl(location.href);

  // Log diagnostico: conferma che il content script è iniettato e su quale sito.
  try {
    console.log(
      "[Segnalibro] content script attivo:",
      site ? site.id : "(sito non configurato)",
      "·",
      location.pathname
    );
  } catch (e) {}

  let state = { markerKey: null };
  let lastStatus = { onHome: false, siteName: site ? site.name : null };

  // Chiavi di storage separate per ogni sito.
  const K = site
    ? {
        marker: "marker_" + site.id,
        pending: "pending_" + site.id,
        init: "initialized_" + site.id,
        reached: "reached_" + site.id,
        seek: "seek_" + site.id,
        count: "count_" + site.id,
        rescroll: "rescroll_" + site.id,
      }
    : null;

  let idRe = null;
  if (site && site.idRegex) {
    try {
      idRe = new RegExp(site.idRegex);
    } catch (e) {
      idRe = null;
    }
  }

  // -------- utilità --------

  function isHome() {
    return isSiteHome(site, location.href);
  }

  // Caricamento che NON è una visita nuova: il segnalibro non deve avanzare.
  // Due casi, stesso trattamento, riconosciuti da un marcatore nella query string:
  //
  //  a) il SITO si ricarica da solo (site.autoRefreshParam). hdblog ricarica la
  //     home ogni 777s via <meta http-equiv="refresh"> verso "/?refresh_ce", e la
  //     pagina di arrivo ripete il tag: il ciclo va avanti finché la scheda resta
  //     aperta.
  //  b) ricarichiamo NOI su richiesta dell'utente (KEEP_PARAM, "Ricarica pulita"
  //     nel popup). Serve contro i doppioni: la paginazione del lazy-load di
  //     hdblog è a OFFSET sulla lista viva, quindi ogni notizia pubblicata mentre
  //     leggi fa scalare di una posizione i blocchi successivi e ripete le ultime
  //     già in pagina. Ricaricare rende di nuovo tutto in un'istantanea coerente,
  //     ma l'utente non deve pagarlo con la posizione di lettura.
  //
  // Serve un marcatore nell'URL perché il tipo di navigazione non basta: il reload
  // fatto dal sito, il nostro e l'F5 dell'utente sono indistinguibili (è il motivo
  // per cui getNavType fu rimosso in v0.0.8). Corollario: l'F5 che l'utente preme
  // da sé resta una visita vera — per non spostare il segnalibro deve passare dal
  // pulsante, che è l'unico modo che abbiamo di riconoscere la ricarica.
  const KEEP_PARAM = "hdbkeep";

  function sameVisitParams() {
    const out = [KEEP_PARAM];
    if (site && site.autoRefreshParam) out.push(site.autoRefreshParam);
    return out;
  }

  function detectSameVisitLoad() {
    if (!site) return false;
    try {
      const q = new URLSearchParams(location.search);
      return sameVisitParams().some((p) => q.has(p));
    } catch (e) {
      return false;
    }
  }

  // Quale dei due marcatori ci ha portato qui: per il segnalibro sono equivalenti,
  // ma il ritorno automatico all'ultima letta deve scattare SOLO dopo la nostra
  // "Ricarica pulita", mai su un refresh automatico del sito (che arriva da solo
  // ogni ~13 minuti e non deve muovere la pagina sotto l'utente — è il sintomo del
  // bug #9). Distinguerli è anche l'unico modo perché un flag rescroll rimasto
  // appeso non venga raccolto dal primo auto-refresh che passa.
  function detectKeepLoad() {
    if (!site) return false;
    try {
      return new URLSearchParams(location.search).has(KEEP_PARAM);
    } catch (e) {
      return false;
    }
  }

  // I parametri vanno letti UNA VOLTA sola, prima di ripulire l'URL: da qui in poi
  // valgono queste costanti, non location.search.
  const sameVisitLoad = detectSameVisitLoad();
  const keepLoad = detectKeepLoad();

  // ...e subito dopo i marcatori vanno TOLTI dall'URL. Se restano, la barra degli
  // indirizzi si "incolla" su https://www.hdblog.it/?refresh_ce e ogni caricamento
  // successivo — compreso l'F5 dell'utente — sembra automatico: il segnalibro non
  // avanza mai più (segnalato dall'utente). history.replaceState riscrive l'URL
  // SENZA ricaricare la pagina: la scheda resta dov'è ma torna a essere la home
  // pulita, quindi un ricaricamento manuale conta di nuovo come visita vera.
  // Il meta refresh del sito punta all'URL assoluto col parametro, quindi il
  // prossimo auto-refresh viene comunque riconosciuto (e ripulito a sua volta).
  // L'ANCORA si conserva: hdblog ci tiene il numero di blocchi già aperti
  // (#?t=...&b=N) e la usa per rirenderizzarli tutti insieme.
  function stripVisitParams() {
    try {
      const u = new URL(location.href);
      sameVisitParams().forEach((p) => u.searchParams.delete(p));
      const qs = u.searchParams.toString();
      history.replaceState(
        history.state,
        "",
        u.pathname + (qs ? "?" + qs : "") + u.hash
      );
    } catch (e) {}
  }

  if (sameVisitLoad) stripVisitParams();

  // Chiave stabile della notizia.
  function articleKey(rawHref) {
    let u;
    try {
      u = new URL(rawHref, location.href);
    } catch (e) {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (idRe) {
      const m = u.pathname.match(idRe);
      if (m && m[1]) return (site.idPrefix || "") + m[1];
    }
    const path = u.pathname.replace(/\/+$/, "");
    return (u.host + path).toLowerCase();
  }

  // Parti del linkSelector, in ordine di priorità (la prima che trova vince).
  const linkParts = String(site.linkSelector || "a[href]")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Sceglie il link (URL + titolo) dentro la notizia rispettando l'ordine di priorità,
  // così si prende il link del TITOLO e non quello dell'immagine (che ha testo vuoto).
  function pickLink(el) {
    for (const sel of linkParts) {
      if (el.matches && el.matches(sel)) return el;
      const found = el.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  // Estrae le notizie (dalla più recente alla più vecchia) da un albero DOM:
  // la pagina corrente oppure un documento parsato con DOMParser (conteggio
  // esatto dall'archivio, vedi countUnreadInArchive).
  //
  // Una notizia già incontrata più in alto viene SCARTATA dalla lista (vale la
  // prima occorrenza, quella in posizione cronologica giusta) ma il suo elemento
  // finisce in out.dups: sono i doppioni che il lazy-load a offset genera da solo
  // (vedi hideDuplicates). out.raw = quanti nodi ha matchato il selettore, prima
  // di ogni scarto: serve alla firma del feed per accorgersi anche di un blocco
  // fatto di soli doppioni, che non cambierebbe la lunghezza della lista.
  function collectArticles(root, baseUrl) {
    let els = Array.prototype.slice.call(
      root.querySelectorAll(site.articleSelector)
    );
    // Notizie con la stessa classe del feed ma fuori dal feed (barre laterali
    // "ultime notizie"): non sono parte della sequenza.
    if (site.articleExclude)
      els = els.filter((el) => !el.closest(site.articleExclude));
    if (site.newestLast) els.reverse();

    const out = [];
    const dups = [];
    const seen = new Set();
    for (const el of els) {
      const a = pickLink(el);
      if (!a) continue;
      const href = a.getAttribute("href");
      if (!href) continue;
      const key = articleKey(href);
      if (!key) continue;
      if (seen.has(key)) {
        dups.push(el);
        continue;
      }
      let url;
      try {
        url = new URL(href, baseUrl).href;
      } catch (e) {
        continue;
      }
      seen.add(key);
      out.push({ el, key, url, title: (a.textContent || "").trim() });
    }
    out.dups = dups;
    out.raw = els.length;
    return out;
  }

  // Notizie del feed della pagina corrente.
  function getFeedArticles() {
    return collectArticles(document, location.href);
  }

  async function waitForFeed(maxTries = 12, delay = 150) {
    for (let i = 0; i < maxTries; i++) {
      const f = getFeedArticles();
      if (f.length) return f;
      await sleep(delay);
    }
    return [];
  }

  // -------- storage --------

  function getStore(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function setStore(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }
  function removeStore(keys) {
    return new Promise((res) => chrome.storage.local.remove(keys, res));
  }

  // -------- impostazioni --------

  const DEFAULT_SETTINGS = {
    enabled: true,
    showToast: true,
    trackInterests: true,
    hideDupes: true,
    // Segnalibro BLOCCATO: non si sposta mai da solo (vedi init()). Di norma
    // avanza quando l'hai raggiunto con lo sguardo; con questa opzione resta
    // dov'è finché non premi "Segna tutte come lette". Chiesto dall'utente con
    // un arretrato di centinaia di notizie: lì il segnalibro è il punto di
    // ripartenza, e deve muoverlo solo lui.
    freezeMarker: false,
  };
  let settings = DEFAULT_SETTINGS;
  let ignoreSet = new Set(); // parole extra da ignorare, scelte dall'utente (deaccentate)

  function getSettings() {
    return new Promise((res) =>
      chrome.storage.local.get("settings", (d) =>
        res(Object.assign({}, DEFAULT_SETTINGS, (d && d.settings) || {}))
      )
    );
  }

  // -------- tracciamento interessi (100% locale, on-device) --------

  // Lista stopword (in forma SENZA accenti: il confronto avviene deaccentato).
  const IT_STOPWORDS = new Set(
    (
      "di a da in con su per tra fra e ed o od ma se anche ancora gia sempre mai piu meno molto poco tanto troppo tutto tutti tutta tutte ogni qualche alcuni alcune " +
      "il lo la i gli le un uno una dei degli delle del dello della al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col coi " +
      "che chi cui non come dove quando quanto quale quali perche mentre quindi pero invece oppure ovvero cioe inoltre poi allora dunque anche " +
      "io tu lui lei noi voi loro me te si ci vi ne mi ti se questo questa questi queste quello quella quelli quelle cio stesso stessa suo sua suoi sue loro nostro nostra vostro " +
      "qui qua li la su giu sotto sopra dentro fuori vicino lontano prima dopo presto tardi bene male cosi solo soltanto appena forse quasi circa fino oltre entro contro senza verso durante " +
      "essere e sono sei siamo siete era erano ero eri stato stata stati state sara saranno " +
      "avere ho hai ha abbiamo avete hanno avevo aveva avuto avra " +
      "fare fa fai fanno facciamo fate fatto fatta facendo " +
      "potere puo possono posso puoi potra potrebbe " +
      "dovere deve devono devo dovra " +
      "volere vuole vogliono voglio " +
      "andare va vanno vado andra " +
      "venire viene vengono vieni verra arriva arrivano arrivare " +
      "dire dice dicono detto vedere vede vedono visto " +
      "nuovo nuova nuovi nuove grande grandi piccolo primo prima ultimo ultima ecco " +
      "cosa cose caso casi modo modi volta volte parte parti anno anni mese mesi giorno giorni via foto video gallery articolo articoli news " +
      "note libera illumina cerca misteriose " +
      "the and for with your you from this that not new are was has will"
    ).split(" ")
  );

  // Verbi (forme più comuni nei titoli), in forma SENZA accenti. Esclude di proposito
  // le voci che sono anche sostantivi/aggettivi comuni (porta, punta, guida, prova,
  // sfida, parte, sale, costa, terra, presa, messa, scritta, usa...) per non togliere
  // parole chiave utili.
  const IT_VERBS = new Set(
    (
      "arriva arrivano arrivare arrivato arrivata arrivati arrivate arrivera arriveranno arrivando " +
      "lancia lanciano lanciare lanciato lanciando lancera " +
      "presenta presentano presentare presentato presentando presentera " +
      "mostra mostrano mostrare mostrato mostrando mostrera " +
      "svela svelano svelare svelato svelando svelera " +
      "apre aprono aprire aperto aprendo aprira " +
      "chiude chiudono chiudere chiuso chiudendo chiudera " +
      "illumina illuminano illuminare illuminato illuminando " +
      "cerca cercano cercare cercato cercando cerchera " +
      "libera liberano liberare liberato liberando " +
      "conferma confermano confermare confermato confermando confermera " +
      "annuncia annunciano annunciare annunciato annunciando annuncera " +
      "debutta debuttano debuttare debuttato debuttando " +
      "cambia cambiano cambiare cambiato cambiando cambiera " +
      "torna tornano tornare tornato tornando tornera " +
      "diventa diventano diventare diventato diventando diventera " +
      "puntano puntare puntato puntando puntera " +
      "sfidano sfidare sfidato sfidando " +
      "batte battono battere battuto battendo battera " +
      "rende rendono rendere reso rendendo rendera " +
      "portano portare portato portando portera " +
      "lascia lasciano lasciare lasciato lasciando lascera " +
      "trova trovano trovare trovato trovando trovera " +
      "usano usare usato usando usera " +
      "crea creano creare creato creando creera " +
      "lavora lavorano lavorare lavorato lavorando lavorera " +
      "provano provare provato provando provera " +
      "migliora migliorano migliorare migliorato migliorando migliorera " +
      "aumenta aumentano aumentare aumentato aumentando aumentera " +
      "riduce riducono ridurre ridotto ridotta riducendo ridurra " +
      "prende prendono prendere preso prendendo prendera " +
      "mette mettono mettere messo mettendo mettera " +
      "scrive scrivono scrivere scritto scrivendo scrivera " +
      "parla parlano parlare parlato parlando parlera " +
      "chiama chiamano chiamare chiamato chiamando chiamera " +
      "resta restano restare restato restando restera " +
      "rimane rimangono rimanere rimasto rimanendo rimarra " +
      "costano costare costato costando costera " +
      "vende vendono vendere venduto vendendo vendera " +
      "compra comprano comprare comprato comprando comprera " +
      "acquista acquistano acquistare acquistato acquistando acquistera " +
      "include includono includere incluso includendo " +
      "offre offrono offrire offerto offrendo offrira " +
      "permette permettono permettere permesso permettendo permettera " +
      "consente consentono consentire consentito consentendo " +
      "funziona funzionano funzionare funzionato funzionando funzionera " +
      "gestisce gestiscono gestire gestito gestendo gestira " +
      "costruisce costruiscono costruire costruito costruendo costruira " +
      "sviluppa sviluppano sviluppare sviluppato sviluppando " +
      "introduce introducono introdurre introdotto introducendo " +
      "riesce riescono riuscire riuscito riuscendo riuscira " +
      "decide decidono decidere deciso decidendo decidera " +
      "sceglie scelgono scegliere scelto scegliendo " +
      "riceve ricevono ricevere ricevuto ricevendo ricevera " +
      "paga pagano pagare pagato pagando paghera " +
      "supera superano superare superato superando superera " +
      "registra registrano registrare registrato registrando " +
      "installa installano installare installato installando " +
      "scarica scaricano scaricare scaricato scaricando " +
      "aggiorna aggiornano aggiornare aggiornato aggiornando aggiornera " +
      "blocca bloccano bloccare bloccato bloccando bloccera " +
      "attivano attivare attivato attivando attivera " +
      "salva salvano salvare salvato salvando salvera " +
      "protegge proteggono proteggere protetto proteggendo " +
      "risolve risolvono risolvere risolto risolvendo risolvera " +
      "evita evitano evitare evitato evitando evitera " +
      "rischia rischiano rischiare rischiato rischiando " +
      "rivela rivelano rivelare rivelato rivelando rivelera " +
      "spiega spiegano spiegare spiegato spiegando spieghera " +
      "dichiara dichiarano dichiarare dichiarato dichiarando " +
      "accusano accusare accusato accusando " +
      "vince vincono vincere vinto vincendo vincera " +
      "perde perdono perdere perso perdendo perdera " +
      "cresce crescono crescere cresciuto crescendo crescera " +
      "scende scendono scendere sceso scendendo scendera " +
      "salgono salire salito salendo salira " +
      "segue seguono seguire seguito seguendo seguira " +
      "vale valgono valere valendo " +
      "tiene tengono tenere tenuto tenendo " +
      "vive vivono vivere vissuto vivendo vivra " +
      "muore muoiono morire morto morendo " +
      "nasce nascono nascere nascendo nascera " +
      "cade cadono cadere caduto cadendo cadra " +
      "colpisce colpiscono colpire colpito colpendo " +
      "guidano guidare guidato guidando " +
      "segna segnano segnare segnato segnando " +
      "gioca giocano giocare giocato giocando giochera " +
      "partono partire partendo partira " +
      "chiede chiedono chiedere chiesto chiedendo chiedera " +
      "risponde rispondono rispondere risposto rispondendo " +
      "conosce conoscono conoscere conosciuto conoscendo " +
      "pensa pensano pensare pensato pensando pensera " +
      "crede credono credere creduto credendo credera " +
      "spera sperano sperare sperato sperando sperera " +
      "guarda guardano guardare guardato guardando guardera " +
      "ascolta ascoltano ascoltare ascoltato ascoltando " +
      "sembra sembrano sembrare sembrato sembrando sembrera " +
      "continua continuano continuare continuato continuando continuera " +
      "inizia iniziano iniziare iniziato iniziando iniziera " +
      "finisce finiscono finire finito finendo finira " +
      "conclude concludono concludere concluso concludendo " +
      "ottiene ottengono ottenere ottenuto ottenendo otterra " +
      "raggiunge raggiungono raggiungere raggiunto raggiungendo " +
      "aggiunge aggiungono aggiungere aggiunto aggiungendo " +
      "riguarda riguardano riguardare riguardato " +
      "significa significano significare " +
      "conta contano contare contato contando " +
      "vieta vietano vietare vietato vietando " +
      "sospende sospendono sospendere sospeso " +
      "avvia avviano avviare avviato avviando " +
      "prevede prevedono prevedere previsto prevedendo " +
      "sostiene sostengono sostenere sostenuto " +
      "propone propongono proporre proposto " +
      "promette promettono promettere promesso " +
      "sfrutta sfruttano sfruttare sfruttato " +
      "realizza realizzano realizzare realizzato realizzando realizzera " +
      "utilizza utilizzano utilizzare utilizzato utilizzando " +
      "sostituisce sostituiscono sostituire sostituito"
    ).split(" ")
  );

  function deaccent(s) {
    return String(s)
      .replace(/[àáâã]/g, "a")
      .replace(/[èéê]/g, "e")
      .replace(/[ìíî]/g, "i")
      .replace(/[òóôõ]/g, "o")
      .replace(/[ùúû]/g, "u")
      .replace(/ç/g, "c");
  }

  // parola da scartare? (stopword generica o verbo)
  function isStop(w) {
    const d = deaccent(String(w).toLowerCase());
    return IT_STOPWORDS.has(d) || IT_VERBS.has(d);
  }

  function isIgnored(word) {
    return ignoreSet.has(deaccent(String(word).toLowerCase().trim()));
  }

  function addKw(set, raw) {
    const t = String(raw || "").trim().toLowerCase();
    if (
      t.length >= 2 &&
      t.length <= 40 &&
      !/^\d+$/.test(t) &&
      !isStop(t) &&
      !isIgnored(t)
    )
      set.add(t);
  }

  function metaContent(selector) {
    const m = document.querySelector(selector);
    return m ? (m.getAttribute("content") || "").trim() : "";
  }

  // È una pagina articolo? Prima l'idRegex del sito (URL articolo); in mancanza,
  // fallback universale al meta og:type=article (serve per hdmotori, che usa URL
  // con solo lo slug, senza ID numerico).
  function isArticlePage() {
    if (idRe && idRe.test(location.pathname)) return true;
    return metaContent('meta[property="og:type"]').toLowerCase() === "article";
  }

  function extractCategory() {
    let c =
      metaContent('meta[property="article:section"]') ||
      metaContent('meta[itemprop="articleSection"]') ||
      metaContent('meta[name="category"]');
    if (c) return c.trim();
    if (site.categorySelector) {
      const el = document.querySelector(site.categorySelector);
      if (el && el.textContent) return el.textContent.trim();
    }
    if (typeof site.catPathIndex === "number") {
      const segs = location.pathname.split("/").filter(Boolean);
      const seg = segs[site.catPathIndex];
      if (seg && !/^n?\d/.test(seg))
        return decodeURIComponent(seg).replace(/-/g, " ");
    }
    return "";
  }

  // (approccio 2 — genericità della LINGUA) Parole frequenti nei titoli news/tech
  // che NON sono stopword ma sono poco informative. Le trattiamo come delimitatori
  // "soft" in RAKE (spezzano le frasi e non diventano keyword da sole). Scelta voluta
  // rispetto all'IDF sul corpus personale: quello declasserebbe gli argomenti PIÙ
  // letti dall'utente (i suoi interessi), l'esatto contrario di ciò che vogliamo.
  // Forma SENZA accenti (confronto deaccentato).
  const IT_GENERIC = new Set(
    (
      "prezzo prezzi offerta offerte sconto sconti euro dollari coupon codice promo promozione " +
      "recensione recensioni prova test confronto anteprima unboxing guida guide tutorial " +
      "uscita arrivo lancio disponibile disponibilita versione versioni modello modelli serie gamma " +
      "novita indiscrezione indiscrezioni rumor voci dettagli dettaglio caratteristica caratteristiche scheda specifiche " +
      "immagine immagini render leak teaser trailer mercato listino store negozio " +
      "azienda societa utente utenti cliente clienti mondo settore ora oggi ieri domani settimana " +
      "smartphone telefono dispositivo dispositivi prodotto prodotti device offertona minimo storico " +
      "migliore migliori peggiore top super mega"
    ).split(" ")
  );

  function isGeneric(w) {
    return IT_GENERIC.has(deaccent(String(w).toLowerCase()));
  }

  // (approccio 3 — RAKE) Estrae KEYPHRASE dal titolo, non parole isolate.
  // stopword/verbi/parole-generiche/parole-ignorate/numeri/punteggiatura fanno da
  // delimitatori: le parole di contenuto contigue formano una frase candidata (così
  // "intelligenza artificiale", "auto elettrica" restano unite). Punteggio RAKE:
  // score(parola)=deg/freq, frase=somma. Ritorna le migliori topN frasi (1..maxWords).
  function keyphrasesRake(text, maxWords, topN) {
    maxWords = maxWords || 3;
    topN = topN || 8;
    // 1) frasi candidate. La PUNTEGGIATURA spezza in blocchi (confine di frase, come
    //    in RAKE); DENTRO ogni blocco le stopword/verbi/generiche/ignorate/numeri/
    //    parole troppo corte spezzano ulteriormente. Le parole di contenuto contigue
    //    restano unite ("intelligenza artificiale", "auto elettrica").
    const phrases = [];
    let cur = [];
    const flush = () => {
      if (cur.length) phrases.push(cur);
      cur = [];
    };
    String(text || "")
      .toLowerCase()
      .split(/[^a-zà-ù0-9\s]+/) // la punteggiatura separa i blocchi
      .forEach((chunk) => {
        chunk.split(/\s+/).forEach((w) => {
          const isDelim =
            !w ||
            w.length < 4 || // acronimi/sigle 2-3 char li prende extractStrongTokens
            /^\d+$/.test(w) ||
            isStop(w) ||
            isGeneric(w) ||
            isIgnored(w);
          if (isDelim) {
            flush();
            return;
          }
          cur.push(w);
          if (cur.length >= maxWords) flush(); // non oltre maxWords parole per frase
        });
        flush(); // fine blocco = confine di frase
      });
    if (!phrases.length) return [];

    // 2) punteggi RAKE per parola: deg (grado di co-occorrenza) / freq
    const freq = new Map();
    const deg = new Map();
    for (const p of phrases) {
      for (const w of p) {
        freq.set(w, (freq.get(w) || 0) + 1);
        deg.set(w, (deg.get(w) || 0) + p.length);
      }
    }

    // 3) punteggia le frasi (dedup), ordina, ritorna le migliori
    const scored = [];
    const seen = new Set();
    for (const p of phrases) {
      const kw = p.join(" ");
      if (seen.has(kw)) continue;
      seen.add(kw);
      let s = 0;
      for (const w of p) s += deg.get(w) / freq.get(w);
      scored.push({ kw, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, topN).map((x) => x.kw);
  }

  // Token "forti" dal titolo: acronimi (AI, USB, GPU) e sigle prodotto (PS5, 5G,
  // S24, RTX4090). Vanno aggiunti SEMPRE, anche quando esistono i tag veri, perché
  // il titolo cita spesso il prodotto/acronimo chiave che i tag non includono, e
  // perché "AI" verrebbe altrimenti scartato: deaccentato = "ai" = preposizione (stopword).
  function isStrongToken(tok, shouty) {
    if (tok.length < 2 || tok.length > 12) return false;
    if (/^\d+$/.test(tok)) return false; // solo cifre: no (es. "100", "2024")
    if (!/[a-zà-ù]/i.test(tok)) return false; // serve almeno una lettera
    if (/\d/.test(tok)) return true; // lettere+cifre: PS5, 5G, S24, RTX4090 — sempre
    // acronimo tutto maiuscolo (AI, USB, GPU): affidabile SOLO se il titolo non è
    // "gridato" (altrimenti ogni parola è maiuscola). Se corto (<=3) lo teniamo anche
    // se collide con una stopword (così "AI" ≠ preposizione "ai"); se più lungo,
    // scartiamo le parole comuni gridate (OGGI, SOLO) via isStop.
    if (shouty) return false;
    if (/^[A-ZÀ-Ù]{2,6}$/.test(tok)) return tok.length <= 3 ? true : !isStop(tok);
    return false;
  }

  function extractStrongTokens(text) {
    const s = String(text || "");
    const upper = (s.match(/[A-ZÀ-Ù]/g) || []).length;
    const lower = (s.match(/[a-zà-ù]/g) || []).length;
    const shouty = upper > lower; // titolo tutto/quasi maiuscolo: niente acronimi
    const out = new Set();
    s.split(/[^0-9A-Za-zÀ-ù]+/).forEach((tok) => {
      if (tok && isStrongToken(tok, shouty)) {
        const t = tok.toLowerCase();
        if (!isIgnored(t)) out.add(t);
      }
    });
    return out;
  }

  function extractKeywords() {
    const set = new Set();

    // 1) Fonti "vere" (tag strutturati): article:tag, news_keywords, keywords SOLO
    //    se è un elenco separato da virgole, ed eventuale selettore DOM per sito.
    document.querySelectorAll('meta[property="article:tag"]').forEach((m) => {
      addKw(set, m.getAttribute("content"));
    });
    const nk = metaContent('meta[name="news_keywords"]');
    if (nk && nk.indexOf(",") !== -1) nk.split(",").forEach((k) => addKw(set, k));
    const kw = metaContent('meta[name="keywords"]');
    if (kw && kw.indexOf(",") !== -1) kw.split(",").forEach((k) => addKw(set, k));
    if (site.keywordsSelector) {
      document.querySelectorAll(site.keywordsSelector).forEach((el) => {
        addKw(set, el.textContent);
      });
    }

    // Se ci sono tag veri, NON usiamo il tokenizer generico del titolo. Va deciso
    // ORA, prima di aggiungere i token "forti": altrimenti "ai" farebbe sembrare
    // pieno il set e sopprimerebbe il fallback (perdendo es. "agentic" dal titolo).
    const hadRealTags = set.size > 0;

    const h1 = document.querySelector("h1");
    const title = (h1 && h1.textContent) || document.title || "";

    // 2)+3) Fallback: keyphrase RAKE dal titolo — SOLO se non c'erano tag veri.
    if (!hadRealTags) {
      keyphrasesRake(title).forEach((w) => set.add(w));
    }

    // 1b) Acronimi/sigle dal titolo (SEMPRE, anche con i tag veri): AI, PS5, 5G...
    extractStrongTokens(title).forEach((w) => set.add(w));

    return Array.from(set).slice(0, 15);
  }

  function trackArticle() {
    const key = articleKey(location.href);
    if (!key) return;
    const h1 = document.querySelector("h1");
    const title = ((h1 && h1.textContent) || document.title || "").trim();
    const entry = {
      k: key,
      s: site.id,
      c: extractCategory(),
      kw: extractKeywords(),
      t: title.slice(0, 120),
      ts: Date.now(),
    };
    try {
      console.log("[Segnalibro] articolo registrato:", entry.s, entry.k, "·", entry.t.slice(0, 45));
    } catch (e) {}
    // La scrittura avviene nel service worker, serializzata, così aprendo più
    // articoli in schede diverse non si sovrascrivono a vicenda.
    try {
      chrome.runtime.sendMessage({ type: "trackArticle", entry: entry });
    } catch (e) {}
  }

  // -------- colori / badge --------

  function mixWhite(hex, ratio) {
    // ratio = quanto accento (0..1); il resto è bianco.
    const c = String(hex || "#df151c").replace("#", "");
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    if ([r, g, b].some(isNaN)) return hex;
    const mix = (v) => Math.round(v * ratio + 255 * (1 - ratio));
    return "rgb(" + mix(r) + "," + mix(g) + "," + mix(b) + ")";
  }

  function applyAccent() {
    const root = document.documentElement;
    root.style.setProperty("--hdb-accent", site.color || "#df151c");
    root.style.setProperty("--hdb-accent-soft", mixWhite(site.color, 0.08));
    root.style.setProperty("--hdb-accent-mid", mixWhite(site.color, 0.42));
  }

  function setBadge(count, approx) {
    try {
      chrome.runtime.sendMessage({
        type: "setBadge",
        count: count,
        approx: !!approx, // limite inferiore: il SW mostra "N+" (decina in giù)
        color: site.color || "#df151c",
      });
    } catch (e) {}
  }

  // -------- evidenziazione --------

  // "Raggiunto" = l'elemento del segnalibro è entrato nel viewport durante QUESTA
  // visita (l'utente è arrivato a vederlo). Solo allora, al caricamento successivo,
  // il segnalibro può avanzare (vedi init()). Senza questa condizione, se l'ultima
  // letta sta oltre il lazy-load, l'avanzamento automatico la sostituirebbe con la
  // notizia più recente del caricamento precedente, perdendo la posizione vera.
  let reachedThisVisit = false;
  let reachObserver = null;

  function watchMarkerReached(el) {
    if (reachedThisVisit) return;
    try {
      if (reachObserver) reachObserver.disconnect();
      reachObserver = new IntersectionObserver(
        (entries) => {
          if (reachedThisVisit) return;
          for (const en of entries) {
            if (en.isIntersecting) {
              reachedThisVisit = true;
              setStore({ [K.reached]: true });
              if (reachObserver) {
                reachObserver.disconnect();
                reachObserver = null;
              }
              break;
            }
          }
        },
        { threshold: 0.5 }
      );
      reachObserver.observe(el);
    } catch (e) {}
  }

  function clearHighlight() {
    document.querySelectorAll(".hdb-marker").forEach((e) => {
      e.classList.remove("hdb-marker");
      const l = e.querySelector(".hdb-label");
      if (l) l.remove();
    });
  }

  // ---- doppioni del feed ----
  // Il lazy-load di hdblog è paginato a OFFSET sulla lista VIVA: pages.php?page=N
  // ricalcola le posizioni a ogni richiesta. La home viene renderizzata all'apertura
  // (blocchi 1-2), i blocchi successivi arrivano mentre scorri: ogni notizia
  // pubblicata nel frattempo fa scalare la sequenza di una posizione, così il
  // blocco che arriva RIPETE le ultime notizie già in pagina. Verificato dal vivo:
  // pubblicata n666098, la pagina 3 è passata da iniziare con n666081 a iniziare
  // con n666086, che era l'ultima del blocco già mostrato.
  //
  // Non possiamo impedirlo (lo genera il server), possiamo solo non mostrarlo.
  // Nascondiamo le occorrenze SUCCESSIVE alla prima: la prima sta nella posizione
  // cronologica giusta ed è quella su cui cade l'eventuale evidenziazione.
  // Il confronto è sulla CHIAVE dell'articolo (per hdblog l'id numerico nXXXXXX):
  // due notizie diverse non possono collidere.
  function hideDuplicates(feed) {
    if (settings && settings.hideDupes === false) return 0;
    // Ripuliamo prima di ri-marcare: se il sito ri-renderizza la lista, un nodo
    // marcato può ritrovarsi a essere la prima occorrenza (applyHighlight è
    // idempotente e gira più volte, non deve accumulare nascondimenti sbagliati).
    document
      .querySelectorAll(".hdb-dup")
      .forEach((e) => e.classList.remove("hdb-dup"));
    const dups = (feed && feed.dups) || [];
    dups.forEach((el) => el.classList.add("hdb-dup"));
    return dups.length;
  }

  // Applica classe + etichetta "Ultima letta" e aggancia l'osservatore del
  // "raggiunto". Usata sia sulla home (applyHighlight) sia sulle pagine archivio.
  function markElement(el) {
    el.classList.add("hdb-marker");
    if (!el.querySelector(".hdb-label")) {
      const lab = document.createElement("span");
      lab.className = "hdb-label";
      lab.textContent = "Ultima letta";
      el.appendChild(lab);
    }
    watchMarkerReached(el);
  }

  function flashAndCenter(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("hdb-flash");
    void el.offsetWidth; // restart animazione
    el.classList.add("hdb-flash");
  }

  function applyHighlight() {
    if (!state.markerKey) return lastStatus;
    const feed = getFeedArticles();
    clearHighlight();
    const dups = hideDuplicates(feed);

    let unread = 0;
    let found = false;
    let approx = false;
    let markerTitle = "";

    const idx = feed.findIndex((a) => a.key === state.markerKey);
    if (idx >= 0) {
      found = true;
      unread = idx; // quante notizie stanno sopra (più recenti) = non lette
      markerTitle = feed[idx].title;
      // Ri-agganciato a ogni applicazione: il sito può sostituire il nodo (re-render).
      markElement(feed[idx].el);
    } else if (refined) {
      // Segnalibro fuori dal feed ma contato nell'archivio (refineUnread):
      // posizione del marker nella sequenza completa del sito = numero VERO.
      found = false;
      // Oltre il tetto di pagine sono entrambi limiti inferiori: vale il
      // maggiore tra conteggio archivio e notizie caricate nel feed.
      unread = refined.exact
        ? refined.count
        : Math.max(refined.count, feed.length);
      approx = !refined.exact;
    } else {
      found = false;
      unread = feed.length; // limite inferiore: il segnalibro è oltre il feed caricato
      approx = true;
    }

    lastStatus = {
      onHome: true,
      siteName: site.name,
      unread: unread,
      approx: approx,
      found: found,
      markerTitle: markerTitle,
      total: feed.length,
      dups: dups, // doppioni del sito nascosti in questa pagina (vedi hideDuplicates)
      frozen: !!(settings && settings.freezeMarker),
    };
    setStore({ ["status_" + site.id]: lastStatus });
    setBadge(unread, approx);
    if (!refining) renderToast(lastStatus);
    return lastStatus;
  }

  // ---- osservatore del feed (lazy-load / re-render) ----
  // hdblog (come altri) carica le notizie sotto la piega solo mentre scrolli e,
  // dopo l'idratazione, può ri-renderizzare la lista cancellando la nostra classe.
  // Il segnalibro dell'ultima notizia letta sta SOTTO le notizie nuove, quindi al
  // primo caricamento spesso non è ancora nel DOM: i retry a tempo fisso non bastano.
  // Qui ri-applichiamo il segnalibro (applyHighlight è idempotente) ogni volta che il
  // DOM del feed cambia o si scrolla. NON si avanza MAI il marker (resta solo init()).
  let feedObserver = null;
  let reapplyTimer = null;
  let lastSig = "";

  // Firma dello stato rilevante: se non cambia, non c'è nulla da rifare.
  // feed.raw (nodi trovati dal selettore, doppioni compresi) sta nella firma
  // insieme a feed.length (notizie distinte): un blocco caricato dal lazy-load
  // può essere fatto di SOLI doppioni — la lista non cambierebbe lunghezza e i
  // nuovi elementi ripetuti resterebbero visibili.
  function currentSig() {
    const feed = getFeedArticles();
    if (!feed.length) return null; // feed vuoto/transitorio (re-render): non toccare
    const idx = state.markerKey
      ? feed.findIndex((a) => a.key === state.markerKey)
      : -1;
    const el = idx >= 0 ? feed[idx].el : null;
    const has = !!(el && el.classList.contains("hdb-marker"));
    return feed.raw + "|" + feed.length + "|" + idx + "|" + (has ? 1 : 0);
  }

  function reapplyIfChanged() {
    if (!state.markerKey) return;
    const sig = currentSig();
    if (sig === null || sig === lastSig) return;
    applyHighlight();
    lastSig = currentSig(); // riflette lo stato dopo l'applicazione (classe/label)
  }

  function scheduleReapply() {
    if (reapplyTimer) return; // già in coda: si accorpano le mutazioni ravvicinate
    reapplyTimer = setTimeout(() => {
      reapplyTimer = null;
      reapplyIfChanged();
    }, 250);
  }

  function startFeedWatch() {
    // reflow molto tardivi anche senza una mutazione osservabile
    setTimeout(reapplyIfChanged, 800);
    setTimeout(reapplyIfChanged, 2200);
    const target = document.body || document.documentElement;
    try {
      feedObserver = new MutationObserver(scheduleReapply);
      feedObserver.observe(target, { childList: true, subtree: true });
    } catch (e) {}
    // lo scroll è il momento in cui il sito aggiunge le notizie sotto la piega
    window.addEventListener("scroll", scheduleReapply, { passive: true });
  }

  // ---- caricare TUTTO il feed a forza di scroll ----
  // Il feed lazy arriva a blocchi, e ogni blocco è una richiesta di rete: sul
  // sito vero ci mette 1-3 secondi, durante i quali la pagina è già in fondo e
  // non scende di un pixel. La vecchia condizione di uscita — "8 scroll di fila
  // senza che scrollY cambi", cioè 1,6 secondi — scattava proprio lì, in mezzo a
  // un caricamento, e la ricerca mollava la home molto prima del muro delle ~100
  // notizie di hdblog (bug #15: segnalibro a 97 non lette, cioè DENTRO il feed,
  // e la ricerca finita a sfogliare l'archivio dove quella notizia non c'è).
  //
  // Il criterio giusto non è il movimento dello scroll ma la CRESCITA del feed:
  //  - arrivano notizie nuove          -> si continua (il muro non è arrivato);
  //  - non si muove più niente         -> fondo raggiunto, si smette (IDLE_MS);
  //  - la pagina cresce (pubblicità, immagini) ma di notizie non ne arrivano più
  //    -> si smette lo stesso (FEED_IDLE_MS), altrimenti si scorrerebbe a vuoto
  //    fino al tetto di tempo.
  const GROW_MAX_MS = 90 * 1000; // tetto assoluto: ~100 notizie a blocchi di 10
  const GROW_IDLE_MS = 7000; // immobilità totale = fondo della pagina
  const GROW_FEED_IDLE_MS = 20000; // cresce la pagina ma non le notizie

  // Il sito, quando arrivi in fondo, CLICCA DA SOLO il suo pulsante "altre
  // notizie" (hdblog: handler sullo scroll -> $('.btn_more').click()). Finché
  // quel pulsante carica un altro blocco va benissimo — è così che il feed
  // cresce mentre scorriamo. Ma quando il lazy-load ha finito (hdblog: 10
  // blocchi) il pulsante diventa un LINK alla pagina successiva dell'archivio,
  // e lo stesso clic automatico ci porta VIA dalla pagina mentre stiamo ancora
  // cercando: la ricerca perde la home proprio quando l'aveva caricata tutta.
  // Qui si annulla la navigazione dei clic NON fidati (isTrusted=false = generati
  // da script). Quelli dell'utente passano; e l'handler inline del sito gira lo
  // stesso, perché preventDefault toglie solo la navigazione, non il codice che
  // carica il blocco.
  function installAutoNavGuard() {
    const onClick = (e) => {
      if (e.isTrusted) return;
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      let dest;
      try {
        dest = new URL(a.getAttribute("href"), location.href);
      } catch (err) {
        return;
      }
      // Un'ancora nella stessa pagina non porta via nessuno: si lascia passare.
      if (dest.href.split("#")[0] === location.href.split("#")[0]) return;
      e.preventDefault();
      try {
        console.log(
          "[Segnalibro] navigazione automatica del sito bloccata durante la ricerca:",
          dest.href
        );
      } catch (err) {}
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }

  // Scorre la pagina finché il feed smette di crescere (o finché compare la
  // notizia cercata) e restituisce il feed finale. onGrow, se passato, viene
  // chiamata a ogni giro con il feed corrente (la home la usa per ri-applicare
  // l'evidenziazione e aggiornare il toast di avanzamento).
  async function growFeedByScrolling(targetKey, onGrow) {
    if (site.feedStatic) return getFeedArticles(); // è già tutto nel DOM
    const t0 = Date.now();
    let feed = getFeedArticles();
    let bestLen = feed.length;
    let bestY = window.scrollY;
    let lastAny = t0; // ultima volta che qualcosa si è mosso
    let lastFeed = t0; // ultima volta che sono arrivate notizie
    const releaseGuard = installAutoNavGuard();
    try {
      while (Date.now() - t0 < GROW_MAX_MS) {
        if (seekCancelled) break; // × del toast: l'utente ha annullato
        if (targetKey && feed.some((a) => a.key === targetKey)) break;
        window.scrollBy(0, Math.max(600, Math.round(window.innerHeight * 0.9)));
        await sleep(250);
        feed = getFeedArticles();
        const now = Date.now();
        if (feed.length > bestLen) {
          bestLen = feed.length;
          lastFeed = now;
          lastAny = now;
        }
        if (window.scrollY > bestY) {
          bestY = window.scrollY;
          lastAny = now;
        }
        if (onGrow) {
          try {
            onGrow(feed);
          } catch (e) {}
        }
        if (now - lastAny > GROW_IDLE_MS) break;
        if (now - lastFeed > GROW_FEED_IDLE_MS) break;
      }
    } finally {
      releaseGuard();
    }
    return getFeedArticles();
  }

  // Aspetta che il feed smetta di crescere da solo (senza scrollare): 1,5s
  // senza notizie nuove, al massimo 6s, o finché compare la notizia cercata.
  async function waitFeedSettled(targetKey) {
    const t0 = Date.now();
    let len = getFeedArticles().length;
    let last = t0;
    while (Date.now() - t0 < 6000 && Date.now() - last < 1500) {
      if (seekCancelled) return;
      await sleep(250);
      const f = getFeedArticles();
      if (targetKey && f.some((a) => a.key === targetKey)) return;
      if (f.length > len) {
        len = f.length;
        last = Date.now();
      }
    }
  }

  // ---- archivio paginato ("tutte le notizie") ----
  // Su alcuni siti (hwupgrade) il feed della home è FISSO: finite le ~40 notizie
  // lo scroll non carica altro, e le più vecchie stanno in un archivio a pagine
  // (/news/index.html, /news/index2.html, ...). Se il segnalibro non è nel feed,
  // "Vai all'ultima letta" imposta un flag di ricerca (seek_<id>) e naviga
  // all'archivio: su ogni pagina initArchive() cerca il marker — se c'è lo
  // evidenzia e centra, altrimenti passa alla pagina successiva. Il TTL, il tetto
  // di pagine e il confronto flag.page/pagina corrente evitano che un flag
  // rimasto appeso dirotti le visite normali all'archivio.
  // 10 minuti: la ricerca può sfogliare decine di pagine, e ognuna è un
  // caricamento vero (su hdblog anche 2-3 secondi). Resta comunque una durata
  // breve rispetto al rischio che copre — un flag dimenticato che dirotta una
  // visita manuale all'archivio.
  const SEEK_TTL_MS = 10 * 60 * 1000;

  function archiveMaxPages() {
    return (site.archive && site.archive.maxPages) || 40;
  }

  // Prima pagina della ricerca. Non sempre è la 1: su hdblog /page/1/ ripete le
  // notizie che stanno già nella home, quindi si parte dalla 2 (è anche dove
  // porta il bottone "altre notizie" del sito).
  function archiveFirstPage() {
    return (site.archive && site.archive.firstPage) || 1;
  }

  // Pagina dell'archivio che contiene la posizione `pos` (0 = la più recente),
  // quando il sito dichiara quante notizie ha ogni pagina (archive.perPage) e
  // la prima pagina comincia dalla più recente. hdblog: 100 a pagina, quindi
  // posizione 0-99 -> /page/1/, 100-199 -> /page/2/, ... Senza perPage, o
  // senza posizione nota, si parte dall'inizio.
  // La posizione può solo CRESCERE col tempo (le notizie nuove si impilano
  // sopra), quindi partire dalla pagina calcolata non salta mai il segnalibro:
  // al massimo è scivolato alla pagina dopo, dove la ricerca prosegue da sola.
  function archiveStartPage(pos) {
    const first = archiveFirstPage();
    const per = site.archive && site.archive.perPage;
    if (!per || typeof pos !== "number" || !(pos >= 0)) return first;
    return Math.min(archiveMaxPages(), first + Math.floor(pos / per));
  }

  // Pagine archivio già complete al caricamento: niente scroll per cercare.
  function archiveIsStatic() {
    return !!(site.feedStatic || (site.archive && site.archive.static));
  }

  function archiveUrlFor(page) {
    // Due formati: urlTemplate con {n} al posto del numero di pagina (hdblog:
    // /page/2/, /page/3/, ...) oppure urlBase+N+".html" con la pagina 1 senza
    // numero (hwupgrade: index.html, index2.html, ...).
    if (site.archive.urlTemplate)
      return site.archive.urlTemplate.replace("{n}", String(page));
    return site.archive.urlBase + (page > 1 ? String(page) : "") + ".html";
  }

  // URL della pagina N per il CONTEGGIO. Di norma è la stessa pagina che si
  // naviga, ma un sito può esporre un endpoint equivalente più adatto al
  // fetch: hdblog serve le pagine navigabili solo a una navigazione vera
  // (429 al fetch), mentre l'endpoint ajax del lazy-load si scarica senza
  // problemi e ha lo stesso markup. Numerazione propria, da 1.
  function countUrlFor(page) {
    if (site.archive && site.archive.countTemplate)
      return site.archive.countTemplate.replace("{n}", String(page));
    return archiveUrlFor(page);
  }

  // Numero di pagina se l'URL corrente è una pagina dell'archivio, altrimenti null.
  function archivePageNum() {
    if (!site.archive || !site.archive.pathRegex) return null;
    let m = null;
    try {
      m = location.pathname.match(new RegExp(site.archive.pathRegex));
    } catch (e) {
      return null;
    }
    if (!m) return null;
    return m[1] ? parseInt(m[1], 10) : 1;
  }

  // Avvia (o prosegue) la ricerca del segnalibro nell'archivio a partire da `page`.
  // Chiamata con la pagina successiva quando siamo GIÀ in una pagina dell'archivio:
  // ripartire da 1 rifarebbe il giro delle pagine appena scartate.
  //
  // `target` (quando il conteggio è ESATTO) è la posizione del segnalibro nella
  // sequenza del sito: serve a sapere quando smettere. L'archivio scorre dal
  // recente al vecchio, quindi dopo aver esaminato più di `target` notizie
  // partendo dalla prima pagina, il segnalibro NON PUÒ essere più avanti — o
  // l'archivio comincia dopo di lui, o non lo elenca affatto. In entrambi i casi
  // continuare a sfogliare è tempo perso: è quello che è successo all'utente,
  // 40 pagine per una notizia che stava a 97 (bug #15).
  async function startArchiveSeek(page, target) {
    const p = page || archiveFirstPage();
    if (p > archiveMaxPages()) return false;
    // Se si salta direttamente a una pagina più avanti (archiveStartPage), le
    // notizie delle pagine saltate contano come già esaminate: il limite su
    // `target` ragiona in posizioni assolute nella sequenza del sito.
    const per = site.archive && site.archive.perPage;
    const skipped = per ? Math.max(0, p - archiveFirstPage()) * per : 0;
    const flag = { page: p, ts: Date.now(), scanned: skipped };
    if (typeof target === "number") flag.target = target;
    await setStore({ [K.seek]: flag });
    location.assign(archiveUrlFor(p));
    return true;
  }

  // Seconda prova che la ricerca è andata OLTRE il segnalibro, indipendente dal
  // conteggio: sui siti dove l'id numerico cresce con la data di pubblicazione
  // (archive.idOrdered — hdblog: nXXXXXX) una pagina fatta quasi tutta di id
  // più BASSI di quello del segnalibro è già più vecchia dell'ultima letta, e
  // le pagine successive lo sono ancora di più. Quasi tutta e non tutta: ogni
  // pagina ha qualche articolo vecchio ripubblicato (id basso in posizione
  // recente), e il 90% lo assorbe. Il caso inverso — segnalibro che è lui
  // stesso un articolo ripubblicato, con id basso — dà solo "continua", mai
  // uno stop sbagliato. Senza questa prova, un segnalibro che il sito non
  // elenca più faceva sfogliare l'archivio fino al tetto di 40 pagine.
  function pageOlderThanMarker(feed, markerKey) {
    if (!site.archive || !site.archive.idOrdered) return false;
    const re = new RegExp(
      "^" + String(site.idPrefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)$"
    );
    const num = (k) => {
      const m = String(k || "").match(re);
      return m ? parseInt(m[1], 10) : NaN;
    };
    const mk = num(markerKey);
    if (!(mk > 0)) return false;
    const ids = feed.map((a) => num(a.key)).filter((n) => n > 0);
    if (ids.length < 10) return false;
    const older = ids.filter((n) => n < mk).length;
    return older / ids.length >= 0.9;
  }

  // Pagina archivio: SOLO ricerca/evidenziazione. Il caricamento non avanza mai il
  // segnalibro (marker/pending/init restano intatti — l'unico modo di cambiarlo da
  // qui è il pulsante "Segna tutte come lette", vedi markAllRead); "reached" invece
  // sì (markElement aggancia watchMarkerReached): se l'utente arriva a VEDERE
  // l'ultima letta nell'archivio, al prossimo caricamento della home l'avanzamento
  // riparte normalmente — è la stessa semantica della home.
  async function initArchive(page) {
    applyAccent();
    // Stato di partenza sincrono: se il popup chiede lo stato mentre siamo ancora
    // nelle await qui sotto, deve comunque vedere "archivio" (e i suoi pulsanti).
    lastStatus = {
      onHome: false,
      archive: true,
      archivePage: page,
      siteName: site.name,
      unread: 0,
      approx: false,
      found: false,
      markerTitle: "",
      total: 0,
      frozen: !!(settings && settings.freezeMarker),
    };

    const store = await getStore([K.marker, K.seek, "status_" + site.id]);
    const marker = store[K.marker];
    const seek = store[K.seek];

    // Le "non lette" si contano sulla HOME (qui il feed è un pezzo di archivio, non
    // il feed corrente): riusiamo l'ultimo stato noto della home, cioè lo stesso
    // numero che mostra il badge, così il popup non resta muto.
    const home = store["status_" + site.id] || {};
    lastStatus.unread = home.unread | 0;
    lastStatus.approx = !!home.approx;
    setBadge(lastStatus.unread, lastStatus.approx);

    // Pagina >= a quella attesa e non solo uguale: se il sito ci ha spostati da
    // solo (o una pagina ha redirezionato) la ricerca prosegue da dove siamo
    // finiti invece di spegnersi in silenzio. Va sempre in AVANTI, quindi non
    // può tornare a sfogliare pagine già scartate.
    const seekHere = !!(marker && seek && page >= (seek.page | 0));
    const seeking = !!(
      seekHere &&
      typeof seek.ts === "number" &&
      Date.now() - seek.ts < SEEK_TTL_MS
    );
    if (!marker) {
      if (seek) await removeStore(K.seek);
      return;
    }
    state.markerKey = marker;

    let feed = await waitForFeed();
    let idx = feed.findIndex((a) => a.key === marker);

    // Pagine d'archivio LAZY (fatte con lo stesso stampo della home: le prime
    // ~20 notizie e le altre mentre scorri): guardare solo quelle già
    // renderizzate vuol dire saltare l'80% della pagina (bug #15), quindi
    // durante una ricerca si scrollano. Solo durante una ricerca: una visita
    // normale all'archivio non deve muoversi da sola.
    // Le pagine STATICHE (hwupgrade, e hdblog da settembre 2026: 100 notizie
    // già nel DOM) invece NON si scrollano: non caricherebbero niente, e
    // vedere la pagina scorrere fino in fondo — con l'attesa per accorgersi che
    // è finita — prima di passare alla successiva è proprio il "continua a
    // scrollare le pagine" segnalato dall'utente (bug #16).
    let cancelled = false;
    if (idx < 0 && seeking && !archiveIsStatic()) {
      seekCancelled = false;
      showSeekToast("Cerco l'ultima letta… pagina " + page);
      feed = await growFeedByScrolling(marker, (f) => {
        showSeekToast(
          "Cerco l'ultima letta… pagina " + page + ", " + f.length + " notizie"
        );
      });
      idx = feed.findIndex((a) => a.key === marker);
      cancelled = seekCancelled; // × del toast: la ricerca finisce qui
    }
    lastStatus.total = feed.length;

    if (idx >= 0) {
      // Trovata: evidenzia (e chiudi l'eventuale ricerca in corso).
      if (seek) await removeStore(K.seek);
      markElement(feed[idx].el);
      lastStatus.found = true;
      lastStatus.markerTitle = feed[idx].title;
      if (seeking) {
        dismissSeekToast();
        flashAndCenter(feed[idx].el);
      }
      return;
    }

    // Annullata con la × mentre caricava la pagina: niente auto-navigazione e
    // niente messaggio (la × è già una risposta).
    if (cancelled) return;

    if (!seeking) {
      // Ricerca arrivata fin qui ma SCADUTA per strada (TTL): si dice e si
      // chiude, invece di lasciare l'utente su una pagina d'archivio senza
      // spiegazioni. Senza flag è invece una visita normale dell'archivio:
      // nessuna auto-navigazione e nessun messaggio.
      if (seekHere) {
        await removeStore(K.seek);
        showSeekToast(
          "La ricerca dell'ultima letta ci ha messo troppo e si è fermata a " +
            "pagina " +
            page +
            ". Riprova dal pop-up per continuare da qui.",
          true
        );
      }
      return;
    }

    // Notizie esaminate da quando la ricerca è entrata nell'archivio. Con il
    // conteggio esatto (seek.target = posizione del segnalibro) diventa una
    // prova: superata quella soglia il segnalibro è ormai alle spalle e le
    // pagine successive, che vanno solo più indietro nel tempo, non possono
    // contenerlo. Il margine copre le sovrapposizioni fra pagine contigue.
    const scanned = (seek.scanned | 0) + feed.length;
    const overshot =
      (typeof seek.target === "number" && scanned > seek.target + 30) ||
      pageOlderThanMarker(feed, marker);

    if (!feed.length || overshot || page >= archiveMaxPages()) {
      // Fine ricerca senza esito (pagina vuota, tetto raggiunto, o segnalibro
      // ormai superato): fermarsi, non navigare all'infinito. E dirlo: la
      // ricerca sfoglia pagine da sola, se smette in silenzio sembra che si sia
      // rotta qualcosa.
      await removeStore(K.seek);
      showSeekToast(
        overshot
          ? "Ho sfogliato l'archivio oltre la posizione dell'ultima letta senza " +
              "trovarla: il sito non la elenca più (forse è stata rimossa o " +
              "spostata). Ricerca fermata a pagina " +
              page +
              ", il segnalibro resta dov'è."
          : "Non sono riuscito ad arrivare all'ultima letta: la ricerca si è " +
              "fermata a pagina " +
              page +
              ". Il segnalibro resta dov'è.",
        true
      );
      try {
        console.log(
          "[Segnalibro] ricerca nell'archivio interrotta a pagina",
          page
        );
      } catch (e) {}
      return;
    }
    // Ogni pagina è un caricamento nuovo: il toast dice a che punto siamo,
    // altrimenti si vedono solo pagine che scorrono da sole.
    showSeekToast(
      "Non è a pagina " + page + ": vado a pagina " + (page + 1) + "…"
    );
    // ts originale invariato: il TTL limita la durata TOTALE della ricerca.
    const next = { page: page + 1, ts: seek.ts, scanned: scanned };
    if (typeof seek.target === "number") next.target = seek.target;
    await setStore({ [K.seek]: next });
    location.assign(archiveUrlFor(page + 1));
  }

  // ---- conteggio esatto dall'archivio ----
  // Quando il segnalibro non è tra le notizie della home, unread = feed.length è
  // solo un limite inferiore (sui feed statici tipo hwupgrade il badge direbbe
  // sempre "42"). Sui siti con archivio paginato si scaricano allora le pagine
  // archivio via fetch (stessa origine: nessun permesso extra) e si conta la
  // posizione del marker nella sequenza completa = numero vero di non lette.
  // Qualunque errore (rete, markup) lascia il fallback "N+"; oltre il tetto di
  // pagine il numero resta un limite inferiore (exact=false).
  const COUNT_MAX_PAGES = 5; // ~30 notizie a pagina: conteggio esatto fino a ~150
  const COUNT_TTL_MS = 10 * 60 * 1000;
  let refined = null; // { count, exact } — esito del conteggio (null = non fatto)
  let refining = false; // conteggio in corso: il toast aspetta l'esito

  // Scarica una pagina del sito (stessa origine: nessun permesso extra) e la
  // restituisce parsata. Senza credenziali: sono pagine pubbliche, non serve
  // presentarsi come l'utente (vedi PRIVACY.md).
  async function fetchFeedDoc(url) {
    try {
      const resp = await fetch(url, { credentials: "omit" });
      if (!resp.ok) return null;
      return new DOMParser().parseFromString(await resp.text(), "text/html");
    } catch (e) {
      return null;
    }
  }

  async function countUnreadInArchive(markerKey) {
    const seen = new Set();
    let count = 0;
    // Tetto per sito: le pagine hanno dimensioni diverse (hwupgrade ~30
    // notizie, hdblog ~9-10) e il default coprirebbe troppo poco.
    const maxPages = site.archive.countMaxPages || COUNT_MAX_PAGES;
    // Quel che abbiamo già contato quando la sequenza si interrompe (rete,
    // markup, fine dell'archivio) è comunque un limite inferiore valido: meglio
    // "90+" che ricadere sul numero di notizie caricate in pagina.
    const partial = () => (count > 0 ? { count: count, exact: false } : null);
    for (let page = 1; page <= maxPages; page++) {
      const url = countUrlFor(page);
      const doc = await fetchFeedDoc(url);
      if (!doc) return partial();
      const articles = collectArticles(doc, url);
      // Pagina senza notizie = fine dell'archivio o markup cambiato (hdblog
      // risponde così da page=11 in poi): non si va oltre.
      if (!articles.length) return partial();
      for (const a of articles) {
        // Le pagine possono sovrapporsi (il feed scorre tra un fetch e l'altro).
        if (seen.has(a.key)) continue;
        seen.add(a.key);
        if (a.key === markerKey) return { count: count, exact: true };
        count++;
      }
    }
    return { count: count, exact: false }; // marker oltre il tetto: limite inferiore
  }

  async function refineUnread(markerKey, newestKey) {
    let res = null;
    try {
      const stored = await getStore([K.count]);
      const cached = stored[K.count];
      if (
        cached &&
        cached.marker === markerKey &&
        cached.newest === newestKey &&
        typeof cached.count === "number" &&
        typeof cached.ts === "number" &&
        Date.now() - cached.ts < COUNT_TTL_MS
      ) {
        res = { count: cached.count, exact: !!cached.exact };
      } else {
        res = await countUnreadInArchive(markerKey);
        if (res) {
          await setStore({
            [K.count]: {
              marker: markerKey,
              newest: newestKey,
              count: res.count,
              exact: res.exact,
              ts: Date.now(),
            },
          });
        }
      }
    } catch (e) {
      res = null;
    }
    // Il marker può essere cambiato nel frattempo (es. "Segna tutte come lette"):
    // in quel caso l'esito non vale più.
    if (res && state.markerKey === markerKey) refined = res;
    refining = false;
    applyHighlight(); // ri-applica col numero esatto (o sblocca il toast col fallback)
  }

  // ---- "Vai all'ultima letta" ----

  let seekBusy = false;

  async function scrollToMarker() {
    // Popup e toast possono chiamarla entrambi: una ricerca alla volta.
    if (seekBusy) return false;
    seekBusy = true;
    seekCancelled = false; // nuova ricerca: l'eventuale annullamento è vecchio
    try {
      return await seekMarker();
    } finally {
      seekBusy = false;
    }
  }

  // Posizione del segnalibro nella sequenza del sito, se la conosciamo con
  // esattezza (= quante notizie non lette): null se è solo un limite inferiore.
  function exactMarkerIndex() {
    if (refined) return refined.exact ? refined.count : null;
    if (lastStatus && lastStatus.archive && !lastStatus.approx && lastStatus.unread > 0)
      return lastStatus.unread;
    return null;
  }

  // Miglior stima della posizione del segnalibro nella sequenza del sito (0 =
  // la più recente), anche solo come LIMITE INFERIORE: serve a scegliere da
  // quale pagina d'archivio partire (archiveStartPage). È il numero di non
  // lette dell'ultimo stato della home — esatto se contato, altrimenti un
  // minimo garantito. Un limite inferiore non fa mai saltare il segnalibro:
  // le posizioni col tempo possono solo crescere.
  function markerPositionLowerBound() {
    if (refined) return refined.count;
    if (lastStatus && lastStatus.onHome && lastStatus.unread > 0)
      return lastStatus.unread;
    return null;
  }

  async function seekMarker() {
    let el = document.querySelector(".hdb-marker");
    // Se il segnalibro non è ancora nel DOM (notizia sotto la piega non ancora
    // caricata), si scende a forza di scroll finché il feed smette di crescere
    // (growFeedByScrolling), ri-applicando l'evidenziazione a ogni giro e
    // fermandosi appena la notizia compare. Il segnalibro può stare MOLTO in
    // basso: la home di hdblog arriva a ~100 notizie in 8 blocchi, ognuno una
    // richiesta di rete, quindi la pazienza è tutto (vedi bug #15).
    // Quattro casi in cui scrollare è inutile e si va dritti all'archivio:
    //  - feed FISSO (site.feedStatic: è già tutto nel DOM);
    //  - siamo GIÀ in una pagina d'archivio (la ricerca prosegue alla pagina
    //    dopo; questa l'ha già sfogliata initArchive);
    //  - il conteggio ha già sfogliato TUTTO quel che il sito serve alla home
    //    senza trovare il segnalibro (refined.exact === false): è oltre il muro
    //    del lazy-load, scrollare non lo farà comparire;
    //  - il sito dichiara il suo lazy-load inaffidabile (site.noScrollSeek:
    //    hdblog raddoppia ogni blocco e si ferma a ~60 notizie, bug #16) e ha
    //    un archivio che copre anche la home: lì si arriva senza scrollare.
    const beyondFeed = !!(refined && !refined.exact);
    const onArchivePage = archivePageNum() !== null;
    if (
      !el &&
      state.markerKey &&
      !site.feedStatic &&
      !(site.noScrollSeek && site.archive) &&
      !beyondFeed &&
      !onArchivePage
    ) {
      // La ricerca è già "in corso" da adesso, prima ancora di scrollare: se il
      // sito ci porta via da solo (il suo pulsante "altre notizie" cliccato
      // dall'handler dello scroll) la pagina d'arrivo la RIPRENDE invece di
      // lasciarci lì fermi. Il guard di growFeedByScrolling di norma lo
      // impedisce; questo è il paracadute per i casi che non passano dal clic.
      if (site.archive) {
        const parachute = {
          page: archiveFirstPage(),
          ts: Date.now(),
          scanned: 0,
        };
        const target = exactMarkerIndex();
        if (typeof target === "number") parachute.target = target;
        await setStore({ [K.seek]: parachute });
      }
      showSeekToast("Cerco l'ultima letta… carico le notizie più vecchie");
      await growFeedByScrolling(state.markerKey, (feed) => {
        reapplyIfChanged();
        showSeekToast(
          "Cerco l'ultima letta… " + feed.length + " notizie caricate"
        );
      });
      reapplyIfChanged();
      el = document.querySelector(".hdb-marker");
      // Trovata (o comunque finito lo scroll): il flag di ricerca non deve
      // restare appeso, o la prossima visita all'archivio verrebbe dirottata.
      if (site.archive && el) await removeStore(K.seek);
    } else if (
      !el &&
      state.markerKey &&
      site.noScrollSeek &&
      !beyondFeed &&
      !onArchivePage
    ) {
      // Niente scroll, ma il feed può crescere da solo: dopo "Ricarica pulita"
      // hdblog riapre tutti i blocchi già caricati con UNA richiesta (ancora
      // #?t=…&b=N), e la ricerca riparte subito dopo il caricamento, magari
      // prima che la risposta arrivi. Un attimo di pazienza prima di decidere
      // che il segnalibro non è in pagina e portare l'utente altrove.
      showSeekToast("Cerco l'ultima letta…");
      await waitFeedSettled(state.markerKey);
      reapplyIfChanged();
      el = document.querySelector(".hdb-marker");
    }
    if (el) {
      dismissSeekToast();
      flashAndCenter(el);
      return true;
    }
    // Annullata con la × mentre caricava: non si prosegue nell'archivio (il
    // flag l'ha già tolto il pulsante di chiusura).
    if (seekCancelled) return false;

    // Feed della pagina finito senza trovare il segnalibro: la ricerca continua
    // nell'ARCHIVIO paginato del sito, pagina per pagina (vedi initArchive) —
    // /news/indexN.html su hwupgrade, /page/N/ su hdblog (le pagine del
    // bottone "Clicca qui per Altre Notizie").
    if (site.archive && state.markerKey) {
      // Se siamo già in una pagina dell'archivio, si riprende da quella DOPO:
      // le precedenti le abbiamo appena scartate. Dalla home si parte dalla
      // pagina che contiene la posizione nota del segnalibro (hdblog: 100
      // notizie a pagina, quindi "150 non lette" -> dritti a pagina 2).
      const cur = archivePageNum();
      return await startArchiveSeek(
        cur === null ? archiveStartPage(markerPositionLowerBound()) : cur + 1,
        // Posizione esatta del segnalibro, quando la conosciamo: dice alla
        // passeggiata nell'archivio quando è inutile andare oltre. Sulla home
        // viene dal conteggio; da una pagina d'archivio (dove il conteggio non
        // gira) è l'ultimo stato noto della home, se era un numero esatto.
        exactMarkerIndex()
      );
    }
    // Niente archivio (o niente segnalibro): meglio dirlo che restare muti —
    // il pulsante sembrerebbe rotto.
    if (state.markerKey)
      showSeekToast(
        "Non sono riuscito a trovare l'ultima letta in questa pagina. " +
          "Il segnalibro resta dov'è.",
        true
      );
    return false;
  }

  // ---- ricarica "pulita" (senza spostare il segnalibro) ----
  // Ricaricare la pagina fa sparire i doppioni: il server rirenderizza la home e
  // hdblog, grazie all'ancora #?t=...&b=N che scrive lui stesso mentre scorri,
  // richiede TUTTI i blocchi già aperti in una sola volta — un'istantanea
  // coerente, quindi niente scorrimento della paginazione (vedi hideDuplicates).
  // Il problema è che un caricamento normale conta come visita nuova: con
  // reached=true il segnalibro avanzerebbe a "sei in pari", buttando via le
  // notizie non ancora lette (segnalato dall'utente). Qui ricarichiamo NOI
  // mettendo KEEP_PARAM nell'URL, che init() legge come "stessa visita".
  const RESCROLL_TTL_MS = 2 * 60 * 1000;

  async function reloadKeepingMarker() {
    try {
      // Dopo il ricaricamento si torna da soli all'ultima letta: la ricarica non
      // deve costare né il segnalibro né il punto in cui eri.
      await setStore({ [K.rescroll]: { ts: Date.now() } });
      const u = new URL(location.href);
      u.searchParams.set(KEEP_PARAM, "1");
      // replace() e non assign(): non lasciamo in cronologia l'URL col marcatore
      // (viene comunque ripulito da stripVisitParams al caricamento). L'ANCORA
      // resta, ed è quella che fa rirenderizzare a hdblog i blocchi già aperti.
      location.replace(u.href);
    } catch (e) {
      location.reload();
    }
    return true;
  }

  async function markAllRead() {
    const onArchive = !!(lastStatus && lastStatus.archive);

    // Qual è "la più recente"? Sulla home è feed[0]. Nell'ARCHIVIO no: lì il feed
    // è un pezzo di storico, e feed[0] di /news/index5.html è una notizia vecchia —
    // usarla sposterebbe il segnalibro all'INDIETRO, gonfiando le non lette. La più
    // recente vera è quella registrata all'ultimo caricamento della home (pending).
    let newest = null;
    if (onArchive) {
      const store = await getStore([K.pending, K.marker]);
      newest = store[K.pending] || store[K.marker] || null;
    } else {
      const feed = getFeedArticles();
      newest = feed.length ? feed[0].key : null;
    }
    if (!newest) return lastStatus;

    state.markerKey = newest;
    refined = null; // l'eventuale conteggio dall'archivio riguardava il vecchio marker
    refining = false;
    reachedThisVisit = true; // sei in pari per definizione
    await setStore({
      [K.marker]: newest,
      [K.pending]: newest,
      [K.init]: true,
      [K.reached]: true,
    });
    // Una ricerca dell'ultima letta ancora in corso non ha più senso.
    await removeStore(K.seek);

    if (!onArchive) return applyHighlight();

    // Nell'archivio non c'è nulla da ricalcolare (il conteggio vive sulla home):
    // azzeriamo stato, badge ed evidenziazione di questa pagina, che ora punta a
    // una notizia più VECCHIA del segnalibro.
    clearHighlight();
    lastStatus.unread = 0;
    lastStatus.approx = false;
    lastStatus.found = false;
    lastStatus.markerTitle = "";
    setBadge(0);
    // Aggiorna anche l'ultimo stato noto della home, da cui l'archivio legge il
    // conteggio: senza questo, cambiando pagina si rivedrebbe il numero vecchio.
    await setStore({
      ["status_" + site.id]: {
        onHome: true,
        siteName: site.name,
        unread: 0,
        approx: false,
        found: false,
        markerTitle: "",
        total: 0,
      },
    });
    return lastStatus;
  }

  // -------- pop-up in pagina (toast) --------

  let toastEl = null;
  let toastDone = false;
  let toastTimer = null;

  // Il toast resta visibile 7 secondi DI SGUARDO: il conto alla rovescia corre
  // solo mentre la scheda è visibile. Aprendo la home in una scheda in
  // background (es. più siti aperti insieme), il toast aspetta che l'utente
  // arrivi sulla scheda; se cambia scheda a metà si mette in pausa e riparte
  // dal tempo residuo al ritorno.
  const TOAST_MS = 7000;
  let toastLeft = TOAST_MS; // tempo di visualizzazione residuo
  let toastShownAt = 0; // avvio (o ripresa) del conto alla rovescia

  function startToastTimer() {
    if (toastTimer || !toastEl || toastDone) return;
    toastShownAt = Date.now();
    toastTimer = setTimeout(dismissToast, toastLeft);
  }

  function pauseToastTimer() {
    if (!toastTimer) return;
    clearTimeout(toastTimer);
    toastTimer = null;
    // Minimo 1s: tornando sulla scheda all'ultimo istante il toast non deve
    // sparire subito.
    toastLeft = Math.max(1000, toastLeft - (Date.now() - toastShownAt));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startToastTimer();
    else pauseToastTimer();
  });

  function toastMessage(status) {
    if (status.found && status.unread > 0) {
      return {
        num: formatUnread(status.unread, false),
        title:
          status.unread === 1
            ? "notizia nuova da leggere"
            : "notizie nuove da leggere",
        canGo: true,
      };
    }
    if (!status.found && status.unread > 0) {
      // Il segnalibro è più in basso, oltre le notizie già caricate: il numero
      // è quello contato nell'archivio (refineUnread) oppure un limite inferiore
      // mostrato come "N+". Il bottone funziona lo stesso (scrollToMarker forza
      // il lazy-load; sui siti con archivio paginato prosegue la ricerca lì).
      return {
        num: formatUnread(status.unread, status.approx),
        title: site.archive
          ? "notizie nuove"
          : "notizie nuove",
        canGo: true,
      };
    }
    return null; // sei aggiornato: niente toast
  }

  function dismissToast() {
    toastDone = true;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!toastEl) return;
    const el = toastEl;
    toastEl = null;
    el.classList.remove("hdb-toast-in");
    el.classList.add("hdb-toast-out");
    setTimeout(() => el.remove(), 300);
  }

  function renderToast(status) {
    if (settings && settings.showToast === false) return;
    const msg = toastMessage(status);
    if (!msg) {
      if (toastEl) dismissToast();
      return;
    }
    if (toastDone) return;

    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "hdb-toast";
      toastEl.innerHTML =
        '<span class="hdb-toast-num"></span>' +
        '<span class="hdb-toast-body">' +
        '<span class="hdb-toast-title"></span>' +
        "<button type=\"button\" class=\"hdb-toast-go\">Vai all'ultima letta &rarr;</button>" +
        "</span>" +
        '<button type="button" class="hdb-toast-close" aria-label="Chiudi">&times;</button>';
      (document.body || document.documentElement).appendChild(toastEl);

      toastEl
        .querySelector(".hdb-toast-close")
        .addEventListener("click", (e) => {
          e.stopPropagation();
          dismissToast();
        });
      toastEl.querySelector(".hdb-toast-go").addEventListener("click", (e) => {
        e.stopPropagation();
        scrollToMarker();
        dismissToast();
      });

      requestAnimationFrame(() => {
        if (toastEl) toastEl.classList.add("hdb-toast-in");
      });
      // Scheda in background: il timer partirà al visibilitychange.
      if (document.visibilityState === "visible") startToastTimer();
    }

    toastEl.querySelector(".hdb-toast-num").textContent = msg.num;
    toastEl.querySelector(".hdb-toast-title").textContent = msg.title;
    toastEl.querySelector(".hdb-toast-go").style.display = msg.canGo ? "" : "none";
  }

  // -------- toast della ricerca ("Vai all'ultima letta") --------
  // La ricerca dell'ultima letta può sfogliare parecchie pagine dell'archivio,
  // una navigazione dopo l'altra: senza un segnale sullo schermo sembra che il
  // browser stia impazzendo (o, se finisce a vuoto, che il pulsante non abbia
  // fatto nulla — è così che il guasto è apparso all'utente).
  // Questo toast non dipende dall'impostazione showToast: è la risposta a un
  // clic, non un avviso che arriva da solo. La × ferma la ricerca togliendo il
  // flag seek, così la pagina successiva non riparte da sola.
  let seekEl = null;
  let seekTimer = null;
  // La × non deve solo togliere il flag (che ferma la pagina SUCCESSIVA): deve
  // fermare anche quello che sta succedendo adesso, cioè lo scroll che carica il
  // feed. Si azzera all'inizio di ogni ricerca.
  let seekCancelled = false;

  function showSeekToast(text, final) {
    if (!seekEl) {
      // I due toast stanno nello stesso angolo: quello delle notizie nuove ha
      // già fatto il suo lavoro (l'utente ha premuto il pulsante), si toglie.
      dismissToast();
      seekEl = document.createElement("div");
      seekEl.className = "hdb-toast hdb-toast-seek";
      seekEl.innerHTML =
        '<span class="hdb-spin"></span>' +
        '<span class="hdb-toast-body"><span class="hdb-toast-title"></span></span>' +
        '<button type="button" class="hdb-toast-close" aria-label="Chiudi">&times;</button>';
      (document.body || document.documentElement).appendChild(seekEl);
      seekEl.querySelector(".hdb-toast-close").addEventListener("click", (e) => {
        e.stopPropagation();
        seekCancelled = true; // ferma lo scroll in corso
        if (K) removeStore(K.seek); // niente auto-navigazione alla prossima pagina
        dismissSeekToast();
      });
      requestAnimationFrame(() => {
        if (seekEl) seekEl.classList.add("hdb-toast-in");
      });
    }
    seekEl.querySelector(".hdb-toast-title").textContent = text;
    seekEl.classList.toggle("hdb-toast-final", !!final);
    if (seekTimer) {
      clearTimeout(seekTimer);
      seekTimer = null;
    }
    // Il messaggio finale resta un po' e poi se ne va da solo; quello di
    // avanzamento resta finché la ricerca è in corso.
    if (final) seekTimer = setTimeout(dismissSeekToast, 9000);
  }

  function dismissSeekToast() {
    if (seekTimer) {
      clearTimeout(seekTimer);
      seekTimer = null;
    }
    if (!seekEl) return;
    const el = seekEl;
    seekEl = null;
    el.classList.remove("hdb-toast-in");
    el.classList.add("hdb-toast-out");
    setTimeout(() => el.remove(), 300);
  }

  // -------- messaggi dal popup --------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "getStatus") {
      sendResponse(lastStatus);
      return true;
    }
    if (msg.type === "scrollToMarker") {
      // Lo scroll (che può caricare notizie sotto la piega) prosegue nella pagina
      // anche dopo la chiusura del popup: rispondiamo subito.
      scrollToMarker();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "reloadClean") {
      // La navigazione parte comunque anche se il popup si chiude: rispondiamo
      // prima, altrimenti il canale muore insieme alla pagina.
      sendResponse({ ok: true });
      reloadKeepingMarker();
      return true;
    }
    if (msg.type === "markAllRead") {
      // Asincrona (nell'archivio deve leggere "pending" dallo storage): il canale
      // resta aperto finché non arriva la risposta.
      markAllRead().then(
        (st) => sendResponse(st),
        () => sendResponse(lastStatus)
      );
      return true;
    }
  });

  // -------- avvio --------

  async function init() {
    if (!site) {
      lastStatus = { onHome: false, siteName: null };
      return;
    }

    settings = await getSettings();

    if (!settings.enabled) {
      lastStatus = { onHome: isHome(), siteName: site.name, disabled: true };
      setBadge(0);
      return;
    }

    // Pagina dell'archivio paginato (es. hwupgrade /news/indexN.html): cerca ed
    // evidenzia il segnalibro senza MAI avanzarlo; se è in corso "Vai all'ultima
    // letta" (flag seek) gestisce anche l'auto-navigazione tra le pagine.
    if (!site.trackingOnly && site.archive) {
      const page = archivePageNum();
      if (page !== null) {
        await initArchive(page);
        return;
      }
    }

    if (!isHome()) {
      lastStatus = { onHome: false, siteName: site.name };
      // Pagina articolo: raccogli interessi (se attivo).
      if (settings.trackInterests && isArticlePage()) {
        try {
          const ig = await getStore("ignoreWords");
          ignoreSet = new Set(
            (ig.ignoreWords || []).map((w) => deaccent(String(w).toLowerCase()))
          );
          trackArticle();
        } catch (e) {}
      } else if (settings.trackInterests) {
        try {
          console.log(
            "[Segnalibro] pagina NON riconosciuta come articolo (non tracciata):",
            location.pathname
          );
        } catch (e) {}
      }
      return;
    }

    // Sito solo-tracciamento (es. hdmotori): niente segnalibro sulla home.
    if (site.trackingOnly) {
      lastStatus = { onHome: true, siteName: site.name, trackingOnly: true };
      return;
    }

    applyAccent();

    const feed = await waitForFeed();

    if (!feed.length) {
      lastStatus = {
        onHome: true,
        siteName: site.name,
        unread: 0,
        found: false,
        total: 0,
        empty: true,
      };
      setStore({ ["status_" + site.id]: lastStatus });
      setBadge(0);
      return;
    }

    const currentNewest = feed[0].key;
    let store = await getStore([
      K.marker,
      K.pending,
      K.init,
      K.reached,
      K.rescroll,
    ]);

    // Migrazione dal formato v1 (solo hdblog, chiavi senza suffisso).
    if (!store[K.init] && site.id === "hdblog") {
      const legacy = await getStore(["marker", "pending", "initialized"]);
      if (legacy.initialized) {
        store = {
          [K.marker]: legacy.marker,
          [K.pending]: legacy.pending || legacy.marker,
          [K.init]: true,
        };
      }
    }

    // Ricaricamento automatico del sito, oppure "Ricarica pulita" chiesta
    // dall'utente (vedi detectSameVisitLoad): è la STESSA visita, non una nuova.
    // Vale solo a segnalibro già inizializzato.
    const sameVisit = !!store[K.init] && sameVisitLoad;

    let marker, pending;
    if (!store[K.init]) {
      // prima volta in assoluto: entrambi i segnalibri sull'ultima notizia
      marker = currentNewest;
      pending = currentNewest;
    } else if (sameVisit) {
      // Niente si muove: la visita resta agganciata al caricamento con cui è
      // iniziata. Anche "pending" resta fermo di proposito, così alla prossima
      // visita VERA il marker riparte dalla notizia più recente di quando avevi
      // aperto la pagina, non da quelle uscite mentre stavi leggendo.
      marker = store[K.marker] || store[K.pending] || currentNewest;
      pending = store[K.pending] || currentNewest;
    } else if (settings.freezeMarker) {
      // Segnalibro bloccato dalle impostazioni: non avanza mai da solo, nemmeno
      // dopo averlo raggiunto. Solo "Segna tutte come lette" lo sposta.
      // "pending" continua ad aggiornarsi: se un giorno l'opzione si spegne, il
      // registro riparte dalla notizia più recente dell'ultimo caricamento.
      marker = store[K.marker] || store[K.pending] || currentNewest;
      pending = currentNewest;
    } else if (store[K.reached]) {
      // Nella visita precedente il segnalibro era stato RAGGIUNTO (visto sullo
      // schermo): avanza di un passo — il marker prende il 2° segnalibro
      // precedente; il 2° diventa l'ultima attuale.
      marker = store[K.pending] || currentNewest;
      pending = currentNewest;
    } else {
      // Segnalibro MAI raggiunto nella visita precedente (es. oltre il lazy-load,
      // o troppe notizie accumulate): il marker NON avanza — l'ultima letta vera
      // va mantenuta, anche per molti caricamenti di fila. Solo pending si
      // aggiorna, così quando l'utente raggiungerà il segno il passo successivo
      // riparte dalla notizia più recente dell'ULTIMA visita in cui ha recuperato.
      marker = store[K.marker] || store[K.pending] || currentNewest;
      pending = currentNewest;
    }

    await setStore({
      [K.marker]: marker,
      [K.pending]: pending,
      [K.init]: true,
      // Se la visita continua (refresh automatico o "Ricarica pulita") il
      // "raggiunto" NON si azzera, altrimenti il ricaricamento cancellerebbe anche
      // il fatto che il segnalibro l'avevi già visto, bloccando l'avanzamento alla
      // visita successiva.
      [K.reached]: sameVisit ? !!store[K.reached] : false,
    });
    state.markerKey = marker;
    // Coerente con lo storage: se il segnalibro era già stato raggiunto prima del
    // ricaricamento, non serve rimettersi a osservarlo.
    if (sameVisit && store[K.reached]) reachedThisVisit = true;

    // Segnalibro fuori dal feed + archivio disponibile: parte il conteggio esatto
    // (asincrono, non blocca l'evidenziazione). Il toast aspetta l'esito; badge e
    // popup mostrano intanto il limite inferiore "N+".
    if (site.archive && !feed.some((a) => a.key === marker)) {
      refining = true;
      refineUnread(marker, currentNewest);
    }

    applyHighlight();
    lastSig = currentSig();
    startFeedWatch();

    // Veniamo da "Ricarica pulita": riportiamo l'utente dov'era. Il flag si
    // consuma SEMPRE (anche scaduto o su un caricamento qualsiasi), così non
    // resta appeso a dirottare una visita futura; agisce solo se la ricarica è
    // davvero la NOSTRA (keepLoad, non un auto-refresh del sito) ed è recente.
    const rescroll = store[K.rescroll];
    if (rescroll) {
      await removeStore(K.rescroll);
      if (
        keepLoad &&
        typeof rescroll.ts === "number" &&
        Date.now() - rescroll.ts < RESCROLL_TTL_MS
      ) {
        scrollToMarker();
      }
    }
  }

  init();
})();

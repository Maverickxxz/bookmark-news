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

  // Notizie del feed, dalla più recente alla più vecchia.
  function getFeedArticles() {
    let els = Array.prototype.slice.call(
      document.querySelectorAll(site.articleSelector)
    );
    if (site.newestLast) els.reverse();

    const out = [];
    const seen = new Set();
    for (const el of els) {
      const a = pickLink(el);
      if (!a) continue;
      const href = a.getAttribute("href");
      if (!href) continue;
      const key = articleKey(href);
      if (!key || seen.has(key)) continue;
      let url;
      try {
        url = new URL(href, location.href).href;
      } catch (e) {
        continue;
      }
      seen.add(key);
      out.push({ el, key, url, title: (a.textContent || "").trim() });
    }
    return out;
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

  // -------- impostazioni --------

  const DEFAULT_SETTINGS = { enabled: true, showToast: true, trackInterests: true };
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

  function setBadge(count) {
    try {
      chrome.runtime.sendMessage({
        type: "setBadge",
        count: count,
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

  function applyHighlight() {
    if (!state.markerKey) return lastStatus;
    const feed = getFeedArticles();
    clearHighlight();

    let unread = 0;
    let found = false;
    let markerTitle = "";

    const idx = feed.findIndex((a) => a.key === state.markerKey);
    if (idx >= 0) {
      found = true;
      unread = idx; // quante notizie stanno sopra (più recenti) = non lette
      markerTitle = feed[idx].title;
      const el = feed[idx].el;
      el.classList.add("hdb-marker");
      if (!el.querySelector(".hdb-label")) {
        const lab = document.createElement("span");
        lab.className = "hdb-label";
        lab.textContent = "Ultima letta";
        el.appendChild(lab);
      }
      // Ri-agganciato a ogni applicazione: il sito può sostituire il nodo (re-render).
      watchMarkerReached(el);
    } else {
      found = false;
      unread = feed.length; // segnalibro fuori dalla lista caricata: tutte da leggere
    }

    lastStatus = {
      onHome: true,
      siteName: site.name,
      unread: unread,
      found: found,
      markerTitle: markerTitle,
      total: feed.length,
    };
    setStore({ ["status_" + site.id]: lastStatus });
    setBadge(unread);
    renderToast(lastStatus);
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
  function currentSig() {
    const feed = getFeedArticles();
    if (!feed.length) return null; // feed vuoto/transitorio (re-render): non toccare
    const idx = state.markerKey
      ? feed.findIndex((a) => a.key === state.markerKey)
      : -1;
    const el = idx >= 0 ? feed[idx].el : null;
    const has = !!(el && el.classList.contains("hdb-marker"));
    return feed.length + "|" + idx + "|" + (has ? 1 : 0);
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

  async function scrollToMarker() {
    let el = document.querySelector(".hdb-marker");
    // Se il segnalibro non è ancora nel DOM (notizia sotto la piega non ancora
    // caricata), scendi un po' alla volta per forzarne il caricamento, poi
    // ri-applica la classe e fermati appena compare. Il segnalibro può stare
    // MOLTO in basso (tante notizie accumulate): si smette solo quando la pagina
    // non scende più da un po' (fondo raggiunto e niente di nuovo caricato) o a
    // un tetto massimo di sicurezza.
    if (!el && state.markerKey) {
      let stuck = 0;
      for (let i = 0; i < 120 && !el && stuck < 8; i++) {
        const before = window.scrollY;
        window.scrollBy(0, Math.max(600, Math.round(window.innerHeight * 0.9)));
        await sleep(200);
        stuck = window.scrollY === before ? stuck + 1 : 0;
        reapplyIfChanged();
        el = document.querySelector(".hdb-marker");
      }
    }
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("hdb-flash");
    void el.offsetWidth; // restart animazione
    el.classList.add("hdb-flash");
    return true;
  }

  function markAllRead() {
    const feed = getFeedArticles();
    if (!feed.length) return lastStatus;
    state.markerKey = feed[0].key;
    reachedThisVisit = true; // sei in pari per definizione
    setStore({
      [K.marker]: feed[0].key,
      [K.pending]: feed[0].key,
      [K.init]: true,
      [K.reached]: true,
    });
    return applyHighlight();
  }

  // -------- pop-up in pagina (toast) --------

  let toastEl = null;
  let toastDone = false;
  let toastTimer = null;

  function toastMessage(status) {
    if (status.found && status.unread > 0) {
      return {
        num: status.unread > 99 ? "99+" : String(status.unread),
        title:
          status.unread === 1
            ? "notizia nuova da leggere"
            : "notizie nuove da leggere",
        canGo: true,
      };
    }
    if (!status.found && status.total > 0) {
      // Il segnalibro è più in basso, oltre le notizie già caricate: il bottone
      // funziona lo stesso (scrollToMarker forza il lazy-load scendendo a step).
      return {
        num: status.total > 99 ? "99+" : String(status.total),
        title: "notizie nuove (l'ultima letta è più in basso)",
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
      toastTimer = setTimeout(dismissToast, 7000);
    }

    toastEl.querySelector(".hdb-toast-num").textContent = msg.num;
    toastEl.querySelector(".hdb-toast-title").textContent = msg.title;
    toastEl.querySelector(".hdb-toast-go").style.display = msg.canGo ? "" : "none";
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
    if (msg.type === "markAllRead") {
      sendResponse(markAllRead());
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
    let store = await getStore([K.marker, K.pending, K.init, K.reached]);

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

    let marker, pending;
    if (!store[K.init]) {
      // prima volta in assoluto: entrambi i segnalibri sull'ultima notizia
      marker = currentNewest;
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
      [K.reached]: false, // si riparte: andrà ri-raggiunto in questa visita
    });
    state.markerKey = marker;

    applyHighlight();
    lastSig = currentSig();
    startFeedWatch();
  }

  init();
})();

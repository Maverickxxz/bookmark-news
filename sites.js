/*
 * REGISTRO DEI SITI SUPPORTATI
 * ============================
 * Per aggiungere un nuovo sito di notizie servono 2 passi:
 *
 *   1) Aggiungi un blocco qui sotto in NEWS_SITES (vedi il TEMPLATE in fondo).
 *   2) Aggiungi gli host del sito in manifest.json, nel campo "matches" del
 *      content script (una riga "https://HOST/*" per ogni host).
 *
 * Poi ricarica l'estensione da chrome://extensions (pulsante di refresh).
 *
 * Campi di ogni sito:
 *   id              stringa unica interna (es. "hdblog"). Identifica il segnalibro salvato.
 *   name            nome mostrato nel popup.
 *   color           colore accento (evidenziazione + badge). Formato #rrggbb.
 *   hosts           array di hostname su cui agire (es. ["www.sito.it","sito.it"]).
 *   homePaths       percorsi considerati "home" (default ["/", ""]).
 *   articleSelector selettore CSS di OGNI notizia del feed principale, in ordine
 *                   dalla più recente (in alto) alla più vecchia.
 *                   Può essere anche scoped, es. "#lista article.card".
 *   linkSelector    selettore del link (URL + titolo) DENTRO la notizia. Se le notizie
 *                   sono già dei <a>, questo può coincidere con l'elemento stesso.
 *   idRegex         (opzionale) regex applicata al PERCORSO dell'URL per estrarre un id
 *                   stabile: se il gruppo 1 matcha, la chiave diventa idPrefix + gruppo1.
 *                   Se vuota, la chiave è host + percorso.
 *   idPrefix        (opzionale) prefisso da anteporre all'id estratto da idRegex.
 *   newestLast      (opzionale) true se nel DOM la notizia più recente è l'ULTIMA
 *                   invece della prima (raro). Default false.
 *
 *   trackingOnly    (opzionale) true = nessun segnalibro sulla home; si registrano solo
 *                   gli articoli aperti (es. hdmotori). Non servono articleSelector/idRegex.
 *
 *   autoRefreshParam (opzionale) nome di un parametro nella query string con cui il SITO
 *                   marca i propri ricaricamenti automatici della home (es. hdblog:
 *                   <meta http-equiv="refresh" content="777;url=https://www.hdblog.it/?refresh_ce">
 *                   -> "refresh_ce"). Quando l'URL porta quel parametro, il caricamento NON
 *                   viene contato come una nuova visita: il segnalibro non avanza e il flag
 *                   "reached" resta com'era. Serve un marcatore nell'URL perché il tipo di
 *                   navigazione non basta: un reload fatto dal sito è indistinguibile dall'F5
 *                   dell'utente. Subito dopo averlo letto, content.js RIMUOVE il parametro
 *                   dall'URL (history.replaceState): senza quella pulizia la scheda resterebbe
 *                   ferma su .../?refresh_ce e ogni ricaricamento sarebbe scambiato per
 *                   automatico.
 *
 *   feedStatic      (opzionale) true se il feed della home è TUTTO nel DOM già al
 *                   caricamento (nessun lazy-load): scrollare non carica altre notizie,
 *                   quindi "Vai all'ultima letta" salta lo scroll e passa all'archivio.
 *   archive         (opzionale) archivio paginato ("tutte le notizie") dove continuare
 *                   la ricerca del segnalibro quando non sta nel feed della home.
 *                   Le pagine archivio devono usare gli stessi articleSelector/linkSelector:
 *                     urlBase   URL della pagina archivio SENZA numero né estensione
 *                               (pagina 1 = urlBase+".html", pagina N = urlBase+N+".html")
 *                     urlTemplate (alternativa a urlBase) URL con {n} al posto del numero
 *                               di pagina, per archivi con altro formato (es. hdblog:
 *                               endpoint ajax ?page={n}, numerato da 1)
 *                     pathRegex regex sul PERCORSO che riconosce le pagine archivio;
 *                               gruppo 1 = numero di pagina (vuoto = pagina 1)
 *                     firstPage prima pagina da cui far partire la ricerca (default 1;
 *                               2 se la pagina 1 ripete quel che c'è già nella home)
 *                     maxPages  tetto di pagine esplorate in automatico (default 40)
 *                     countTemplate (opzionale) URL alternativo da usare SOLO per il
 *                               conteggio, con {n} al posto del numero di pagina: serve
 *                               quando le pagine navigabili non sono scaricabili via
 *                               fetch (hdblog: 429 a chi non è una navigazione vera) ma
 *                               esiste un endpoint equivalente che lo è. Stessi
 *                               selettori, numerazione propria a partire da 1.
 *                     countMaxPages tetto di pagine scaricate per il conteggio esatto
 *                               (default 5; da alzare se le pagine sono piccole)
 *
 *   -- solo per il tracciamento interessi (pagine articolo) --
 *   categorySelector (opzionale) selettore CSS il cui testo è la categoria dell'articolo.
 *   catPathIndex     (opzionale) indice del segmento dell'URL da usare come categoria
 *                    quando mancano i meta tag (es. hdblog "/green/..." -> 0,
 *                    hwupgrade "/news/portatili/..." -> 1).
 *   keywordsSelector (opzionale) selettore CSS di eventuali tag/parole chiave nel DOM.
 */

const NEWS_SITES = [
  {
    id: "hdblog",
    name: "HDblog",
    color: "#df151c",
    hosts: ["www.hdblog.it", "hdblog.it"],
    homePaths: ["/", ""],
    articleSelector: "article.newlist_normal",
    linkSelector: "a.title_new[href], a.thumb_new_image[href], a[href]",
    idRegex: "/n(\\d+)/",
    idPrefix: "n",
    newestLast: false,
    catPathIndex: 0,
    // La home si RICARICA DA SOLA: <meta http-equiv="refresh" content='777;url=
    // https://www.hdblog.it/?refresh_ce'> — ogni ~13 minuti, e la pagina di arrivo
    // ripete lo stesso tag, quindi il ciclo continua finché la scheda resta aperta.
    // Senza questo campo ogni ricaricamento contava come una visita nuova e faceva
    // avanzare il segnalibro su notizie mai lette (segnalato dall'utente).
    // Il parametro viene poi TOLTO dall'URL con history.replaceState (v0.3.6):
    // altrimenti la scheda resta incollata su /?refresh_ce e ogni caricamento
    // successivo — anche l'F5 dell'utente — sembra automatico, bloccando per
    // sempre l'avanzamento del segnalibro.
    autoRefreshParam: "refresh_ce",
    // Il feed della home è LAZY: scrollando si caricano altre notizie via
    // /new_files/ajax/pages.php?page=N (~9-10 notizie a pagina; la home
    // server-rendered corrisponde alle pagine 1-2, il bottone "Altre Notizie"
    // parte da page=3). La sequenza ajax ricalca esattamente la home
    // (verificato: home = prefisso di p1+p2+p3), quindi serve per il CONTEGGIO
    // ESATTO delle non lette (countTemplate qui sotto).
    // Il feed della home ha però un MURO: il lazy-load si ferma a page=10 (da
    // page=11 il server risponde con un blocco vuoto), cioè ~99 notizie in
    // tutto (home ~19 + pagine 3..10). Più indietro di così le notizie stanno
    // nelle pagine della paginazione — quelle del bottone "Clicca qui per Altre
    // Notizie" — che si raggiungono solo NAVIGANDO: è l'archivio del sito, e la
    // ricerca dell'ultima letta prosegue lì pagina per pagina, come su
    // hwupgrade. (Scaricarle con fetch non funziona: rispondono 429 a chi non è
    // una navigazione vera del browser. Vedi BUG #14.)
    archive: {
      urlTemplate: "https://www.hdblog.it/page/{n}/",
      pathRegex: "^/page/(\\d+)/?$",
      // Pagina 1 ripete le notizie che stanno già nella home: la ricerca parte
      // dalla 2 (il bottone della home porta lì).
      firstPage: 2,
      maxPages: 40,
      // Per CONTARE si usa invece l'endpoint ajax del lazy-load: stesso markup,
      // frammenti leggeri, e soprattutto scaricabile (le pagine navigabili no).
      // Il parametro `b` è quello che il sito stesso usa quando ricarica una
      // home già scorsa (hash #?t=…&b=N -> pages.php?page=3&b=N): con b=10 il
      // server risponde con TUTTI i blocchi in una volta sola, cioè le ~100
      // notizie raggiungibili scrollando la home, in UNA richiesta e in
      // un'unica istantanea coerente. Meglio delle 10 richieste separate di
      // prima: quelle sono paginate a offset sulla lista VIVA, quindi se il
      // sito pubblica mentre si conta la sequenza scivola e le ultime notizie
      // si perdono per strada (è lo stesso difetto che genera i doppioni, vedi
      // v0.3.7). Una pagina sola basta e avanza: countMaxPages: 1.
      // Se il segnalibro non è in quelle ~100 è oltre il muro del lazy-load
      // (exact=false, badge "100+") e la ricerca sa già che deve andare
      // nell'archivio invece di scrollare a vuoto.
      countTemplate: "https://www.hdblog.it/new_files/ajax/pages.php?page={n}&b=10",
      countMaxPages: 1,
    },
  },

  {
    id: "hwupgrade",
    name: "Hardware Upgrade",
    color: "#e8730c",
    hosts: ["www.hwupgrade.it", "hwupgrade.it"],
    homePaths: ["/", ""],
    articleSelector: "#news-container li.news-item",
    linkSelector: "h3 a[href], a.img-wrapper[href], a[href]",
    idRegex: "_(\\d+)\\.html$",
    idPrefix: "",
    newestLast: false,
    catPathIndex: 1,
    // La home è un feed FISSO (~40 notizie, niente lazy-load): se il segnalibro
    // non è lì, sta nell'archivio "Tutte le notizie", paginato:
    // /news/index.html (pag. 1), /news/index2.html, ... (~30 notizie a pagina,
    // stesso markup della home).
    feedStatic: true,
    archive: {
      urlBase: "https://www.hwupgrade.it/news/index",
      pathRegex: "^/news/index(\\d*)\\.html$",
      maxPages: 40,
    },
  },

  {
    // Sito SOLO per il tracciamento: gli articoli hdmotori aperti dai link di hdblog
    // vengono registrati. Niente segnalibro sulla home (trackingOnly).
    // Gli articoli si rilevano via og:type=article (gli URL non hanno ID numerico).
    id: "hdmotori",
    name: "HDmotori",
    color: "#e2001a",
    hosts: ["www.hdmotori.it", "hdmotori.it"],
    homePaths: ["/", ""],
    trackingOnly: true,
  },

  /* ------------------------------------------------------------------
   * TEMPLATE per un nuovo sito — copia il blocco, togli i commenti e
   * compila i campi. Ricorda anche il passo (2): host in manifest.json.
   * ------------------------------------------------------------------
  {
    id: "esempio",
    name: "Esempio News",
    color: "#0066cc",
    hosts: ["www.esempio.it"],
    homePaths: ["/", ""],
    articleSelector: "article.post",     // selettore delle notizie del feed
    linkSelector: "a[href]",             // link con URL+titolo dentro la notizia
    idRegex: "",                         // opzionale, es "/(\\d+)/"
    idPrefix: "",
    newestLast: false,
  },
  */
];

/* Ritorna la config del sito corrispondente all'URL, oppure null. */
function findSiteForUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return null;
  }
  return NEWS_SITES.find((s) => s.hosts.indexOf(u.hostname) !== -1) || null;
}

/* True se l'URL è la home del sito indicato. */
function isSiteHome(site, urlStr) {
  if (!site) return false;
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return false;
  }
  const paths = site.homePaths || ["/", ""];
  return paths.indexOf(u.pathname) !== -1;
}

/* URL della home (per i link nel popup). */
function siteHomeUrl(site) {
  return "https://" + site.hosts[0] + "/";
}

/* Numero non lette per badge/toast/popup. Esatto: "57" (oltre 99: "99+").
   approx = il numero è solo un LIMITE INFERIORE (segnalibro oltre il feed
   caricato / oltre il tetto di pagine archivio): arrotondato alla decina in
   giù con "+", es. 42 -> "40+" (sotto 10 resta com'è: 7 -> "7+"). */
function formatUnread(count, approx) {
  const n = count | 0;
  if (n <= 0) return "0";
  if (approx) {
    const base = Math.floor(n / 10) * 10;
    if (base < 10) return n + "+";
    return Math.min(990, base) + "+";
  }
  return n > 99 ? "99+" : String(n);
}

/* Esporta anche su globale per sicurezza (condiviso tra content scripts e popup). */
if (typeof self !== "undefined") {
  self.NEWS_SITES = NEWS_SITES;
  self.findSiteForUrl = findSiteForUrl;
  self.isSiteHome = isSiteHome;
  self.siteHomeUrl = siteHomeUrl;
  self.formatUnread = formatUnread;
}

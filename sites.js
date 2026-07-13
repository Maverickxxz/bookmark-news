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

/* Esporta anche su globale per sicurezza (condiviso tra content scripts e popup). */
if (typeof self !== "undefined") {
  self.NEWS_SITES = NEWS_SITES;
  self.findSiteForUrl = findSiteForUrl;
  self.isSiteHome = isSiteHome;
  self.siteHomeUrl = siteHomeUrl;
}

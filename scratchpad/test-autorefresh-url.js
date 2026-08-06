/*
 * v0.3.6 — segnalato dall'utente: dopo l'auto-refresh di hdblog la scheda resta
 * "incollata" su https://www.hdblog.it/?refresh_ce. Siccome quel parametro è
 * proprio il segnale con cui riconosciamo il refresh automatico (v0.3.5), da quel
 * momento OGNI caricamento — anche l'F5 fatto a mano — veniva letto come
 * automatico: il segnalibro non avanzava più, "neanche refreshando 100 volte".
 *
 * Correzione: appena rilevato il parametro lo si TOGLIE dall'URL con
 * history.replaceState (niente ricaricamento, la scheda resta dov'è ma l'URL
 * torna a essere la home pulita). Il caricamento in corso resta "automatico"
 * (il flag è letto prima), quelli dopo tornano visite vere. Il meta refresh del
 * sito punta all'URL assoluto col parametro, quindi il prossimo auto-refresh è
 * comunque riconosciuto.
 *
 * Esegui con: node scratchpad/test-autorefresh-url.js
 */

"use strict";

let failures = 0;
function check(desc, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    (ok ? "  ok  " : "  FAIL") + "  " + desc,
    ok
      ? ""
      : "\n         atteso: " +
          JSON.stringify(want) +
          "\n         ottenuto: " +
          JSON.stringify(got)
  );
}

// ---------------------------------------------------------------- repliche

// replica di content.js/sameVisitParams + detectSameVisitLoad. Dalla v0.3.7 i
// marcatori "stessa visita" sono due: quello del sito (autoRefreshParam) e il
// nostro (KEEP_PARAM, usato da "Ricarica pulita"). Qui interessa il primo.
const KEEP_PARAM = "hdbkeep";

function sameVisitParams(site) {
  const out = [KEEP_PARAM];
  if (site && site.autoRefreshParam) out.push(site.autoRefreshParam);
  return out;
}

function detectAutoRefreshLoad(site, url) {
  if (!site) return false;
  try {
    const q = new URLSearchParams(new URL(url).search);
    return sameVisitParams(site).some((p) => q.has(p));
  } catch (e) {
    return false;
  }
}

// replica di content.js/stripVisitParams (restituisce il nuovo URL invece
// di chiamare history.replaceState).
function stripAutoRefreshParam(site, url) {
  try {
    const u = new URL(url);
    sameVisitParams(site).forEach((p) => u.searchParams.delete(p));
    const qs = u.searchParams.toString();
    return u.origin + u.pathname + (qs ? "?" + qs : "") + u.hash;
  } catch (e) {
    return url;
  }
}

// replica di content.js/init(): un caricamento della home.
function initHome(store, autoRefresh, currentNewest) {
  const auto = !!store.init && autoRefresh;
  let marker, pending;
  if (!store.init) {
    marker = currentNewest;
    pending = currentNewest;
  } else if (auto) {
    marker = store.marker || store.pending || currentNewest;
    pending = store.pending || currentNewest;
  } else if (store.reached) {
    marker = store.pending || currentNewest;
    pending = currentNewest;
  } else {
    marker = store.marker || store.pending || currentNewest;
    pending = currentNewest;
  }
  return {
    marker: marker,
    pending: pending,
    init: true,
    reached: auto ? !!store.reached : false,
  };
}

/* Scheda del browser: tiene l'URL mostrato nella barra degli indirizzi, che il
   content script può riscrivere con replaceState. */
function makeTab(site, url) {
  return {
    site: site,
    url: url,
    store: {},
    // un caricamento vero (navigazione, F5, meta refresh)
    load: function (toUrl, currentNewest) {
      this.url = toUrl;
      const auto = detectAutoRefreshLoad(this.site, this.url); // PRIMA di ripulire
      if (auto) this.url = stripAutoRefreshParam(this.site, this.url);
      this.store = initHome(this.store, auto, currentNewest);
      return { auto: auto, marker: this.store.marker };
    },
    // F5 dell'utente: ricarica l'URL attuale della barra
    reload: function (currentNewest) {
      return this.load(this.url, currentNewest);
    },
    // il <meta http-equiv="refresh"> del sito: URL assoluto col parametro
    metaRefresh: function (currentNewest) {
      return this.load("https://www.hdblog.it/?refresh_ce", currentNewest);
    },
  };
}

const HDBLOG = { autoRefreshParam: "refresh_ce" };
const HWU = {}; // nessun auto-refresh
const HOME = "https://www.hdblog.it/";

// ------------------------------------------------------------ (1) URL pulito

console.log("\n(1) l'URL torna alla home pulita\n");

check(
  "il parametro viene rimosso",
  stripAutoRefreshParam(HDBLOG, "https://www.hdblog.it/?refresh_ce"),
  HOME
);
check(
  "altri parametri restano",
  stripAutoRefreshParam(HDBLOG, "https://www.hdblog.it/?a=1&refresh_ce&b=2"),
  "https://www.hdblog.it/?a=1&b=2"
);
check(
  "l'ancora resta",
  stripAutoRefreshParam(HDBLOG, "https://www.hdblog.it/?refresh_ce#top"),
  "https://www.hdblog.it/#top"
);
check(
  "URL già pulito: invariato",
  stripAutoRefreshParam(HDBLOG, HOME),
  HOME
);

// ------------------------------------------- (2) lo scenario segnalato dall'utente

console.log("\n(2) scenario segnalato: auto-refresh e poi F5 a mano\n");

{
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10"); // prima visita: marker = pending = n10
  check("prima visita: marker sulla più recente", tab.store.marker, "n10");

  tab.store.reached = true; // l'utente legge e raggiunge il segnalibro
  const r = tab.metaRefresh("n15"); // il sito si ricarica da solo
  check("il caricamento è riconosciuto come automatico", r.auto, true);
  check("auto-refresh: il marker NON avanza", tab.store.marker, "n10");
  check("auto-refresh: pending resta fermo", tab.store.pending, "n10");
  check("auto-refresh: 'reached' conservato", tab.store.reached, true);
  check("la barra degli indirizzi torna alla home pulita", tab.url, HOME);

  // Qui stava il bug: con l'URL incollato su ?refresh_ce l'F5 sembrava un
  // refresh automatico e il segnalibro restava fermo per sempre.
  const r2 = tab.reload("n15");
  check("F5 dopo l'auto-refresh: NON è un auto-refresh", r2.auto, false);
  check("F5 dopo l'auto-refresh: il marker avanza", tab.store.marker, "n10");
  check("F5: pending si aggiorna alla più recente", tab.store.pending, "n15");
  check("F5: 'reached' azzerato (va ri-raggiunto)", tab.store.reached, false);

  // ...e la visita dopo avanza davvero (registro a scorrimento normale).
  tab.store.reached = true;
  tab.reload("n18");
  check("visita successiva: avanzamento normale", tab.store.marker, "n15");
}

{
  // Controprova del bug: senza la pulizia dell'URL l'F5 restava "automatico".
  const url = "https://www.hdblog.it/?refresh_ce";
  check(
    "BUG storico: senza pulizia ogni F5 sembra automatico",
    detectAutoRefreshLoad(HDBLOG, url),
    true
  );
}

// ------------------------------------------------- (3) catena di auto-refresh

console.log("\n(3) auto-refresh a catena (scheda lasciata aperta)\n");

{
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10");
  tab.store.reached = true;

  for (let i = 0; i < 5; i++) {
    const r = tab.metaRefresh("n" + (20 + i));
    check(
      "auto-refresh #" + (i + 1) + ": riconosciuto anche dopo la pulizia",
      r.auto,
      true
    );
    check("auto-refresh #" + (i + 1) + ": URL pulito", tab.url, HOME);
    check("auto-refresh #" + (i + 1) + ": marker fermo", tab.store.marker, "n10");
  }
  check("dopo 5 auto-refresh 'reached' è ancora conservato", tab.store.reached, true);

  // Visita vera: riparte dal pending congelato all'inizio della visita.
  const r = tab.load(HOME, "n30");
  check("visita vera dopo la catena: non è automatica", r.auto, false);
  check("visita vera: il marker avanza a pending", tab.store.marker, "n10");
}

// --------------------------------------------- (4) siti senza auto-refresh

console.log("\n(4) siti senza autoRefreshParam\n");

{
  const tab = makeTab(HWU, "https://www.hwupgrade.it/");
  const r = tab.load("https://www.hwupgrade.it/?refresh_ce", "a1");
  check("hwupgrade: mai auto-refresh", r.auto, false);
  check("hwupgrade: URL non toccato", tab.url, "https://www.hwupgrade.it/?refresh_ce");
  tab.store.reached = true;
  tab.load("https://www.hwupgrade.it/", "a5");
  check("hwupgrade: avanzamento normale invariato", tab.store.marker, "a1");
}

console.log(
  "\n" + (failures ? failures + " CONTROLLI FALLITI" : "tutti i controlli ok") + "\n"
);
process.exit(failures ? 1 : 0);

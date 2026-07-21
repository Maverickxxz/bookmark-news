/*
 * v0.3.5 — due correzioni segnalate dall'utente:
 *
 *  (1) hdblog ricarica la home DA SOLA ogni 777s (<meta http-equiv="refresh"
 *      content='777;url=https://www.hdblog.it/?refresh_ce'>, a catena). Quel
 *      caricamento veniva contato come una visita nuova e faceva avanzare il
 *      segnalibro su notizie mai lette. Ora l'URL col parametro "refresh_ce"
 *      identifica il refresh automatico: stessa visita, niente avanzamento,
 *      "reached" conservato.
 *
 *  (2) hwupgrade: sulle pagine dell'archivio (/news/index[Z].html) il popup
 *      mostrava "apri la home" senza i pulsanti. Ora i comandi ci sono, con la
 *      cautela che "Segna tutte come lette" NON deve usare feed[0] della pagina
 *      archivio (è una notizia vecchia: sposterebbe il segnalibro all'indietro).
 *
 * Esegui con: node scratchpad/test-autorefresh-archive.js
 */

"use strict";

let failures = 0;
function check(desc, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    (ok ? "  ok  " : "  FAIL") + "  " + desc,
    ok ? "" : "\n         atteso: " + JSON.stringify(want) + "\n         ottenuto: " + JSON.stringify(got)
  );
}

// ---------------------------------------------------------------- (1) refresh

// replica di content.js/isAutoRefreshLoad
function isAutoRefreshLoad(site, url) {
  if (!site.autoRefreshParam) return false;
  try {
    return new URLSearchParams(new URL(url).search).has(site.autoRefreshParam);
  } catch (e) {
    return false;
  }
}

// replica di content.js/init(): un caricamento della home.
function loadHome(state, site, url, currentNewest) {
  const store = state.store;
  const autoRefresh = !!store.init && isAutoRefreshLoad(site, url);

  let marker, pending;
  if (!store.init) {
    marker = currentNewest;
    pending = currentNewest;
  } else if (autoRefresh) {
    marker = store.marker || store.pending || currentNewest;
    pending = store.pending || currentNewest;
  } else if (store.reached) {
    marker = store.pending || currentNewest;
    pending = currentNewest;
  } else {
    marker = store.marker || store.pending || currentNewest;
    pending = currentNewest;
  }

  state.store = {
    marker: marker,
    pending: pending,
    init: true,
    reached: autoRefresh ? !!store.reached : false,
  };
  return marker;
}

const HDBLOG = { autoRefreshParam: "refresh_ce" };
const HWU = {}; // nessun auto-refresh
const HOME = "https://www.hdblog.it/";
const AUTO = "https://www.hdblog.it/?refresh_ce";

console.log("\n(1) hdblog — refresh automatico del sito\n");

check("riconosce l'URL del refresh automatico", isAutoRefreshLoad(HDBLOG, AUTO), true);
check("home pulita NON è un refresh automatico", isAutoRefreshLoad(HDBLOG, HOME), false);
check(
  "parametro senza valore (?refresh_ce) rilevato",
  new URLSearchParams(new URL(AUTO).search).has("refresh_ce"),
  true
);
check(
  "sito senza autoRefreshParam: mai auto-refresh",
  isAutoRefreshLoad(HWU, "https://www.hwupgrade.it/?refresh_ce"),
  false
);

// Scenario del bug: apri la home, leggi (raggiungi il segnalibro), il sito si
// ricarica da solo mentre sono uscite notizie nuove.
{
  const st = { store: {} };
  loadHome(st, HDBLOG, HOME, "n10"); // prima volta: marker = pending = n10
  check("prima visita: marker sulla più recente", st.store.marker, "n10");

  loadHome(st, HDBLOG, HOME, "n12"); // visita successiva, marker non raggiunto
  check("2ª visita senza aver raggiunto: marker fermo", st.store.marker, "n10");

  st.store.reached = true; // l'utente scorre e VEDE il segnalibro
  const m = loadHome(st, HDBLOG, AUTO, "n15"); // il sito si ricarica da solo
  check("refresh automatico: il marker NON avanza", m, "n10");
  check("refresh automatico: pending resta fermo", st.store.pending, "n12");
  check("refresh automatico: 'reached' conservato", st.store.reached, true);

  // Altro refresh automatico a catena: sempre fermo.
  loadHome(st, HDBLOG, AUTO, "n18");
  check("refresh automatico a catena: ancora fermo", st.store.marker, "n10");
  check("refresh a catena: 'reached' ancora conservato", st.store.reached, true);

  // Visita VERA successiva (URL pulito): l'avanzamento riparte normalmente,
  // usando il pending congelato all'inizio della visita.
  const m2 = loadHome(st, HDBLOG, HOME, "n20");
  check("visita vera dopo i refresh: il marker avanza a pending", m2, "n12");
  check("visita vera: reached azzerato (va ri-raggiunto)", st.store.reached, false);
}

// Controprova: senza la correzione il marker sarebbe avanzato. Simuliamo il
// vecchio comportamento (auto-refresh trattato come visita normale).
{
  const st = { store: { marker: "n10", pending: "n12", init: true, reached: true } };
  // vecchia logica = ramo "reached" anche sul refresh automatico
  const vecchio = st.store.pending;
  check("BUG storico: il refresh avanzava il marker a n12", vecchio, "n12");
  const nuovo = loadHome(st, HDBLOG, AUTO, "n15");
  check("corretto: ora resta n10", nuovo, "n10");
}

// Il flusso normale non deve cambiare per i siti senza auto-refresh.
{
  const st = { store: {} };
  loadHome(st, HWU, "https://www.hwupgrade.it/", "a1");
  st.store.reached = true;
  const m = loadHome(st, HWU, "https://www.hwupgrade.it/", "a5");
  check("hwupgrade: avanzamento normale invariato", m, "a1");
}

// ---------------------------------------------------------------- (2) archivio

console.log("\n(2) hwupgrade — pulsanti sulle pagine archivio\n");

// replica di content.js/markAllRead
async function markAllRead(state, opts) {
  const onArchive = !!opts.archive;
  let newest = null;
  if (onArchive) {
    newest = state.store.pending || state.store.marker || null;
  } else {
    newest = opts.feed.length ? opts.feed[0] : null;
  }
  if (!newest) return { changed: false, marker: state.store.marker };
  state.store = { marker: newest, pending: newest, init: true, reached: true };
  return { changed: true, marker: newest };
}

// La home aveva n100 in cima; il segnalibro è vecchio (n40) e l'utente lo cerca
// nell'archivio, arrivando a /news/index5.html dove la prima notizia è n60.
{
  const st = { store: { marker: "n40", pending: "n100", init: true, reached: false } };
  markAllRead(st, { archive: true, feed: ["n60", "n59", "n58"] }).then((r) => {
    check("archivio: usa pending (più recente della home), non feed[0]", r.marker, "n100");
    check("archivio: NON usa la notizia vecchia della pagina", r.marker === "n60", false);
  });
}

// Sulla home invece si continua a usare feed[0].
{
  const st = { store: { marker: "n40", pending: "n90", init: true, reached: false } };
  markAllRead(st, { archive: false, feed: ["n100", "n99"] }).then((r) => {
    check("home: usa feed[0] come prima", r.marker, "n100");
  });
}

// Nessun pending noto (segnalibro mai inizializzato dalla home): niente da fare.
{
  const st = { store: {} };
  markAllRead(st, { archive: true, feed: ["n60"] }).then((r) => {
    check("archivio senza pending: non tocca il segnalibro", r.changed, false);
  });
}

// --- gating del popup (replica di popup.js/boot) ---
function popupPanel(site, status, tabUrl, isHomeUrl) {
  const onHome = !!(status && status.onHome) && isHomeUrl;
  const onArchive = !!(status && status.archive);
  if (!status || status.trackingOnly || site.trackingOnly || (!onHome && !onArchive))
    return "offhome";
  return "onhome";
}

const SITE = { trackingOnly: false };
check(
  "popup sulla home: pannello coi pulsanti",
  popupPanel(SITE, { onHome: true }, "https://www.hwupgrade.it/", true),
  "onhome"
);
check(
  "popup su /news/index.html: ORA coi pulsanti",
  popupPanel(SITE, { onHome: false, archive: true, archivePage: 1 }, "https://www.hwupgrade.it/news/index.html", false),
  "onhome"
);
check(
  "popup su /news/index7.html: coi pulsanti",
  popupPanel(SITE, { onHome: false, archive: true, archivePage: 7 }, "https://www.hwupgrade.it/news/index7.html", false),
  "onhome"
);
check(
  "popup su pagina articolo: resta senza pulsanti",
  popupPanel(SITE, { onHome: false }, "https://www.hwupgrade.it/news/cpu/x_1.html", false),
  "offhome"
);
check(
  "popup senza risposta dal content script: senza pulsanti",
  popupPanel(SITE, null, "https://www.hwupgrade.it/", true),
  "offhome"
);
check(
  "popup su sito solo-tracciamento: senza pulsanti",
  popupPanel({ trackingOnly: true }, { onHome: true, trackingOnly: true }, "https://www.hdmotori.it/", true),
  "offhome"
);

// --- prosecuzione della ricerca nell'archivio (replica di scrollToMarker) ---
function nextSeekPage(archivePageNum, maxPages) {
  const p = archivePageNum === null ? 1 : archivePageNum + 1;
  return p > maxPages ? null : p; // null = ricerca non avviabile
}
check("dalla home la ricerca parte da pagina 1", nextSeekPage(null, 40), 1);
check("da /news/index.html prosegue da pagina 2", nextSeekPage(1, 40), 2);
check("da /news/index7.html prosegue da pagina 8", nextSeekPage(7, 40), 8);
check("all'ultima pagina non riparte da capo", nextSeekPage(40, 40), null);

// ----------------------------------------------------------------- esito
setTimeout(() => {
  console.log(
    "\n" + (failures === 0 ? "TUTTI I CONTROLLI OK" : failures + " CONTROLLI FALLITI") + "\n"
  );
  process.exit(failures === 0 ? 0 : 1);
}, 50);

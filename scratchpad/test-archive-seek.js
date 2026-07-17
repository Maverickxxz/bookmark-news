/*
 * Verifica della ricerca del segnalibro nell'archivio paginato (hwupgrade),
 * aggiunta in content.js (startArchiveSeek / initArchive / archivePageNum).
 * Replica fedele della logica, con Date.now / location / storage / DOM finti.
 * Obiettivi:
 *   1) riconoscimento URL archivio e costruzione URL pagina N;
 *   2) "Vai all'ultima letta" con marker fuori dal feed -> flag seek + navigazione;
 *   3) su ogni pagina: marker assente -> pagina successiva; presente -> evidenzia,
 *      centra e rimuove il flag; il ts ORIGINALE si conserva (TTL sulla ricerca totale);
 *   4) sicurezze: TTL scaduto, pagina diversa dal flag (visita manuale), tetto
 *      maxPages, feed vuoto, marker non salvato -> MAI navigazioni indesiderate.
 */

// --- config come sites.js (hwupgrade) ---
const site = {
  feedStatic: true,
  archive: {
    urlBase: "https://www.hwupgrade.it/news/index",
    pathRegex: "^/news/index(\\d*)\\.html$",
    maxPages: 40,
  },
};

// --- fakes ---
let storage = {}; // chrome.storage.local
let navigatedTo = null; // location.assign
let highlighted = null; // markElement
let centered = null; // flashAndCenter (solo durante la ricerca)
let FEED = []; // chiavi delle notizie nel DOM della pagina corrente
let NOW = 1000000; // Date.now finto
let PATH = "/"; // location.pathname

const K = { marker: "marker_hwupgrade", seek: "seek_hwupgrade" };
async function getStore(keys) {
  const o = {};
  (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
    if (k in storage) o[k] = storage[k];
  });
  return o;
}
async function setStore(obj) {
  Object.assign(storage, obj);
}
async function removeStore(k) {
  delete storage[k];
}

// --- copia fedele da content.js (Date.now/location/DOM parametrizzati) ---
const SEEK_TTL_MS = 5 * 60 * 1000;

function archiveMaxPages() {
  return (site.archive && site.archive.maxPages) || 40;
}

function archiveUrlFor(page) {
  return site.archive.urlBase + (page > 1 ? String(page) : "") + ".html";
}

function archivePageNum() {
  if (!site.archive || !site.archive.pathRegex) return null;
  let m = null;
  try {
    m = PATH.match(new RegExp(site.archive.pathRegex));
  } catch (e) {
    return null;
  }
  if (!m) return null;
  return m[1] ? parseInt(m[1], 10) : 1;
}

async function startArchiveSeek() {
  await setStore({ [K.seek]: { page: 1, ts: NOW } });
  navigatedTo = archiveUrlFor(1);
}

const state = { markerKey: null };
let lastStatus = {};

async function initArchive(page) {
  lastStatus = { onHome: false, archive: true };

  const store = await getStore([K.marker, K.seek]);
  const marker = store[K.marker];
  const seek = store[K.seek];
  const seeking = !!(
    marker &&
    seek &&
    seek.page === page &&
    typeof seek.ts === "number" &&
    NOW - seek.ts < SEEK_TTL_MS
  );

  if (!marker) {
    if (seek) await removeStore(K.seek);
    return;
  }
  state.markerKey = marker;

  const feed = FEED.map((k) => ({ key: k }));
  const idx = feed.findIndex((a) => a.key === marker);

  if (idx >= 0) {
    if (seek) await removeStore(K.seek);
    highlighted = feed[idx].key;
    lastStatus.found = true;
    if (seeking) centered = feed[idx].key;
    return;
  }

  if (!seeking) return;

  if (!feed.length || page >= archiveMaxPages()) {
    await removeStore(K.seek);
    return;
  }
  await setStore({ [K.seek]: { page: page + 1, ts: seek.ts } });
  navigatedTo = archiveUrlFor(page + 1);
}

// --- helpers di test ---
let pass = 0,
  fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log("  ok  -", msg);
  } else {
    fail++;
    console.log("  FAIL-", msg);
  }
}
function reset() {
  storage = {};
  navigatedTo = null;
  highlighted = null;
  centered = null;
  FEED = [];
  NOW = 1000000;
  PATH = "/";
  state.markerKey = null;
}

(async () => {
  // =======================================================================
  console.log("Scenario: riconoscimento URL archivio\n");

  PATH = "/news/index.html";
  assert(archivePageNum() === 1, "/news/index.html = pagina 1");
  PATH = "/news/index2.html";
  assert(archivePageNum() === 2, "/news/index2.html = pagina 2");
  PATH = "/news/index5158.html";
  assert(archivePageNum() === 5158, "/news/index5158.html = pagina 5158");
  PATH = "/";
  assert(archivePageNum() === null, "la home NON è una pagina archivio");
  PATH = "/news/web/qualcosa_156332.html";
  assert(archivePageNum() === null, "una pagina articolo NON è archivio");
  assert(
    archiveUrlFor(1) === "https://www.hwupgrade.it/news/index.html",
    "URL pagina 1 senza numero"
  );
  assert(
    archiveUrlFor(3) === "https://www.hwupgrade.it/news/index3.html",
    "URL pagina 3 con numero"
  );

  // =======================================================================
  console.log("\nScenario: ricerca completa (marker a pagina 2)\n");

  reset();
  storage[K.marker] = "150000"; // ultima letta, non presente nel feed della home
  await startArchiveSeek();
  assert(
    navigatedTo === archiveUrlFor(1),
    "dalla home si naviga alla pagina 1 dell'archivio"
  );
  assert(
    storage[K.seek] && storage[K.seek].page === 1,
    "flag seek impostato a pagina 1"
  );

  // pagina 1: 30 notizie, il marker non c'è
  PATH = "/news/index.html";
  navigatedTo = null;
  FEED = Array.from({ length: 30 }, (_, i) => String(156400 - i));
  NOW += 2000; // il caricamento pagina richiede tempo
  await initArchive(archivePageNum());
  assert(navigatedTo === archiveUrlFor(2), "marker assente -> si naviga alla pagina 2");
  assert(storage[K.seek].page === 2, "flag aggiornato a pagina 2");
  assert(
    storage[K.seek].ts === 1000000,
    "ts ORIGINALE conservato (TTL sulla ricerca totale)"
  );
  assert(highlighted === null, "niente evidenziazione su pagina senza marker");

  // pagina 2: il marker c'è
  PATH = "/news/index2.html";
  navigatedTo = null;
  FEED = Array.from({ length: 30 }, (_, i) => String(156370 - i));
  FEED[12] = "150000"; // il marker sta qui
  NOW += 2000;
  await initArchive(archivePageNum());
  assert(highlighted === "150000", "marker trovato ed evidenziato");
  assert(centered === "150000", "marker centrato nello schermo (flash)");
  assert(navigatedTo === null, "nessuna ulteriore navigazione");
  assert(!(K.seek in storage), "flag seek rimosso a ricerca conclusa");

  // =======================================================================
  console.log("\nScenario: visita normale dell'archivio (nessun flag)\n");

  reset();
  storage[K.marker] = "150000";
  PATH = "/news/index.html";
  FEED = ["156400", "150000", "149999"];
  await initArchive(archivePageNum());
  assert(highlighted === "150000", "evidenziazione passiva se il marker è in pagina");
  assert(centered === null, "ma NESSUNO scroll automatico (visita normale)");
  assert(navigatedTo === null, "e nessuna navigazione");

  reset();
  storage[K.marker] = "150000";
  PATH = "/news/index.html";
  FEED = ["156400", "156399"];
  await initArchive(archivePageNum());
  assert(
    navigatedTo === null,
    "marker assente SENZA flag -> nessuna navigazione (no dirottamenti)"
  );

  // =======================================================================
  console.log("\nScenario: sicurezze (TTL, pagina diversa, tetto, feed vuoto)\n");

  // TTL scaduto
  reset();
  storage[K.marker] = "150000";
  storage[K.seek] = { page: 1, ts: 1000000 };
  NOW = 1000000 + SEEK_TTL_MS + 1;
  PATH = "/news/index.html";
  FEED = ["156400", "156399"];
  await initArchive(archivePageNum());
  assert(navigatedTo === null, "flag SCADUTO (TTL) -> nessuna navigazione");

  // pagina diversa da quella del flag (es. l'utente apre index5 a mano)
  reset();
  storage[K.marker] = "150000";
  storage[K.seek] = { page: 2, ts: 1000000 };
  PATH = "/news/index5.html";
  FEED = ["156000", "155999"];
  await initArchive(archivePageNum());
  assert(navigatedTo === null, "pagina diversa dal flag -> nessun dirottamento");
  assert(
    storage[K.seek] && storage[K.seek].page === 2,
    "il flag resta per la SUA pagina"
  );

  // tetto maxPages
  reset();
  storage[K.marker] = "150000";
  storage[K.seek] = { page: 40, ts: 1000000 };
  PATH = "/news/index40.html";
  FEED = ["155000", "154999"];
  await initArchive(archivePageNum());
  assert(navigatedTo === null, "tetto maxPages raggiunto -> stop");
  assert(!(K.seek in storage), "flag rimosso al tetto");

  // feed vuoto (selettori rotti / pagina anomala)
  reset();
  storage[K.marker] = "150000";
  storage[K.seek] = { page: 1, ts: 1000000 };
  PATH = "/news/index.html";
  FEED = [];
  await initArchive(archivePageNum());
  assert(navigatedTo === null, "feed vuoto -> stop (niente loop di navigazioni)");
  assert(!(K.seek in storage), "flag rimosso su feed vuoto");

  // marker non salvato (prima visita in assoluto)
  reset();
  storage[K.seek] = { page: 1, ts: 1000000 };
  PATH = "/news/index.html";
  FEED = ["156400"];
  await initArchive(archivePageNum());
  assert(navigatedTo === null, "senza marker salvato -> nessuna navigazione");
  assert(!(K.seek in storage), "flag orfano ripulito");

  // =======================================================================
  console.log(`\nRisultato: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

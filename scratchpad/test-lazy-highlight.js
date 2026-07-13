/*
 * Verifica della logica dell'osservatore del feed (lazy-load) aggiunta in content.js.
 * Simula il DOM con oggetti finti e replica le funzioni chiave:
 *   getFeedArticles, applyHighlight (versione ridotta), currentSig, reapplyIfChanged.
 * Obiettivi:
 *   1) il marker che compare in ritardo (sotto la piega) viene evidenziato e il conteggio corretto;
 *   2) niente loop: la firma converge e reapplyIfChanged smette di lavorare;
 *   3) l'ad-churn (nodi non-articolo) non ri-applica nulla.
 */

// --- DOM finto minimale (classList via mappa esterna) ---
const classMap = new Map(); // el -> Set
function elc(el) {
  if (!classMap.has(el)) classMap.set(el, new Set());
  return classMap.get(el);
}
function mkEl(key) {
  const el = { key };
  el.classList = {
    add: (c) => elc(el).add(c),
    remove: (c) => elc(el).delete(c),
    contains: (c) => elc(el).has(c),
  };
  el._labels = 0;
  return el;
}

// stato del "feed" nel DOM (array di el, dal più recente)
let DOM_FEED = [];

function getFeedArticles() {
  return DOM_FEED.map((el) => ({ el, key: el.key }));
}

let markerKey = null;
let badge = null;
let statusFound = null;
let statusUnread = null;
let applyCount = 0;

function applyHighlight() {
  applyCount++;
  const feed = getFeedArticles();
  // clearHighlight
  feed.forEach((a) => a.el.classList.remove("hdb-marker"));
  const idx = feed.findIndex((a) => a.key === markerKey);
  let unread, found;
  if (idx >= 0) {
    found = true;
    unread = idx;
    feed[idx].el.classList.add("hdb-marker");
  } else {
    found = false;
    unread = feed.length;
  }
  badge = unread;
  statusFound = found;
  statusUnread = unread;
}

// --- copia fedele delle funzioni nuove di content.js ---
let lastSig = "";
function currentSig() {
  const feed = getFeedArticles();
  if (!feed.length) return null;
  const idx = markerKey ? feed.findIndex((a) => a.key === markerKey) : -1;
  const el = idx >= 0 ? feed[idx].el : null;
  const has = !!(el && el.classList.contains("hdb-marker"));
  return feed.length + "|" + idx + "|" + (has ? 1 : 0);
}
function reapplyIfChanged() {
  if (!markerKey) return false;
  const sig = currentSig();
  if (sig === null || sig === lastSig) return false;
  applyHighlight();
  lastSig = currentSig();
  return true; // ha lavorato
}

// --- helpers di test ---
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ok  -", msg); }
  else { fail++; console.log("  FAIL-", msg); }
}

// =========================================================================
console.log("Scenario: marker SOTTO la piega, caricato in ritardo\n");

// Al load: solo le 5 notizie nuove in cima; il marker (last read) non c'è ancora.
markerKey = "n100"; // ultima letta
DOM_FEED = ["n105", "n104", "n103", "n102", "n101"].map(mkEl);

applyHighlight();            // primo giro in init()
lastSig = currentSig();
assert(statusFound === false, "al load il marker non è trovato (è sotto la piega)");
assert(badge === 5, "badge = tutte le 5 caricate (fallback, non-trovato)");

// L'osservatore scatta ma nulla è cambiato -> nessun lavoro extra.
let worked = reapplyIfChanged();
assert(worked === false, "nessuna ri-applicazione se il DOM non cambia");

// L'utente scrolla: hdblog aggiunge notizie sotto, incluso il marker n100.
DOM_FEED = ["n105","n104","n103","n102","n101","n100","n099","n098"].map(mkEl);
worked = reapplyIfChanged(); // scroll listener / observer
assert(worked === true, "ri-applica quando il feed cambia");
assert(statusFound === true, "ora il marker è trovato");
assert(statusUnread === 5, "conteggio corretto: 5 notizie sopra il marker");
assert(badge === 5, "badge corretto = 5");
assert(DOM_FEED[5].classList.contains("hdb-marker"), "la classe è sull'elemento marker");

// =========================================================================
console.log("\nScenario: convergenza (niente loop)\n");

// La mutazione causata dall'aver aggiunto la classe/label rifà scattare l'observer:
// deve risultare un NO-OP perché lastSig riflette già lo stato applicato.
const before = applyCount;
worked = reapplyIfChanged();
assert(worked === false, "seconda chiamata consecutiva = no-op (converge)");
worked = reapplyIfChanged();
assert(worked === false, "terza chiamata consecutiva = no-op (converge)");
assert(applyCount === before, "applyHighlight NON è stato richiamato inutilmente");

// =========================================================================
console.log("\nScenario: ad-churn (nodi non-articolo) non ri-applica\n");

// Un'inserzione pubblicitaria altrove NON cambia il numero di article.newlist_normal,
// quindi getFeedArticles resta identico e la firma non cambia.
const before2 = applyCount;
// (nessuna modifica a DOM_FEED)
for (let i = 0; i < 10; i++) reapplyIfChanged();
assert(applyCount === before2, "10 mutazioni non-feed = 0 ri-applicazioni");

// =========================================================================
console.log("\nScenario: nuova notizia esce mentre la home è aperta\n");

// Una notizia più recente compare in cima -> l'indice del marker sale -> unread cresce.
DOM_FEED = ["n106","n105","n104","n103","n102","n101","n100","n099"].map(mkEl);
worked = reapplyIfChanged();
assert(worked === true, "ri-applica quando compare una notizia più recente");
assert(statusUnread === 6, "unread aggiornato a 6 (una nuova in cima)");
assert(DOM_FEED[6].classList.contains("hdb-marker"), "marker ancora evidenziato correttamente");

// =========================================================================
console.log(`\nRisultato: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

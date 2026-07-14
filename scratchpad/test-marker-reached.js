/*
 * Simula la logica del doppio segnalibro CON il flag "reached" (v0.3.1).
 * Regola: il marker avanza (marker = pending precedente) SOLO se nella visita
 * precedente il marker era stato raggiunto (visto nel viewport). Altrimenti
 * resta fermo e si aggiorna solo pending.
 *
 * Riproduce il bug segnalato: ultima letta oltre il lazy-load -> prima della
 * correzione, dopo due caricamenti il marker diventava "l'ultima notizia
 * caricata nel sito" e la posizione vera andava persa.
 *
 * Esegui con: node scratchpad/test-marker-reached.js
 */

"use strict";

// ---- replica ESATTA della logica di content.js/init() + watchMarkerReached ----

function makeSite() {
  return { store: {} }; // K.marker, K.pending, K.init, K.reached
}

// Un "caricamento" della home: currentNewest è la notizia in cima al feed.
// Ritorna il marker risultante (quello evidenziato in questa visita).
function loadHome(site, currentNewest) {
  const store = site.store;
  let marker, pending;
  if (!store.init) {
    marker = currentNewest;
    pending = currentNewest;
  } else if (store.reached) {
    marker = store.pending || currentNewest;
    pending = currentNewest;
  } else {
    marker = store.marker || store.pending || currentNewest;
    pending = currentNewest;
  }
  site.store = { marker: marker, pending: pending, init: true, reached: false };
  return marker;
}

// L'utente arriva a vedere il marker durante la visita (IntersectionObserver).
function reachMarker(site) {
  site.store.reached = true;
}

function markAllRead(site, currentNewest) {
  site.store = {
    marker: currentNewest,
    pending: currentNewest,
    init: true,
    reached: true,
  };
  return currentNewest;
}

// ---- verifiche ----

let failures = 0;
function check(desc, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log((ok ? "OK " : "FAIL") + "  " + desc + (ok ? "" : "  (atteso " + want + ", ottenuto " + got + ")"));
}

console.log("--- 1) prima volta in assoluto ---");
{
  const s = makeSite();
  const m = loadHome(s, "n100");
  check("marker = pending = più recente", m, "n100");
  check("pending", s.store.pending, "n100");
}

console.log("\n--- 2) flusso normale: marker sempre visibile (comportamento invariato) ---");
{
  const s = makeSite();
  loadHome(s, "n100");
  reachMarker(s); // n100 è in cima: lo vedi subito
  let m = loadHome(s, "n103"); // escono 3 notizie
  check("2° caricamento: marker avanza al pending precedente", m, "n100");
  reachMarker(s); // 3 nuove sopra il segno, scorri e lo rivedi
  m = loadHome(s, "n105");
  check("3° caricamento: lag di un caricamento, marker = n103", m, "n103");
}

console.log("\n--- 3) BUG SEGNALATO: ultima letta oltre il lazy-load, mai raggiunta ---");
{
  const s = makeSite();
  loadHome(s, "n100");
  reachMarker(s);
  loadHome(s, "n100"); // marker consolidato su n100
  // passano settimane: 500 notizie nuove, n100 è molti scroll più in basso.
  // L'utente apre la home più volte SENZA mai scendere fino al segno.
  let m = loadHome(s, "n600");
  check("1ª apertura dopo il buco: marker resta n100", m, "n100");
  m = loadHome(s, "n610");
  check("2ª apertura (qui prima diventava 'l'ultima caricata'): resta n100", m, "n100");
  m = loadHome(s, "n625");
  check("3ª apertura: resta ancora n100", m, "n100");
  // Ora l'utente usa "Vai all'ultima letta" e ARRIVA al segno.
  reachMarker(s);
  m = loadHome(s, "n630");
  check("dopo averlo raggiunto: avanza al pending della visita del recupero", m, "n625");
}

console.log("\n--- 4) migrazione: utente esistente senza flag reached ---");
{
  const s = makeSite();
  s.store = { marker: "n200", pending: "n210", init: true }; // reached assente
  const m = loadHome(s, "n220");
  check("primo load dopo l'update: NON avanza (conservativo)", m, "n200");
  reachMarker(s);
  check("poi il flusso riparte normale", loadHome(s, "n230"), "n220");
}

console.log("\n--- 5) segna tutte come lette ---");
{
  const s = makeSite();
  loadHome(s, "n100");
  loadHome(s, "n150"); // mai raggiunto: marker fermo a n100
  const m = markAllRead(s, "n150");
  check("markAllRead porta il marker in cima", m, "n150");
  check("caricamento dopo: resta n150 (pending = n150)", loadHome(s, "n150"), "n150");
}

console.log("\n--- 6) reached si consuma a ogni caricamento ---");
{
  const s = makeSite();
  loadHome(s, "n100");
  reachMarker(s);
  loadHome(s, "n120");
  // questa visita NON raggiunge il segno
  const m = loadHome(s, "n140");
  check("senza nuovo 'reached' il marker non avanza di nuovo", m, "n100");
}

console.log(failures ? "\n" + failures + " VERIFICHE FALLITE" : "\nTutte le verifiche superate.");
process.exit(failures ? 1 : 0);

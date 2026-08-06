/*
 * v0.3.7 — segnalato dall'utente: su hdblog "delle volte le notizie vengono
 * duplicate". Risalendo il feed dopo "Vai all'ultima letta" la stessa notizia
 * compare più volte. Ricaricando la pagina i doppioni spariscono, ma il
 * ricaricamento fa avanzare il segnalibro ("mi sposta il segnalibro nella vera
 * ultima notizia") e si perde il punto di lettura.
 *
 * CAUSA (verificata dal vivo): il lazy-load di hdblog è paginato a OFFSET sulla
 * lista VIVA — pages.php?page=N ricalcola le posizioni a ogni richiesta. La home
 * è renderizzata all'apertura (blocchi 1-2), i blocchi dopo arrivano mentre
 * scorri: ogni notizia pubblicata nel frattempo fa scalare la sequenza di una
 * posizione, e il blocco che arriva RIPETE le ultime già in pagina. Misurato:
 * pubblicata n666098, la pagina 3 è passata da iniziare con n666081 a iniziare
 * con n666086 — che era l'ultima notizia della home già mostrata.
 *
 * CORREZIONI:
 *   (1) hideDuplicates(): le occorrenze successive alla prima vengono nascoste
 *       (classe .hdb-dup). Il conteggio non cambia: collectArticles già
 *       deduplicava, quindi le "41 da leggere" erano davvero 41 distinte.
 *   (2) "Ricarica pulita": ricarichiamo NOI con KEEP_PARAM nell'URL, che init()
 *       legge come STESSA VISITA (marker e pending fermi, reached conservato),
 *       e al termine si torna da soli all'ultima letta.
 *
 * Esegui con: node scratchpad/test-clean-reload-dupes.js
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

/* Elemento del feed: quel che ci serve è la chiave e le classi. */
function el(key) {
  return { key: key, cls: new Set() };
}

/* replica di content.js/collectArticles: dedup per chiave, doppioni da parte,
   raw = nodi trovati dal selettore (prima di ogni scarto). */
function collectArticles(els) {
  const out = [];
  const dups = [];
  const seen = new Set();
  for (const e of els) {
    if (!e.key) continue;
    if (seen.has(e.key)) {
      dups.push(e);
      continue;
    }
    seen.add(e.key);
    out.push({ el: e, key: e.key });
  }
  out.dups = dups;
  out.raw = els.length;
  return out;
}

/* replica di content.js/hideDuplicates */
function hideDuplicates(feed, settings, allEls) {
  if (settings && settings.hideDupes === false) return 0;
  allEls.forEach((e) => e.cls.delete("hdb-dup"));
  (feed.dups || []).forEach((e) => e.cls.add("hdb-dup"));
  return (feed.dups || []).length;
}

/* replica di content.js/currentSig (la parte che ci interessa) */
function currentSig(els, markerKey) {
  const feed = collectArticles(els);
  if (!feed.length) return null;
  const idx = markerKey ? feed.findIndex((a) => a.key === markerKey) : -1;
  const has = idx >= 0 && feed[idx].el.cls.has("hdb-marker");
  return feed.raw + "|" + feed.length + "|" + idx + "|" + (has ? 1 : 0);
}

/* quel che l'utente vede davvero scorrendo */
function visible(els) {
  return els.filter((e) => !e.cls.has("hdb-dup")).map((e) => e.key);
}

const KEEP_PARAM = "hdbkeep";
const RESCROLL_TTL_MS = 2 * 60 * 1000;

function sameVisitParams(site) {
  const out = [KEEP_PARAM];
  if (site && site.autoRefreshParam) out.push(site.autoRefreshParam);
  return out;
}

function detectSameVisitLoad(site, url) {
  if (!site) return false;
  try {
    const q = new URLSearchParams(new URL(url).search);
    return sameVisitParams(site).some((p) => q.has(p));
  } catch (e) {
    return false;
  }
}

/* replica di content.js/detectKeepLoad: SOLO il nostro marcatore. Per il
   segnalibro i due marcatori sono equivalenti, ma il ritorno all'ultima letta
   deve scattare solo dopo la nostra ricarica — mai su un auto-refresh del sito. */
function detectKeepLoad(site, url) {
  if (!site) return false;
  try {
    return new URLSearchParams(new URL(url).search).has(KEEP_PARAM);
  } catch (e) {
    return false;
  }
}

function stripVisitParams(site, url) {
  try {
    const u = new URL(url);
    sameVisitParams(site).forEach((p) => u.searchParams.delete(p));
    const qs = u.searchParams.toString();
    return u.origin + u.pathname + (qs ? "?" + qs : "") + u.hash;
  } catch (e) {
    return url;
  }
}

/* replica di content.js/init(): registro del segnalibro a un caricamento home */
function initHome(store, sameVisitLoad, currentNewest) {
  const sameVisit = !!store.init && sameVisitLoad;
  let marker, pending;
  if (!store.init) {
    marker = currentNewest;
    pending = currentNewest;
  } else if (sameVisit) {
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
    reached: sameVisit ? !!store.reached : false,
    rescroll: store.rescroll, // consumato a parte, vedi consumeRescroll
  };
}

/* replica della coda di init(): il flag si consuma SEMPRE, agisce solo se la
   ricarica è la nostra ed è recente. */
function consumeRescroll(store, keepLoad, now) {
  const r = store.rescroll;
  if (!r) return false;
  delete store.rescroll;
  return !!(keepLoad && typeof r.ts === "number" && now - r.ts < RESCROLL_TTL_MS);
}

/* Scheda del browser */
function makeTab(site, url) {
  return {
    site: site,
    url: url,
    store: {},
    didRescroll: false,
    load: function (toUrl, currentNewest, now) {
      this.url = toUrl;
      // entrambi letti PRIMA di ripulire l'URL
      const same = detectSameVisitLoad(this.site, this.url);
      const keep = detectKeepLoad(this.site, this.url);
      if (same) this.url = stripVisitParams(this.site, this.url);
      this.store = initHome(this.store, same, currentNewest);
      this.didRescroll = consumeRescroll(this.store, keep, now || 0);
      return { same: same, keep: keep, rescroll: this.didRescroll };
    },
    // F5 dell'utente: ricarica l'URL della barra
    reload: function (currentNewest, now) {
      return this.load(this.url, currentNewest, now);
    },
    // il <meta http-equiv="refresh"> del sito: URL assoluto col SUO parametro,
    // senza ancora (il meta punta a "https://www.hdblog.it/?refresh_ce" secco)
    metaRefresh: function (currentNewest, now) {
      return this.load("https://www.hdblog.it/?refresh_ce", currentNewest, now);
    },
    // pulsante "Ricarica pulita": mettiamo NOI il marcatore e il flag di ritorno
    cleanReload: function (currentNewest, now) {
      this.store.rescroll = { ts: now || 0 };
      const u = new URL(this.url);
      u.searchParams.set(KEEP_PARAM, "1");
      return this.load(u.href, currentNewest, now);
    },
  };
}

const HDBLOG = { autoRefreshParam: "refresh_ce" };
const HWU = {};
const HOME = "https://www.hdblog.it/";

// ------------------------------------------------ (1) i doppioni del lazy-load

console.log("\n(1) doppioni generati dalla paginazione a offset (dati reali)\n");

{
  // Home renderizzata all'apertura = blocchi ajax 1+2 (misurata: 17 notizie).
  const home = [
    "n664266", "n666061", "n665691", "n665793", "n666104", "n666105",
    "n666106", "n666100", "n666097", "n666095", "n666094", "n666091",
    "n666090", "n666093", "n666088", "n666064", "n666086",
  ];
  // Blocco 3 chiesto DOPO, quando era uscita n666098: tutto scalato di una
  // posizione, quindi ricomincia da n666086 — l'ultima già in pagina.
  const p3 = [
    "n666086", "n666081", "n666082", "n666077", "n666079", "n666062",
    "n666072", "n642360",
  ];

  const els = home.concat(p3).map(el);
  const feed = collectArticles(els);

  check("nodi nel DOM (doppione compreso)", feed.raw, 25);
  check("notizie distinte", feed.length, 24);
  check("doppioni individuati", feed.dups.length, 1);
  check("il doppione è quello previsto", feed.dups[0].key, "n666086");

  // Il conteggio non era gonfiato nemmeno prima: collectArticles già deduplicava.
  const marker = "n642360";
  const idx = feed.findIndex((a) => a.key === marker);
  check("non lette = posizione del marker fra le DISTINTE", idx, 23);

  const hidden = hideDuplicates(feed, { hideDupes: true }, els);
  check("nascosto 1 elemento", hidden, 1);
  check("l'utente scorre 24 notizie, non 25", visible(els).length, 24);
  check(
    "resta la PRIMA occorrenza, in posizione cronologica giusta",
    visible(els).indexOf("n666086"),
    16
  );
  check(
    "n666086 compare una volta sola",
    visible(els).filter((k) => k === "n666086").length,
    1
  );
  check(
    "la notizia dopo il doppione è intatta",
    visible(els)[17],
    "n666081"
  );
}

// ------------------------------------- (2) idempotenza e ri-render del sito

console.log("\n(2) applyHighlight gira più volte: niente accumuli\n");

{
  const els = ["a", "b", "c", "b", "d"].map(el);
  hideDuplicates(collectArticles(els), { hideDupes: true }, els);
  const first = visible(els);
  hideDuplicates(collectArticles(els), { hideDupes: true }, els);
  hideDuplicates(collectArticles(els), { hideDupes: true }, els);
  check("tre applicazioni = una", visible(els), first);
  check("resta nascosto solo il secondo 'b'", visible(els), ["a", "b", "c", "d"]);
}

{
  // Il sito ri-renderizza la lista e il doppione diventa la prima occorrenza:
  // senza la ripulitura iniziale resterebbe nascosto a torto.
  const a1 = el("x"), a2 = el("x");
  let els = [a1, a2];
  hideDuplicates(collectArticles(els), { hideDupes: true }, els);
  check("prima: nascosta la seconda occorrenza", visible(els), ["x"]);
  els = [a2]; // il sito ha tolto il primo nodo
  hideDuplicates(collectArticles(els), { hideDupes: true }, els);
  check("dopo il re-render la notizia riappare", visible(els), ["x"]);
}

{
  const els = ["a", "b", "a"].map(el);
  hideDuplicates(collectArticles(els), { hideDupes: false }, els);
  check(
    "interruttore spento: non si nasconde nulla",
    visible(els),
    ["a", "b", "a"]
  );
}

// ------------------------------- (3) firma: blocco di SOLI doppioni

console.log("\n(3) la firma del feed vede anche un blocco di soli doppioni\n");

{
  const els = ["a", "b", "c"].map(el);
  const sigBefore = currentSig(els, "c");
  // Arriva un blocco che ripete soltanto notizie già in pagina: la lista delle
  // distinte NON cambia lunghezza — senza feed.raw nella firma resterebbero visibili.
  els.push(el("a"), el("b"));
  const sigAfter = currentSig(els, "c");
  check("la firma cambia comunque", sigBefore !== sigAfter, true);
  check("firma prima", sigBefore, "3|3|2|0");
  check("firma dopo", sigAfter, "5|3|2|0");
}

// ------------------------------------------------ (4) la "Ricarica pulita"

console.log("\n(4) Ricarica pulita: feed pulito, segnalibro fermo\n");

{
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000); // prima visita
  check("prima visita: marker sulla più recente", tab.store.marker, "n10");

  tab.store.reached = true; // "Vai all'ultima letta" -> il segno è stato visto
  const r = tab.cleanReload("n41", 2000);

  check("il caricamento è riconosciuto come stessa visita", r.same, true);
  check("il marker NON avanza", tab.store.marker, "n10");
  check("pending resta fermo", tab.store.pending, "n10");
  check("'reached' conservato", tab.store.reached, true);
  check("si torna da soli all'ultima letta", r.rescroll, true);
  check("la barra degli indirizzi torna pulita", tab.url, HOME);
}

{
  // L'ancora di hdblog (#?t=..&b=N) è ciò che gli fa rirenderizzare tutti i
  // blocchi già aperti in una sola richiesta: va conservata.
  const withHash = HOME + "#?t=homenews&b=6";
  const tab = makeTab(HDBLOG, withHash);
  tab.load(withHash, "n10", 1000);
  tab.store.reached = true;
  tab.cleanReload("n41", 2000);
  check("l'ancora sopravvive alla ricarica", tab.url, withHash);
}

{
  // Il punto della segnalazione: l'F5 a mano continua a essere una visita vera
  // (non lo sappiamo distinguere), la Ricarica pulita no.
  const a = makeTab(HDBLOG, HOME);
  a.load(HOME, "n10", 1000);
  a.store.reached = true;
  a.reload("n41", 2000);
  check("F5 a mano: il marker avanza (invariato)", a.store.marker, "n10");
  check("F5 a mano: pending va alla più recente", a.store.pending, "n41");
  check("F5 a mano: 'reached' azzerato", a.store.reached, false);

  const b = makeTab(HDBLOG, HOME);
  b.load(HOME, "n10", 1000);
  b.store.reached = true;
  b.cleanReload("n41", 2000);
  check("Ricarica pulita: pending NON si sposta", b.store.pending, "n10");
}

{
  // Dopo la ricarica pulita la visita prosegue: la prima visita VERA successiva
  // riprende il registro normale, da dove era rimasta.
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.reached = true;
  tab.cleanReload("n41", 2000);
  tab.load(HOME, "n50", 3000); // il giorno dopo
  check("visita vera dopo la ricarica: avanza a pending", tab.store.marker, "n10");
  check("visita vera: pending alla più recente", tab.store.pending, "n50");
}

{
  // Interazione con l'auto-refresh del sito: entrambi sono "stessa visita".
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.reached = true;
  tab.cleanReload("n41", 2000);
  const r = tab.load("https://www.hdblog.it/?refresh_ce", "n45", 3000);
  check("auto-refresh dopo la ricarica pulita: ancora stessa visita", r.same, true);
  check("marker sempre fermo", tab.store.marker, "n10");
  check("nessun ritorno al segno non richiesto", r.rescroll, false);
}

// -------------------------------------- (5) il flag di ritorno non resta appeso

console.log("\n(5) il flag 'torna al segno' si consuma sempre\n");

{
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.reached = true;
  tab.cleanReload("n41", 2000);
  const r2 = tab.reload("n41", 2500);
  check("al caricamento dopo non riparte", r2.rescroll, false);
  check("il flag è sparito dallo storage", tab.store.rescroll, undefined);
}

{
  // Scheda chiusa prima che il flag scattasse: alla visita di domani non deve
  // dirottare nulla.
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.rescroll = { ts: 1000 };
  const r = tab.load(HOME, "n41", 1000 + 10 * 60 * 1000);
  check("flag scaduto: nessun salto", r.rescroll, false);
  check("flag rimosso comunque", tab.store.rescroll, undefined);
}

{
  // Flag recente ma caricamento non nostro (F5 dell'utente): non deve scattare.
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.rescroll = { ts: 2000 };
  const r = tab.reload("n41", 2100);
  check("caricamento non marcato: nessun salto", r.rescroll, false);
}

// ------------------------- (5b) il refresh automatico di hdblog (~ogni 13 min)

console.log("\n(5b) auto-refresh del sito: cosa cambia con le novità v0.3.7\n");

{
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.reached = true; // hai raggiunto il segno leggendo

  const r = tab.metaRefresh("n41", 1000 + 13 * 60 * 1000);
  check("resta riconosciuto come stessa visita", r.same, true);
  check("NON è la nostra ricarica", r.keep, false);
  check("il segnalibro resta fermo", tab.store.marker, "n10");
  check("pending resta congelato", tab.store.pending, "n10");
  check("'reached' conservato", tab.store.reached, true);
  check("la pagina non salta da nessuna parte", r.rescroll, false);
  check("URL ripulito (niente ?refresh_ce incollato)", tab.url, HOME);
}

{
  // Caso limite chiuso: "Ricarica pulita" il cui caricamento non è mai arrivato
  // (l'utente clicca un link mentre la pagina si ricarica) lascia il flag
  // appeso. L'auto-refresh, che è pure lui "stessa visita", NON deve raccoglierlo
  // e trascinare la pagina all'ultima letta sotto gli occhi dell'utente.
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 1000);
  tab.store.rescroll = { ts: 2000 }; // flag rimasto appeso, recentissimo
  const r = tab.metaRefresh("n41", 2100);
  check("auto-refresh con flag appeso: nessun salto", r.rescroll, false);
  check("...e il flag viene comunque tolto di mezzo", tab.store.rescroll, undefined);
}

{
  // Sequenza realistica: leggo, ricarico pulito, e 13 minuti dopo scatta
  // l'auto-refresh del sito.
  const tab = makeTab(HDBLOG, HOME);
  tab.load(HOME, "n10", 0);
  tab.store.reached = true;
  const a = tab.cleanReload("n41", 60 * 1000);
  check("Ricarica pulita: torna al segno", a.rescroll, true);
  const b = tab.metaRefresh("n45", 60 * 1000 + 13 * 60 * 1000);
  check("auto-refresh dopo: nessun secondo salto", b.rescroll, false);
  check("marker ancora fermo dopo entrambi", tab.store.marker, "n10");
  check("'reached' ancora conservato", tab.store.reached, true);
}

{
  // Il feed rirenderizzato dall'auto-refresh è un'istantanea coerente del server:
  // nessun doppione da nascondere finché non si torna a scorrere.
  const fresh = ["n50", "n49", "n48", "n47"].map(el);
  const feed = collectArticles(fresh);
  check("dopo l'auto-refresh: zero doppioni", feed.dups.length, 0);
  check("nulla viene nascosto", hideDuplicates(feed, { hideDupes: true }, fresh), 0);
  check("il feed si vede tutto", visible(fresh).length, 4);
}

// --------------------------------------- (6) siti senza auto-refresh proprio

console.log("\n(6) la Ricarica pulita vale per tutti i siti\n");

{
  const tab = makeTab(HWU, "https://www.hwupgrade.it/");
  tab.load("https://www.hwupgrade.it/", "a1", 1000);
  tab.store.reached = true;
  const r = tab.cleanReload("a9", 2000);
  check("hwupgrade: riconosciuta come stessa visita", r.same, true);
  check("hwupgrade: marker fermo", tab.store.marker, "a1");
  check("hwupgrade: URL ripulito", tab.url, "https://www.hwupgrade.it/");
  // ...ma il parametro del SITO resta specifico di hdblog
  check(
    "hwupgrade: refresh_ce non è un suo marcatore",
    detectSameVisitLoad(HWU, "https://www.hwupgrade.it/?refresh_ce"),
    false
  );
}

console.log(
  "\n" + (failures ? failures + " CONTROLLI FALLITI" : "tutti i controlli ok") + "\n"
);
process.exit(failures ? 1 : 0);

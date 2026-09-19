/*
 * v0.4.0 — segnalato dall'utente: su hdblog c'erano 97 notizie nuove, "Vai
 * all'ultima letta" ha scrollato la home fino in fondo, è passato alle pagine
 * /page/N/ ed è arrivato fino a pagina 40 SENZA trovare l'ultima letta.
 * Cercandola a mano, invece, la notizia era lì, regolarmente evidenziata.
 *
 * CAUSA (misurata nella sezione LIVE qui sotto):
 *  1) 97 non lette ESATTE vuol dire che il segnalibro stava DENTRO il feed
 *     della home: la home di hdblog arriva a ~100 notizie (20 renderizzate +
 *     8 blocchi lazy da 10; il muro è MAX_NUM_PAGES=10 nel JS del sito e il
 *     server risponde vuoto da page=11). La ricerca però smetteva di scrollare
 *     dopo "8 giri senza che scrollY cambi", cioè 1,6 secondi — meno di quanto
 *     ci mette UN blocco ad arrivare. Bastava un blocco lento e la home veniva
 *     abbandonata a metà.
 *  2) Abbandonata la home, la ricerca passava all'archivio /page/N/, che
 *     comincia DOPO le notizie della home: la 97ª non poteva esserci. Sfogliare
 *     40 pagine era tempo perso per costruzione.
 *  3) Di ogni pagina d'archivio si guardavano solo le ~20 notizie renderizzate
 *     dal server, ignorando quelle che la pagina carica scrollando (stesso
 *     stampo della home): l'80% di ogni pagina non veniva nemmeno guardato.
 *  4) Arrivati in fondo alla home, il sito CLICCA DA SOLO il suo pulsante
 *     "Clicca qui per Altre Notizie" (handler sullo scroll). Finito il
 *     lazy-load quel pulsante non carica più niente: è un link a /page/2/, e
 *     quel clic automatico portava via la pagina mentre stavamo ancora
 *     cercando.
 *
 * CORREZIONE (content.js):
 *  - growFeedByScrolling(): si scrolla finché il FEED CRESCE (non finché si
 *    muove lo scroll), con pazienza di 7s di immobilità totale / 20s senza
 *    notizie nuove / 90s di tetto;
 *  - installAutoNavGuard(): durante la ricerca i clic NON fidati (isTrusted
 *    false = generati dallo script del sito) non navigano più via;
 *  - le pagine d'archivio vengono scrollate come la home prima di dichiarare
 *    "non c'è";
 *  - il flag seek viene messo PRIMA di scrollare (se il sito ci sposta lo
 *    stesso, la pagina d'arrivo riprende la ricerca) e accetta le pagine
 *    >= a quella attesa;
 *  - la passeggiata nell'archivio ha un limite DIMOSTRABILE: con il conteggio
 *    esatto (target = posizione del segnalibro) si smette appena si sono
 *    esaminate più di `target` notizie, perché l'archivio va solo indietro nel
 *    tempo e il segnalibro è ormai alle spalle.
 *  - sites.js: il conteggio di hdblog usa pages.php?page=1&b=10, che restituisce
 *    tutte le ~100 notizie raggiungibili in UNA richiesta e in un'unica
 *    istantanea coerente (niente sequenza che scivola fra un fetch e l'altro).
 *
 * Esegui con: node scratchpad/test-deep-seek.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

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

// ------------------------------------------------- config reale da sites.js

const shim = {};
new Function(
  "self",
  fs.readFileSync(path.join(__dirname, "..", "sites.js"), "utf8")
)(shim);
const hdblog = shim.NEWS_SITES.find((s) => s.id === "hdblog");
const hwu = shim.NEWS_SITES.find((s) => s.id === "hwupgrade");

// --------------------------------------------------------- repliche di content.js

// growFeedByScrolling: la condizione di uscita. Qui si simula il tempo, così il
// test è istantaneo; la logica (cosa conta come "progresso") è quella vera.
const GROW_MAX_MS = 90 * 1000;
const GROW_IDLE_MS = 7000;
const GROW_FEED_IDLE_MS = 20000;

/* page = { steps: [{dt, feed, y}] } cronologia di quel che succede a ogni giro.
   Ritorna { len, stopped, ms }: quante notizie caricate e perché ci si è fermati. */
function growSim(steps, targetAt) {
  let t = 0;
  let bestLen = steps.length ? steps[0].feed : 0;
  let bestY = 0;
  let lastAny = 0;
  let lastFeed = 0;
  let len = bestLen;
  for (let i = 0; i < steps.length; i++) {
    if (targetAt != null && len >= targetAt) return { len, stopped: "trovato", ms: t };
    const s = steps[i];
    t += s.dt;
    if (t >= GROW_MAX_MS) return { len, stopped: "tetto", ms: t };
    len = s.feed;
    if (s.feed > bestLen) {
      bestLen = s.feed;
      lastFeed = t;
      lastAny = t;
    }
    if (s.y > bestY) {
      bestY = s.y;
      lastAny = t;
    }
    if (t - lastAny > GROW_IDLE_MS) return { len, stopped: "fermo", ms: t };
    if (t - lastFeed > GROW_FEED_IDLE_MS) return { len, stopped: "niente notizie", ms: t };
  }
  return { len, stopped: "fine", ms: t };
}

// La VECCHIA condizione, per far vedere il guasto: 8 giri di fila senza che
// scrollY cambi (200ms l'uno = 1,6s) e si molla.
function oldSim(steps) {
  let stuck = 0;
  let y = 0;
  let len = steps.length ? steps[0].feed : 0;
  for (let i = 0; i < steps.length && stuck < 8; i++) {
    const s = steps[i];
    stuck = s.y === y ? stuck + 1 : 0;
    y = s.y;
    len = s.feed;
  }
  return len;
}

// Blocchi lazy di hdblog: dopo ogni blocco si scende fino in fondo, poi la
// pagina resta ferma finché non arriva il blocco successivo (richiesta di rete).
function hdblogSteps(blockMs) {
  const steps = [];
  let feed = 20; // notizie renderizzate dal server
  let y = 0;
  for (let b = 0; b < 8; b++) {
    // attesa del blocco: la pagina è già in fondo, scrollY non si muove
    const giri = Math.round(blockMs / 250);
    for (let i = 0; i < giri; i++) steps.push({ dt: 250, feed, y });
    feed += 10; // arriva il blocco
    y += 3000; // e c'è di nuovo pagina sotto
    steps.push({ dt: 250, feed, y });
    // qualche giro di discesa dentro il blocco appena arrivato
    for (let i = 0; i < 3; i++) {
      y += 800;
      steps.push({ dt: 250, feed, y });
    }
  }
  // muro: niente più blocchi, la pagina non cresce più
  for (let i = 0; i < 60; i++) steps.push({ dt: 250, feed, y });
  return steps;
}

// La passeggiata nell'archivio, con il limite dimostrabile.
const ARCHIVE_SLACK = 30;
function walk(seek, pageFeeds, maxPages) {
  // pageFeeds[p] = notizie viste nella pagina p; markerAt = pagina dov'è (o null)
  const visited = [];
  let cur = seek.page;
  let scanned = seek.scanned | 0;
  for (;;) {
    visited.push(cur);
    const info = pageFeeds[cur] || { len: 0, found: false };
    if (info.found) return { visited, esito: "trovato" };
    scanned += info.len;
    const overshot =
      typeof seek.target === "number" && scanned > seek.target + ARCHIVE_SLACK;
    if (!info.len) return { visited, esito: "pagina vuota" };
    if (overshot) return { visited, esito: "superato" };
    if (cur >= maxPages) return { visited, esito: "tetto" };
    cur++;
  }
}

console.log("\n== scroll della home: pazienza (il guasto segnalato) ==");
{
  // Blocco lento (2s): la vecchia condizione molla al primo blocco.
  const steps = hdblogSteps(2000);
  check("vecchia logica: si ferma quasi subito", oldSim(steps) < 60, true);
  check("vecchia logica: non arriva alle 97 notizie", oldSim(steps) >= 98, false);
  const g = growSim(steps);
  check("nuova logica: carica tutte le 100 notizie", g.len, 100);
  check("nuova logica: si ferma perché non si muove più", g.stopped, "fermo");
  check("nuova logica: il segnalibro a 97 viene raggiunto", growSim(steps, 98).stopped, "trovato");
}
{
  // Blocco lentissimo (6s): ancora dentro la pazienza.
  const g = growSim(hdblogSteps(6000));
  check("blocchi da 6s: arriva comunque in fondo", g.len, 100);
}
{
  // Sito che smette di servire notizie ma continua a crescere (pubblicità):
  // si esce per FEED_IDLE, non si scrolla fino al tetto dei 90s.
  const steps = [];
  let y = 0;
  for (let i = 0; i < 400; i++) {
    y += 500; // la pagina cresce sempre
    steps.push({ dt: 250, feed: 40, y });
  }
  const g = growSim(steps);
  check("pagina che cresce ma senza notizie: si smette", g.stopped, "niente notizie");
  check("... e non si arriva al tetto dei 90s", g.ms < 30000, true);
}

console.log("\n== limite dimostrabile della passeggiata nell'archivio ==");
{
  // Il caso dell'utente: segnalibro a 97, archivio che comincia dopo la home.
  // Pagine da ~20 notizie, il segnalibro non c'è in nessuna.
  const pages = {};
  for (let p = 1; p <= 40; p++) pages[p] = { len: 20, found: false };
  const senza = walk({ page: 2, scanned: 0 }, pages, 40);
  check("senza target: sfoglia fino al tetto (il guasto)", senza.visited.length, 39);
  check("senza target: finisce per esaurimento pagine", senza.esito, "tetto");
  const con = walk({ page: 2, scanned: 0, target: 97 }, pages, 40);
  check("con target 97: si ferma appena superata la posizione", con.esito, "superato");
  check("con target 97: poche pagine, non 39", con.visited.length <= 8, true);
}
{
  // Se invece il segnalibro c'è davvero, il limite non deve tagliare la ricerca.
  const pages = {};
  for (let p = 1; p <= 40; p++) pages[p] = { len: 20, found: p === 5 };
  const r = walk({ page: 2, scanned: 0, target: 97 }, pages, 40);
  check("segnalibro a pagina 5: lo trova", r.esito, "trovato");
  check("segnalibro a pagina 5: ci arriva senza fermarsi prima", r.visited, [2, 3, 4, 5]);
}
{
  // Pagine grandi (l'archivio di hdblog carica ~100 notizie a pagina se lo si
  // scrolla): il limite scatta anche prima.
  const pages = {};
  for (let p = 1; p <= 40; p++) pages[p] = { len: 100, found: false };
  const r = walk({ page: 2, scanned: 0, target: 97 }, pages, 40);
  check("pagine da 100 notizie: basta la prima per capire", r.visited, [2, 3]);
}
{
  // Flag vecchio (senza target): comportamento di prima, nessuna regressione.
  const pages = { 2: { len: 20, found: false }, 3: { len: 0, found: false } };
  const r = walk({ page: 2 }, pages, 40);
  check("flag senza target: si ferma sulla pagina vuota", r.esito, "pagina vuota");
}

console.log("\n== flag di ricerca: pagina >= a quella attesa ==");
{
  const seekHere = (seek, page) => !!(seek && page >= (seek.page | 0));
  check("pagina attesa", seekHere({ page: 3 }, 3), true);
  check("il sito ci ha portati avanti da solo: la ricerca continua", seekHere({ page: 3 }, 4), true);
  check("pagina precedente (visita manuale): non dirottata", seekHere({ page: 5 }, 2), false);
}

console.log("\n== guard sulla navigazione automatica ==");
{
  // Solo i clic NON fidati che portano fuori dalla pagina vengono annullati.
  const guard = (e, href, here) => {
    if (e.isTrusted) return "passa";
    if (!href) return "passa";
    const dest = new URL(href, here);
    if (dest.href.split("#")[0] === here.split("#")[0]) return "passa";
    return "bloccato";
  };
  const here = "https://www.hdblog.it/";
  check("clic dello script sul bottone: bloccato", guard({ isTrusted: false }, "/page/2/", here), "bloccato");
  check("clic dell'utente sullo stesso bottone: passa", guard({ isTrusted: true }, "/page/2/", here), "passa");
  check("ancora nella stessa pagina: passa", guard({ isTrusted: false }, "#?t=1&b=4", here), "passa");
  check("link a una notizia (clic vero): passa", guard({ isTrusted: true }, "/n668490/x/", here), "passa");
}

console.log("\n== config sites.js ==");
{
  check("hdblog: conteggio in una richiesta sola", hdblog.archive.countMaxPages, 1);
  check(
    "hdblog: il conteggio usa il parametro b=10",
    /[?&]b=10/.test(hdblog.archive.countTemplate),
    true
  );
  check("hdblog: archivio navigabile /page/{n}/", hdblog.archive.urlTemplate, "https://www.hdblog.it/page/{n}/");
  check("hdblog: la ricerca parte da pagina 1 (v0.4.2)", hdblog.archive.firstPage, 1);
  check("hdblog: niente ricerca a forza di scroll (v0.4.2)", hdblog.noScrollSeek, true);
  check("hdblog: feed della home NON statico (si scrolla)", !!hdblog.feedStatic, false);
  check("hwupgrade: feed statico (non si scrolla)", hwu.feedStatic, true);
  check("hwupgrade: conteggio invariato", hwu.archive.countTemplate, undefined);
}

// --------------------------------------------------------------- controlli LIVE
// hdblog rifiuta l'handshake TLS di Node (ECONNRESET): si scarica con
// PowerShell (TLS 1.2 forzato, il figlio -NoProfile parte con TLS 1.0).

function fetchPS(url) {
  const out = path.join(os.tmpdir(), "hdb_" + Date.now() + ".html");
  const ps =
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " +
    "$r=Invoke-WebRequest -Uri '" +
    url +
    "' -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' " +
    "-TimeoutSec 60 -UseBasicParsing; $r.Content | Out-File -Encoding utf8 '" +
    out +
    "'";
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const html = fs.readFileSync(out, "utf8");
    fs.unlinkSync(out);
    return html;
  } catch (e) {
    try {
      fs.unlinkSync(out);
    } catch (e2) {}
    return null;
  }
}

function keysOf(html) {
  const out = [];
  const re = /<article[^>]*class="[^"]*newlist_normal[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    const a =
      /<a[^>]*class="[^"]*title_new[^"]*"[^>]*href="([^"]+)"/.exec(body) ||
      /href="([^"]+)"/.exec(body);
    if (!a) continue;
    const id = /\/n(\d+)\//.exec(a[1]);
    out.push(id ? "n" + id[1] : a[1]);
  }
  return out;
}

if (process.argv.indexOf("--no-live") === -1) {
  console.log("\n== LIVE: il feed raggiungibile della home di hdblog ==");
  const oneShot = fetchPS(hdblog.archive.countTemplate.replace("{n}", "1"));
  if (!oneShot) {
    console.log("  (saltato: sito non raggiungibile)");
  } else {
    const k = keysOf(oneShot);
    check("una sola richiesta restituisce ~100 notizie", k.length >= 95 && k.length <= 105, true);
    check("nessun doppione nell'istantanea", new Set(k).size, k.length);

    const home = fetchPS("https://www.hdblog.it/");
    if (home) {
      const hk = keysOf(home);
      check("la home ne renderizza ~20", hk.length >= 15 && hk.length <= 25, true);
      check("la home è il PREFISSO della sequenza", hk.every((x, i) => k[i] === x), true);
      console.log(
        "        (segnalibro a 97 non lette = notizia n." +
          98 +
          " di " +
          k.length +
          ": dentro il feed della home, NON nell'archivio)"
      );
    }

    const wall = fetchPS("https://www.hdblog.it/new_files/ajax/pages.php?page=11");
    if (wall !== null)
      check("muro del lazy-load: page=11 non ha notizie", keysOf(wall).length, 0);

    // Le pagine navigabili rispondono 429 a chi non è una navigazione vera del
    // browser: il fetch non porta a casa nemmeno una notizia (vedi BUG #14).
    const nav = fetchPS("https://www.hdblog.it/page/2/");
    check(
      "/page/2/ non scaricabile (429): si può solo NAVIGARE",
      !nav || keysOf(nav).length === 0,
      true
    );
  }
}

console.log(
  "\n" + (failures ? failures + " CONTROLLI FALLITI" : "tutti i controlli ok")
);
process.exit(failures ? 1 : 0);

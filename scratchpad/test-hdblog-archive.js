/*
 * v0.3.9 — segnalato dall'utente al ritorno da una vacanza lunga (più di 99
 * notizie arretrate): su hwupgrade "Vai all'ultima letta" funziona, su hdblog
 * no — «si è ferma[to] sul bottone "clicca qui per altre notizie" che mi porta
 * ad un'altra pagina https://www.hdblog.it/page/2/».
 *
 * CAUSA (misurata nella sezione LIVE qui sotto): il feed della home di hdblog
 * ha un muro. Il lazy-load chiede /new_files/ajax/pages.php?page=N e il SERVER
 * si ferma a page=10 (da page=11 risponde con un blocco vuoto che contiene solo
 * "var autoloading_disabled = true"); lo stesso tetto sta nel JS del sito
 * (MAX_NUM_PAGES = 10). Totale raggiungibile scrollando: home (~19) + pagine
 * 3..10 = ~99 notizie. Più indietro di così scrollToMarker scrollava a vuoto e
 * usciva in silenzio, lasciando l'utente sul bottone — che non carica altro in
 * pagina ma NAVIGA su /page/N/.
 *
 * CORREZIONE (come chiesto dall'utente, "un po' come facciamo ora su
 * hwupgrade"): /page/N/ È l'archivio di hdblog. La ricerca dell'ultima letta ci
 * prosegue pagina per pagina con la stessa macchina di hwupgrade (flag seek +
 * initArchive), partendo da pagina 2 (la 1 ripete la home). Il CONTEGGIO resta
 * sull'endpoint ajax, che è l'unico scaricabile via fetch: le pagine navigabili
 * rispondono 429 a chi non è una navigazione vera del browser.
 *
 * Qui si verificano: URL/numerazione dell'archivio, la passeggiata fra le
 * pagine, la sorgente separata per il conteggio, e il nuovo interruttore
 * "Non spostare mai il segnalibro" (freezeMarker).
 *
 * Esegui con: node scratchpad/test-hdblog-archive.js
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
new Function("self", fs.readFileSync(path.join(__dirname, "..", "sites.js"), "utf8"))(shim);
const SITES = shim.NEWS_SITES;
const hdblog = SITES.find((s) => s.id === "hdblog");
const hwu = SITES.find((s) => s.id === "hwupgrade");

// ---------------------------------------------------------------- repliche

/* content.js: archiveFirstPage / archiveMaxPages / archiveUrlFor / countUrlFor */
const archiveFirstPage = (s) => (s.archive && s.archive.firstPage) || 1;
const archiveMaxPages = (s) => (s.archive && s.archive.maxPages) || 40;

function archiveUrlFor(s, page) {
  if (s.archive.urlTemplate)
    return s.archive.urlTemplate.replace("{n}", String(page));
  return s.archive.urlBase + (page > 1 ? String(page) : "") + ".html";
}

function countUrlFor(s, page) {
  if (s.archive && s.archive.countTemplate)
    return s.archive.countTemplate.replace("{n}", String(page));
  return archiveUrlFor(s, page);
}

/* content.js/archivePageNum: numero di pagina dal percorso, null se non è una
   pagina d'archivio */
function archivePageNum(s, pathname) {
  if (!s.archive || !s.archive.pathRegex) return null;
  const m = pathname.match(new RegExp(s.archive.pathRegex));
  if (!m) return null;
  return m[1] ? parseInt(m[1], 10) : 1;
}

/* La ricerca completa: scrollToMarker parte dalla home (o prosegue da una
   pagina d'archivio), poi ogni pagina cerca il marker e passa alla successiva
   (content.js/startArchiveSeek + initArchive). Ritorna le pagine visitate. */
function seekWalk(s, pages, markerKey, fromPath) {
  const visited = [];
  const cur = fromPath === null ? null : archivePageNum(s, fromPath);
  let page = cur === null ? archiveFirstPage(s) : cur + 1;
  if (page > archiveMaxPages(s)) return { visited: visited, found: false };
  while (page <= archiveMaxPages(s)) {
    visited.push(page);
    const keys = pages[page] || [];
    if (keys.indexOf(markerKey) !== -1) return { visited: visited, found: true };
    if (!keys.length) break; // pagina vuota: fine archivio, ci si ferma
    page++;
  }
  return { visited: visited, found: false };
}

/* content.js/init(): quale segnalibro dopo questo caricamento.
   L'ordine dei casi è quello del codice: prima volta, stessa visita
   (auto-refresh / ricarica pulita), segnalibro BLOCCATO, raggiunto, non
   raggiunto. */
function decide(st, opts) {
  const newest = opts.newest;
  if (!st.init) return { marker: newest, pending: newest };
  if (opts.sameVisit)
    return {
      marker: st.marker || st.pending || newest,
      pending: st.pending || newest,
    };
  if (opts.freeze)
    return { marker: st.marker || st.pending || newest, pending: newest };
  if (st.reached) return { marker: st.pending || newest, pending: newest };
  return { marker: st.marker || st.pending || newest, pending: newest };
}

// ------------------------------------------------------------------ 1) URL

console.log("\n== 1) archivio di hdblog: URL e numerazione ==");
check("pagina 1 = la prima della ricerca (v0.4.2: /page/1/ = sequenza completa della home)", archiveFirstPage(hdblog), 1);
check("url pagina 2", archiveUrlFor(hdblog, 2), "https://www.hdblog.it/page/2/");
check("url pagina 17", archiveUrlFor(hdblog, 17), "https://www.hdblog.it/page/17/");
check("tetto pagine", archiveMaxPages(hdblog), 40);
check("riconosce /page/12/", archivePageNum(hdblog, "/page/12/"), 12);
check("riconosce /page/2 senza slash", archivePageNum(hdblog, "/page/2"), 2);
check("la home NON è una pagina d'archivio", archivePageNum(hdblog, "/"), null);
check(
  "un articolo NON è una pagina d'archivio",
  archivePageNum(hdblog, "/linux/articoli/n667390/linux-72-ufficiale/"),
  null
);
// v0.4.0: il conteggio resta sull'endpoint ajax, ma in UNA richiesta sola —
// pages.php?page=1&b=10 restituisce tutti i blocchi insieme (~100 notizie) in
// un'istantanea coerente, invece di 10 fetch su una lista che intanto scorre.
// Vedi scratchpad/test-deep-seek.js.
check(
  "il conteggio usa l'endpoint ajax, non le pagine navigabili",
  countUrlFor(hdblog, 1),
  "https://www.hdblog.it/new_files/ajax/pages.php?page=1&b=10"
);
check("conteggio in una richiesta sola (b=10)", hdblog.archive.countMaxPages, 1);

console.log("\n== 1b) hwupgrade non è cambiato ==");
check("parte da pagina 1", archiveFirstPage(hwu), 1);
check("url pagina 1", archiveUrlFor(hwu, 1), "https://www.hwupgrade.it/news/index.html");
check("url pagina 5", archiveUrlFor(hwu, 5), "https://www.hwupgrade.it/news/index5.html");
check(
  "senza countTemplate conta sulle stesse pagine che naviga",
  countUrlFor(hwu, 3),
  "https://www.hwupgrade.it/news/index3.html"
);
check("riconosce /news/index3.html", archivePageNum(hwu, "/news/index3.html"), 3);
check("index.html senza numero = pagina 1", archivePageNum(hwu, "/news/index.html"), 1);

// ------------------------------------------------------- 2) la passeggiata

console.log("\n== 2) la ricerca sfoglia le pagine finché trova ==");
// archivio finto: 10 notizie a pagina, pagina 1 = quelle già nella home
const PAGES = {};
for (let p = 1; p <= 30; p++) {
  PAGES[p] = [];
  for (let i = 0; i < 10; i++) PAGES[p].push("n" + (700000 - ((p - 1) * 10 + i)));
}
PAGES[31] = []; // fine archivio

{
  const marker = PAGES[7][3];
  const res = seekWalk(hdblog, PAGES, marker, null);
  check("dalla home (posizione ignota) si parte da pagina 1", res.visited[0], 1);
  check("si arriva alla pagina del segnalibro", res.found, true);
  check("pagine visitate", res.visited, [1, 2, 3, 4, 5, 6, 7]);
}
{
  // già in una pagina d'archivio: si riprende dalla DOPO, non da capo
  const marker = PAGES[9][0];
  const res = seekWalk(hdblog, PAGES, marker, "/page/6/");
  check("si riprende dalla pagina successiva", res.visited[0], 7);
  check("trovato", res.found, true);
  check("nessuna pagina rifatta", res.visited, [7, 8, 9]);
}
{
  // segnalibro che non c'è: ci si ferma alla pagina vuota, non all'infinito
  const res = seekWalk(hdblog, PAGES, "n000000", null);
  check("si ferma sulla pagina vuota", res.visited[res.visited.length - 1], 31);
  check("non trovato", res.found, false);
}
{
  // archivio senza fondo: si smette al tetto
  const endless = {};
  for (let p = 1; p <= 100; p++) endless[p] = ["x" + p];
  const res = seekWalk(hdblog, endless, "mai", null);
  check("tetto di pagine rispettato", res.visited[res.visited.length - 1], 40);
  check("pagine visitate = dal 2 al tetto", res.visited.length, 39);
}
{
  // ripresa oltre il tetto: non si parte nemmeno
  const res = seekWalk(hdblog, PAGES, PAGES[3][0], "/page/40/");
  check("oltre il tetto non si naviga", res.visited, []);
}

// ------------------------------- 3) interruttore "non spostare il segnalibro"

console.log("\n== 3) segnalibro bloccato (freezeMarker) ==");
{
  // Comportamento normale: raggiunto -> avanza di un passo
  const st = { init: true, marker: "n10", pending: "n20", reached: true };
  check(
    "senza blocco, dopo averlo raggiunto avanza",
    decide(st, { newest: "n30", freeze: false }),
    { marker: "n20", pending: "n30" }
  );
  check(
    "col blocco resta fermo (pending segue la più recente)",
    decide(st, { newest: "n30", freeze: true }),
    { marker: "n10", pending: "n30" }
  );
}
{
  // molti caricamenti di fila col blocco attivo: non si muove mai
  let st = { init: true, marker: "n10", pending: "n20", reached: true };
  for (let i = 1; i <= 5; i++) {
    const out = decide(st, { newest: "n" + (30 + i * 10), freeze: true });
    st = { init: true, marker: out.marker, pending: out.pending, reached: true };
  }
  check("dopo 5 caricamenti il segnalibro è ancora quello", st.marker, "n10");
  check("pending intanto ha seguito le notizie nuove", st.pending, "n80");
  // tolto il blocco, il registro riparte dal pending dell'ultimo caricamento
  check(
    "spento il blocco, riparte di un passo",
    decide(st, { newest: "n90", freeze: false }),
    { marker: "n80", pending: "n90" }
  );
}
{
  // il blocco non tocca gli altri casi
  check(
    "prima volta in assoluto: entrambi sulla più recente",
    decide({ init: false }, { newest: "n30", freeze: true }),
    { marker: "n30", pending: "n30" }
  );
  check(
    "auto-refresh del sito: non si muove niente, pending compreso",
    decide(
      { init: true, marker: "n10", pending: "n20", reached: true },
      { newest: "n30", sameVisit: true, freeze: true }
    ),
    { marker: "n10", pending: "n20" }
  );
  check(
    "senza blocco e senza aver raggiunto: fermo comunque (regola v0.3.1)",
    decide(
      { init: true, marker: "n10", pending: "n20", reached: false },
      { newest: "n30", freeze: false }
    ),
    { marker: "n10", pending: "n30" }
  );
}

// ------------------------------------------------ 4) impostazioni collegate

console.log("\n== 4) l'interruttore è collegato ovunque ==");
{
  const files = {
    "content.js": ["freezeMarker: false", "settings.freezeMarker"],
    "options.js": ["freezeMarker: false", 'freezeMarker: $("opt-freeze").checked', '"opt-freeze"'],
    "options.html": ['id="opt-freeze"'],
    "popup.html": ['id="frozen"'],
    "popup.js": ["status.frozen"],
  };
  for (const f of Object.keys(files)) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    for (const needle of files[f])
      check(f + ' contiene "' + needle + '"', src.indexOf(needle) !== -1, true);
  }
}

console.log(
  "\n" + (failures ? failures + " CONTROLLI FALLITI" : "TUTTI I CONTROLLI OK")
);

// ------------------------------------------------------------------- LIVE

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// hdblog rifiuta l'handshake TLS di Node (ECONNRESET; da browser e PowerShell
// passa, quindi l'estensione non è toccata): fallback via Invoke-WebRequest.
async function get(url) {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA } });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.text();
  } catch (e) {
    const tmp = path.join(os.tmpdir(), "hdblog-arch-" + process.pid + ".html");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
          "(Invoke-WebRequest -Uri '" +
          url +
          "' -UserAgent '" +
          UA +
          "' -UseBasicParsing).Content | Out-File -Encoding utf8 '" +
          tmp +
          "'",
      ],
      { stdio: "pipe" }
    );
    const html = fs.readFileSync(tmp, "utf8");
    fs.unlinkSync(tmp);
    return html;
  }
}

// stessa estrazione dei content script ridotta a regex: solo i link
// a.title_new DENTRO i blocchi <article class="newlist_normal">.
function extractKeys(html) {
  const keys = [];
  const seen = new Set();
  const artRe = /<article class="newlist_normal">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = artRe.exec(html))) {
    const tag = m[1].match(/<a\b[^>]*class="title_new"[^>]*>/);
    const link = tag && tag[0].match(/href="([^"]+)"/);
    if (!link) continue;
    const idm = link[1].match(/\/n(\d+)\//);
    if (!idm || seen.has(idm[1])) continue;
    seen.add(idm[1]);
    keys.push("n" + idm[1]);
  }
  return keys;
}

(async () => {
  console.log("\n== LIVE: il muro del feed di hdblog ==");
  try {
    const home = extractKeys(await get("https://www.hdblog.it/"));
    console.log("  home: " + home.length + " notizie server-rendered");

    const seen = new Set(home);
    let wall = null;
    let total = home.length;
    for (let p = 3; p <= 12; p++) {
      const keys = extractKeys(await get(countUrlFor(hdblog, p)));
      if (!keys.length) {
        wall = p;
        break;
      }
      for (const k of keys)
        if (!seen.has(k)) {
          seen.add(k);
          total++;
        }
    }
    check("l'ajax del lazy-load si ferma a pagina 10", wall, 11);
    console.log("  raggiungibile scrollando: ~" + total + " notizie");
    check("il muro sta intorno alle 90-100 notizie", total >= 80 && total <= 110, true);

    // Le pagine navigabili non sono scaricabili da qui: è il motivo per cui la
    // ricerca ci NAVIGA invece di scaricarle (una navigazione vera del browser
    // passa; fetch, PowerShell e Node prendono 429).
    let deep;
    try {
      const keys = extractKeys(await get(archiveUrlFor(hdblog, 2)));
      deep = keys.length + " notizie (scaricabile)";
    } catch (e) {
      deep = "non scaricabile fuori dal browser (429) — per questo si naviga";
    }
    console.log("  /page/2/ -> " + deep);
  } catch (e) {
    console.error("  check live saltato:", e.message);
  }
  if (failures) process.exit(1);
})();

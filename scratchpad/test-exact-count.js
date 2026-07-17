/*
 * Verifica del CONTEGGIO ESATTO dall'archivio (v0.3.3, content.js):
 *   1) logica di countUnreadInArchive (replicata qui): posizione del marker
 *      nella sequenza delle pagine archivio, dedup tra pagine sovrapposte,
 *      tetto pagine (exact=false), pagina vuota -> null;
 *   2) formatUnread (sites.js): esatto vs limite inferiore "N+" (42 -> "40+");
 *   3) check LIVE su hwupgrade: l'indice di una notizia nella home coincide con
 *      il conteggio fatto sfogliando l'archivio (stessa sequenza, home = prefisso).
 *
 * Uso: node scratchpad/test-exact-count.js
 */

const assert = require("assert");

// ---- repliche delle funzioni (stessa logica di content.js / sites.js) ----

// countUnreadInArchive, con le pagine già ridotte ad array di chiavi.
function countFromPages(pages, markerKey, maxPages) {
  const seen = new Set();
  let count = 0;
  for (let p = 0; p < Math.min(pages.length, maxPages); p++) {
    const articles = pages[p];
    if (!articles.length) return null;
    for (const key of articles) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (key === markerKey) return { count: count, exact: true };
      count++;
    }
  }
  return { count: count, exact: false };
}

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

// ---- 1) conteggio ----

// marker nella prima pagina
assert.deepStrictEqual(
  countFromPages([["a", "b", "c", "M", "d"]], "M", 5),
  { count: 3, exact: true },
  "marker in pagina 1: count = indice"
);

// marker in pagina 2, con sovrapposizione (il feed è scorso tra un fetch e
// l'altro: "d" ed "e" compaiono in fondo a p1 E in cima a p2) -> niente doppioni
assert.deepStrictEqual(
  countFromPages(
    [
      ["a", "b", "c", "d", "e"],
      ["d", "e", "f", "M", "g"],
    ],
    "M",
    5
  ),
  { count: 6, exact: true },
  "sovrapposizione tra pagine dedupata"
);

// marker mai trovato entro il tetto -> limite inferiore
assert.deepStrictEqual(
  countFromPages(
    [
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ],
    "M",
    2
  ),
  { count: 4, exact: false },
  "oltre il tetto: count = notizie viste, exact = false"
);

// pagina vuota (markup cambiato / fine archivio) -> null (nessun numero)
assert.strictEqual(
  countFromPages([["a", "b"], []], "M", 5),
  null,
  "pagina senza notizie: conteggio annullato"
);

// marker = prima notizia -> 0 non lette
assert.deepStrictEqual(
  countFromPages([["M", "a"]], "M", 5),
  { count: 0, exact: true },
  "marker in cima: zero non lette"
);

console.log("OK conteggio (indice, dedup, tetto, pagina vuota)");

// ---- 2) formato ----

assert.strictEqual(formatUnread(0, false), "0");
assert.strictEqual(formatUnread(57, false), "57");
assert.strictEqual(formatUnread(99, false), "99");
assert.strictEqual(formatUnread(150, false), "99+", "esatto oltre 99: 99+");
assert.strictEqual(formatUnread(42, true), "40+", "limite inferiore: decina in giu'");
assert.strictEqual(formatUnread(40, true), "40+");
assert.strictEqual(formatUnread(7, true), "7+", "sotto 10 resta il numero");
assert.strictEqual(formatUnread(150, true), "150+");
assert.strictEqual(formatUnread(5000, true), "990+", "tetto larghezza badge");

console.log("OK formatUnread (esatto / N+)");

// ---- 3) check live su hwupgrade ----

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Stessa estrazione dei content script ridotta a regex: dentro #news-container,
// per ogni li.news-item il primo href con l'id numerico prima di ".html".
function extractKeys(html) {
  const start = html.indexOf("news-container");
  const scope = start >= 0 ? html.slice(start) : html;
  const chunks = scope.split(/class="news-item"/).slice(1);
  const keys = [];
  const seen = new Set();
  for (const c of chunks) {
    const m = c.match(/href="[^"]*_(\d+)\.html"/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    keys.push(m[1]);
  }
  return keys;
}

async function get(url) {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " su " + url);
  return resp.text();
}

(async () => {
  try {
    const home = extractKeys(await get("https://www.hwupgrade.it/"));
    const pages = [];
    for (let p = 1; p <= 3; p++) {
      const url =
        "https://www.hwupgrade.it/news/index" + (p > 1 ? p : "") + ".html";
      pages.push(extractKeys(await get(url)));
    }

    console.log(
      "home: " + home.length + " notizie; archivio p1/p2/p3: " +
        pages.map((p) => p.length).join("/")
    );
    assert.ok(home.length >= 30, "home: attese ~42 notizie");
    assert.ok(pages[0].length >= 20, "archivio p1: attese ~30 notizie");

    // La sequenza dell'archivio deve ricalcare quella della home: una notizia a
    // meta' home deve trovarsi nell'archivio con lo STESSO numero di notizie
    // sopra (tolleranza minima: puo' uscire una notizia tra un fetch e l'altro).
    const idx = Math.min(20, home.length - 1);
    const marker = home[idx];
    const res = countFromPages(pages, marker, 5);
    assert.ok(res && res.exact, "marker della home trovato nell'archivio");
    assert.ok(
      Math.abs(res.count - idx) <= 3,
      "conteggio archivio (" + res.count + ") ~= indice home (" + idx + ")"
    );
    console.log(
      "OK live: home[" + idx + "] trovata nell'archivio con " +
        res.count + " notizie sopra (exact)"
    );

    // Ultima notizia della home: deve stare entro le prime pagine dell'archivio.
    const last = countFromPages(pages, home[home.length - 1], 5);
    assert.ok(last && last.exact, "ultima della home presente in p1..p3");
    console.log(
      "OK live: ultima della home a posizione " + last.count + " nell'archivio"
    );

    console.log("\nTUTTO OK");
  } catch (e) {
    console.error("FALLITO check live:", e.message);
    process.exit(1);
  }
})();

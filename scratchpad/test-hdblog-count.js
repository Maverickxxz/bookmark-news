/*
 * Verifica del CONTEGGIO ESATTO su HDblog (v0.3.4):
 *   1) archiveUrlFor generalizzata: urlTemplate con {n} (hdblog, endpoint ajax
 *      numerato da 1) accanto al formato urlBase+N+".html" (hwupgrade);
 *   2) check LIVE: l'endpoint ajax del lazy-load della home
 *      (/new_files/ajax/pages.php?page=N) ricalca la sequenza della home
 *      (home = prefisso di p1+p2+p3): contare lì la posizione del marker
 *      dà il numero VERO di non lette (stessa proprietà dell'archivio
 *      hwupgrade verificata in test-exact-count.js).
 *
 * Uso: node scratchpad/test-hdblog-count.js
 */

const assert = require("assert");

// ---- 1) archiveUrlFor (replica di content.js) ----

function archiveUrlForOf(archive) {
  return (page) => {
    if (archive.urlTemplate)
      return archive.urlTemplate.replace("{n}", String(page));
    return archive.urlBase + (page > 1 ? String(page) : "") + ".html";
  };
}

const hdblogUrl = archiveUrlForOf({
  urlTemplate: "https://www.hdblog.it/new_files/ajax/pages.php?page={n}",
});
assert.strictEqual(
  hdblogUrl(1),
  "https://www.hdblog.it/new_files/ajax/pages.php?page=1",
  "template: pagina 1 numerata"
);
assert.strictEqual(
  hdblogUrl(7),
  "https://www.hdblog.it/new_files/ajax/pages.php?page=7"
);

const hwuUrl = archiveUrlForOf({
  urlBase: "https://www.hwupgrade.it/news/index",
});
assert.strictEqual(
  hwuUrl(1),
  "https://www.hwupgrade.it/news/index.html",
  "formato storico: pagina 1 senza numero"
);
assert.strictEqual(hwuUrl(3), "https://www.hwupgrade.it/news/index3.html");

console.log("OK archiveUrlFor (urlTemplate {n} + formato urlBase)");

// ---- 2) check live su hdblog ----

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Stessa estrazione dei content script ridotta a regex: SOLO i link
// a.title_new DENTRO i blocchi <article class="newlist_normal"> (il widget
// "Le Ultime Guide" usa a.title_new ma non è nel feed: va ignorato).
function extractKeys(html) {
  const keys = [];
  const seen = new Set();
  const artRe = /<article class="newlist_normal">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = artRe.exec(html))) {
    const link = m[1].match(/<a\s+href="([^"]+)"\s+class="title_new"/);
    if (!link) continue;
    const idm = link[1].match(/\/n(\d+)\//);
    if (!idm || seen.has(idm[1])) continue;
    seen.add(idm[1]);
    keys.push("n" + idm[1]);
  }
  return keys;
}

// hdblog RIFIUTA l'handshake TLS di Node (fingerprint: ECONNRESET prima della
// connessione; da browser e PowerShell passa, quindi l'estensione non è
// toccata): fallback via Invoke-WebRequest.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function get(url) {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA } });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " su " + url);
    return await resp.text();
  } catch (e) {
    const tmp = path.join(os.tmpdir(), "hdblog-test-" + process.pid + ".html");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        // Windows PowerShell senza profilo parte con TLS 1.0: hdblog vuole 1.2+.
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
          "(Invoke-WebRequest -Uri '" + url + "' -UserAgent '" + UA +
          "' -UseBasicParsing).Content | Out-File -Encoding utf8 '" + tmp + "'",
      ],
      { stdio: "pipe" }
    );
    const html = fs.readFileSync(tmp, "utf8");
    fs.unlinkSync(tmp);
    return html;
  }
}

(async () => {
  try {
    // Home per prima: se esce una notizia tra un fetch e l'altro comparirà
    // in cima all'ajax e va assorbita come offset, non come divergenza.
    const home = extractKeys(await get("https://www.hdblog.it/"));
    const seq = [];
    const seen = new Set();
    const sizes = [];
    for (let p = 1; p <= 3; p++) {
      const keys = extractKeys(await get(hdblogUrl(p)));
      sizes.push(keys.length);
      for (const k of keys) {
        if (seen.has(k)) continue;
        seen.add(k);
        seq.push(k);
      }
    }

    console.log(
      "home: " + home.length + " notizie; ajax p1/p2/p3: " + sizes.join("/")
    );
    assert.ok(home.length >= 12, "home: attese ~19 notizie");
    assert.ok(sizes[0] >= 5, "ajax p1: attese ~9-10 notizie");

    // home = prefisso della sequenza ajax, al più spostato di qualche notizia
    // uscita tra i due fetch.
    const offset = seq.indexOf(home[0]);
    assert.ok(
      offset >= 0 && offset <= 3,
      "prima della home trovata in cima all'ajax (offset " + offset + ")"
    );
    const n = Math.min(home.length, seq.length - offset);
    for (let i = 0; i < n; i++) {
      assert.strictEqual(
        home[i],
        seq[i + offset],
        "sequenza divergente a indice " + i
      );
    }
    console.log(
      "OK live: home = prefisso della sequenza ajax (" +
        n + " voci confrontate, offset " + offset + ")"
    );

    console.log("\nTUTTO OK");
  } catch (e) {
    console.error("FALLITO check live:", e.message);
    process.exit(1);
  }
})();

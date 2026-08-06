/*
 * DIAGNOSTICA (non un test): le notizie duplicate su hdblog.
 * Scarica la home e le pagine ajax del lazy-load SENZA deduplicare, per
 * capire DOVE nascono i doppioni segnalati dall'utente:
 *   - dentro la singola pagina (home o pagina ajax)?
 *   - tra pagine ajax contigue (paginazione a offset che scorre)?
 *   - tra home e pagine ajax?
 *
 * Uso: node scratchpad/diag-hdblog-dup.js [numPagine]
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PAGES = parseInt(process.argv[2] || "6", 10);

// Estrazione RAW: nessun dedup, così i doppioni restano visibili.
// Come i content script: solo i link a.title_new dentro <article class="newlist_normal">.
function extractRaw(html) {
  const out = [];
  const artRe = /<article class="newlist_normal">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = artRe.exec(html))) {
    const link = m[1].match(/<a\s+href="([^"]+)"\s+class="title_new"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const idm = link[1].match(/\/n(\d+)\//);
    if (!idm) continue;
    out.push({
      key: "n" + idm[1],
      href: link[1],
      title: link[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

async function get(url) {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA } });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.text();
  } catch (e) {
    const tmp = path.join(os.tmpdir(), "hdblog-diag-" + process.pid + ".html");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
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

function dupsWithin(list) {
  const cnt = new Map();
  list.forEach((a) => cnt.set(a.key, (cnt.get(a.key) || 0) + 1));
  return [...cnt.entries()].filter(([, n]) => n > 1);
}

(async () => {
  const home = extractRaw(await get("https://www.hdblog.it/"));
  console.log("HOME: " + home.length + " notizie (raw)");
  const hd = dupsWithin(home);
  console.log(
    hd.length
      ? "  ⚠ DOPPIONI nella home: " + hd.map((d) => d[0] + " x" + d[1]).join(", ")
      : "  nessun doppione dentro la home"
  );
  home.slice(0, 5).forEach((a, i) => console.log("   " + i + "  " + a.key + "  " + a.title.slice(0, 60)));

  const pages = [];
  for (let p = 1; p <= PAGES; p++) {
    const list = extractRaw(
      await get("https://www.hdblog.it/new_files/ajax/pages.php?page=" + p)
    );
    pages.push(list);
    const d = dupsWithin(list);
    console.log(
      "\nAJAX p" + p + ": " + list.length + " notizie" +
        (d.length ? "  ⚠ doppioni interni: " + d.map((x) => x[0] + " x" + x[1]).join(", ") : "")
    );
    console.log(
      "   " + list.map((a) => a.key).join(" ")
    );
  }

  // sovrapposizioni tra pagine contigue
  console.log("\n--- sovrapposizioni tra pagine ajax ---");
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = new Set(pages[i].map((x) => x.key));
    const shared = pages[i + 1].filter((x) => a.has(x.key)).map((x) => x.key);
    console.log(
      "p" + (i + 1) + " ∩ p" + (i + 2) + ": " +
        (shared.length ? shared.length + " -> " + shared.join(" ") : "0")
    );
  }

  // sovrapposizione home <-> ajax
  const homeSet = new Set(home.map((x) => x.key));
  console.log("\n--- home ∩ ajax ---");
  pages.forEach((list, i) => {
    const shared = list.filter((x) => homeSet.has(x.key)).map((x) => x.key);
    console.log("home ∩ p" + (i + 1) + ": " + shared.length + (shared.length ? " -> " + shared.join(" ") : ""));
  });

  // sequenza globale come la vedrebbe il browser scrollando (home + p3,p4,...)
  // = quello che l'utente scorre davvero: la home carica p1-p2 server-side,
  // il lazy-load parte da p3.
  const asBrowser = home.concat(...pages.slice(2).map((p) => p));
  console.log(
    "\n--- come lo vede l'utente scrollando (home + ajax p3..p" + PAGES + ") ---"
  );
  console.log("totale elementi: " + asBrowser.length);
  const dd = dupsWithin(asBrowser);
  console.log(
    dd.length
      ? "⚠ DOPPIONI VISIBILI: " + dd.length + " notizie ripetute -> " +
          dd.map((d) => d[0] + " x" + d[1]).join(", ")
      : "nessun doppione visibile"
  );
  const distinct = new Set(asBrowser.map((a) => a.key)).size;
  console.log(
    "distinti: " + distinct + "  ·  ripetizioni in eccesso: " +
      (asBrowser.length - distinct)
  );
})().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});

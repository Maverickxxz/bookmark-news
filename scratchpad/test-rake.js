/*
 * Verifica di keyphrasesRake (approccio 3, RAKE) + IT_GENERIC (approccio 2) e della
 * composizione finale con i tag veri (1) e i token forti. Replica fedelmente le
 * funzioni da content.js. Obiettivi:
 *   - le parole di contenuto contigue formano FRASI ("intelligenza artificiale");
 *   - la punteggiatura è un confine di frase (niente "galaxy intelligenza");
 *   - le parole generiche (prezzo, recensione…) NON diventano keyword da sole;
 *   - regressione: "Agentic AI" -> {agentic (rake), ai (forte)}.
 */

// --- stopword/verbi minimali (solo ciò che serve ai test) ---
const STOP = new Set(
  ("di a da in con su per tra fra e ed o od il lo la i gli le un uno una del della " +
   "che chi cui non come quando questo quello nuovo nuova nuovi nuove primo ultima " +
   "sul sui dal al del e vola vale").split(" ")
);
function deaccent(s) {
  return String(s)
    .replace(/[àáâã]/g, "a").replace(/[èéê]/g, "e").replace(/[ìíî]/g, "i")
    .replace(/[òóôõ]/g, "o").replace(/[ùúû]/g, "u").replace(/ç/g, "c");
}
function isStop(w) { return STOP.has(deaccent(String(w).toLowerCase())); }
let IGNORED = new Set();
function isIgnored(w) { return IGNORED.has(deaccent(String(w).toLowerCase().trim())); }
function addKw(set, raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t.length >= 2 && t.length <= 40 && !/^\d+$/.test(t) && !isStop(t) && !isIgnored(t))
    set.add(t);
}

// --- IT_GENERIC (sottoinsieme sufficiente per i test) ---
const IT_GENERIC = new Set(
  ("prezzo prezzi offerta offerte sconto sconti recensione recensioni prova uscita arrivo " +
   "modello versione oggi mercato smartphone prodotto guida migliore migliori top super mega").split(" ")
);
function isGeneric(w) { return IT_GENERIC.has(deaccent(String(w).toLowerCase())); }

// --- copia fedele: keyphrasesRake ---
function keyphrasesRake(text, maxWords, topN) {
  maxWords = maxWords || 3;
  topN = topN || 8;
  const phrases = [];
  let cur = [];
  const flush = () => { if (cur.length) phrases.push(cur); cur = []; };
  String(text || "")
    .toLowerCase()
    .split(/[^a-zà-ù0-9\s]+/)
    .forEach((chunk) => {
      chunk.split(/\s+/).forEach((w) => {
        const isDelim =
          !w || w.length < 4 || /^\d+$/.test(w) ||
          isStop(w) || isGeneric(w) || isIgnored(w);
        if (isDelim) { flush(); return; }
        cur.push(w);
        if (cur.length >= maxWords) flush();
      });
      flush();
    });
  if (!phrases.length) return [];
  const freq = new Map(), deg = new Map();
  for (const p of phrases) for (const w of p) {
    freq.set(w, (freq.get(w) || 0) + 1);
    deg.set(w, (deg.get(w) || 0) + p.length);
  }
  const scored = [], seen = new Set();
  for (const p of phrases) {
    const kw = p.join(" ");
    if (seen.has(kw)) continue;
    seen.add(kw);
    let s = 0;
    for (const w of p) s += deg.get(w) / freq.get(w);
    scored.push({ kw, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, topN).map((x) => x.kw);
}

// --- token forti (per la composizione) ---
function isStrongToken(tok, shouty) {
  if (tok.length < 2 || tok.length > 12) return false;
  if (/^\d+$/.test(tok)) return false;
  if (!/[a-zà-ù]/i.test(tok)) return false;
  if (/\d/.test(tok)) return true;
  if (shouty) return false;
  if (/^[A-ZÀ-Ù]{2,6}$/.test(tok)) return tok.length <= 3 ? true : !isStop(tok);
  return false;
}
function extractStrongTokens(text) {
  const s = String(text || "");
  const upper = (s.match(/[A-ZÀ-Ù]/g) || []).length;
  const lower = (s.match(/[a-zà-ù]/g) || []).length;
  const shouty = upper > lower;
  const out = new Set();
  s.split(/[^0-9A-Za-zÀ-ù]+/).forEach((tok) => {
    if (tok && isStrongToken(tok, shouty)) {
      const t = tok.toLowerCase();
      if (!isIgnored(t)) out.add(t);
    }
  });
  return out;
}
function extractKeywords(realTags, title) {
  const set = new Set();
  (realTags || []).forEach((t) => addKw(set, t));
  const hadRealTags = set.size > 0;
  if (!hadRealTags) keyphrasesRake(title).forEach((w) => set.add(w));
  extractStrongTokens(title).forEach((w) => set.add(w));
  return Array.from(set).slice(0, 15);
}

// --- helper ---
let pass = 0, fail = 0;
function has(arr, w) { return arr.indexOf(w) !== -1; }
function checkRake(title, mustHave, mustNot) {
  const got = keyphrasesRake(title);
  console.log(`\nRAKE "${title}"\n  -> [${got.join(" | ")}]`);
  (mustHave || []).forEach((w) => {
    if (has(got, w)) { pass++; console.log(`  ok   - frase "${w}"`); }
    else { fail++; console.log(`  FAIL - manca frase "${w}"`); }
  });
  (mustNot || []).forEach((w) => {
    if (!has(got, w)) { pass++; console.log(`  ok   - NON "${w}"`); }
    else { fail++; console.log(`  FAIL - presente "${w}"`); }
  });
}
function checkAll(name, tags, title, mustHave, mustNot) {
  const got = extractKeywords(tags, title);
  console.log(`\nFULL ${name}\n  tag=[${(tags||[]).join(", ")}] h1="${title}"\n  -> {${got.join(", ")}}`);
  (mustHave || []).forEach((w) => {
    if (has(got, w)) { pass++; console.log(`  ok   - "${w}"`); }
    else { fail++; console.log(`  FAIL - manca "${w}"`); }
  });
  (mustNot || []).forEach((w) => {
    if (!has(got, w)) { pass++; console.log(`  ok   - NON "${w}"`); }
    else { fail++; console.log(`  FAIL - "${w}" presente`); }
  });
}

// 1) frasi multi-parola tenute unite; punteggiatura = confine
checkRake(
  "Recensione del nuovo Galaxy: intelligenza artificiale e auto elettrica",
  ["intelligenza artificiale", "auto elettrica", "galaxy"],
  ["recensione", "galaxy intelligenza", "recensione galaxy"]
);

// 2) generico da solo non passa; entità sì
checkRake(
  "Offerte Amazon di primavera sul nuovo tablet",
  ["amazon", "primavera", "tablet"],
  ["offerte", "sul"]
);

// 3) titolo tutto generico/stopword -> nessuna keyphrase
checkRake("Le migliori offerte e sconti di oggi", [], ["offerte", "sconti", "oggi"]);

// 4) COMPOSIZIONE: Agentic AI (nessun tag) -> agentic (rake) + ai (forte)
checkAll("Agentic AI", [], "Cos'è l'Agentic AI?", ["agentic", "ai"], ["cos"]);

// 5) COMPOSIZIONE: con tag veri il RAKE non gira, ma la sigla forte sì
checkAll("PS5", ["ebay", "risparmi"],
  "PS5 Slim Digital: oggi su eBay risparmi 100€ sul prezzo di listino",
  ["ebay", "risparmi", "ps5"], ["slim digital", "digital", "prezzo"]);

// 6) parola ignorata dall'utente diventa delimitatore
IGNORED = new Set(["intelligenza"]);
checkRake("La nuova intelligenza artificiale di Google",
  ["artificiale", "google"], ["intelligenza artificiale", "intelligenza"]);
IGNORED = new Set();

console.log(`\n=== Risultato: ${pass} ok, ${fail} fail ===`);
process.exit(fail ? 1 : 0);

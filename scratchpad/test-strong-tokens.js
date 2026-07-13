/*
 * Verifica dell'estrazione dei token "forti" (acronimi + sigle prodotto) dal titolo,
 * aggiunta in content.js (isStrongToken / extractStrongTokens).
 * Replica fedelmente le funzioni + un isStop/isIgnored minimale.
 */

// --- stopword/isStop minimale (solo le voci che servono ai casi di test) ---
const STOP = new Set(
  "ai oggi solo su di in per non che il la le lo un una e o ed soltanto".split(" ")
);
function deaccent(s) {
  return String(s)
    .replace(/[àáâã]/g, "a").replace(/[èéê]/g, "e").replace(/[ìíî]/g, "i")
    .replace(/[òóôõ]/g, "o").replace(/[ùúû]/g, "u").replace(/ç/g, "c");
}
function isStop(w) {
  return STOP.has(deaccent(String(w).toLowerCase()));
}
let IGNORED = new Set();
function isIgnored(w) {
  return IGNORED.has(deaccent(String(w).toLowerCase().trim()));
}

// --- copia fedele da content.js ---
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

// --- helper test ---
let pass = 0, fail = 0;
function check(title, mustHave, mustNotHave) {
  const got = extractStrongTokens(title);
  const list = "{" + Array.from(got).join(", ") + "}";
  console.log(`\n"${title}"\n  -> ${list}`);
  (mustHave || []).forEach((w) => {
    if (got.has(w)) { pass++; console.log(`  ok   - contiene "${w}"`); }
    else { fail++; console.log(`  FAIL - manca "${w}"`); }
  });
  (mustNotHave || []).forEach((w) => {
    if (!got.has(w)) { pass++; console.log(`  ok   - NON contiene "${w}"`); }
    else { fail++; console.log(`  FAIL - contiene "${w}" (non dovrebbe)`); }
  });
}

// I due titoli dell'utente
check(
  "Cos'è l'Agentic AI? Definizione, Funzionamento ed Esempi",
  ["ai"],
  ["cos", "agentic", "definizione", "funzionamento", "esempi", "ed"]
);
check(
  "PS5 Slim Digital: oggi su eBay risparmi 100€ sul prezzo di listino",
  ["ps5"],
  ["slim", "digital", "ebay", "risparmi", "oggi", "100", "prezzo"]
);

// Altri acronimi/sigle utili
check("Nuova GPU con 32GB di VRAM e supporto USB4", ["gpu", "32gb", "usb4", "vram"], ["nuova", "con", "supporto"]);
check("Recensione Galaxy S24 Ultra: il 5G vola", ["s24", "5g"], ["galaxy", "ultra", "il", "vola"]);
check("Il nuovo iPhone monta chip a 3nm", ["3nm"], ["iphone", "nuovo", "chip"]);

// Guardia anti-rumore: titolo GRIDATO (tutto maiuscolo) non deve sfornare stopword
check("OGGI SOLO SU EBAY: SUPER SCONTO", [], ["oggi", "solo", "su", "ebay", "super", "sconto"]);

// "ai" minuscolo (preposizione) NON deve entrare
check("Andiamo ai negozi per lo sconto", [], ["ai", "negozi", "sconto"]);

// numeri puri e valute fuori
check("Sconto di 100€ e 2024 nuovi modelli", [], ["100", "2024"]);

// parola ignorata dall'utente
IGNORED = new Set(["ps5"]);
check("PS5 Pro in arrivo", [], ["ps5"]);
IGNORED = new Set();

console.log(`\n=== Risultato: ${pass} ok, ${fail} fail ===`);
process.exit(fail ? 1 : 0);

/*
 * Verifica dell'anti-doppioni in background.js: un articolo si registra UNA volta
 * sola (per sito+chiave), riaprirlo NON crea doppioni né gonfia i conteggi; e la
 * migrazione dedupeInterests ripulisce i dati già sporchi ricostruendo gli aggregati.
 * Replica fedelmente doTrack e dedupeInterests (storage simulato in memoria).
 */

// --- storage simulato ---
let STORE = {};
function getLocal(keys) {
  const out = {};
  const list = Array.isArray(keys) ? keys : [keys];
  list.forEach((k) => (out[k] = STORE[k]));
  return Promise.resolve(out);
}
function setLocal(o) {
  Object.assign(STORE, o);
  return Promise.resolve();
}

// --- copie fedeli da background.js ---
function entryId(e) {
  return (e && e.s ? e.s : "") + "|" + (e && e.k ? e.k : "");
}
async function doTrack(entry) {
  if (!entry || !entry.k) return;
  const data = await getLocal("interests");
  const interests =
    data.interests || { categories: {}, keywords: {}, opened: [], totalOpened: 0 };
  const id = entryId(entry);
  const existing = interests.opened.find((e) => entryId(e) === id);
  if (existing) {
    if ((entry.ts || 0) > (existing.ts || 0)) existing.ts = entry.ts;
    await setLocal({ interests });
    return;
  }
  if (entry.c) {
    const c = String(entry.c).toLowerCase();
    interests.categories[c] = (interests.categories[c] || 0) + 1;
  }
  (entry.kw || []).forEach((k) => { interests.keywords[k] = (interests.keywords[k] || 0) + 1; });
  interests.opened.push(entry);
  if (interests.opened.length > 1000) interests.opened = interests.opened.slice(-1000);
  interests.totalOpened = (interests.totalOpened || 0) + 1;
  await setLocal({ interests });
}
async function dedupeInterests() {
  const data = await getLocal("interests");
  const it = data.interests;
  if (!it || !Array.isArray(it.opened)) return;
  const byId = new Map();
  for (const e of it.opened) {
    if (!e || !e.k) continue;
    const id = entryId(e);
    const prev = byId.get(id);
    if (!prev || (e.ts || 0) > (prev.ts || 0)) byId.set(id, e);
  }
  const deduped = Array.from(byId.values());
  if (deduped.length === it.opened.length) return;
  const categories = {}, keywords = {};
  for (const e of deduped) {
    if (e.c) { const c = String(e.c).toLowerCase(); categories[c] = (categories[c] || 0) + 1; }
    (e.kw || []).forEach((k) => { keywords[k] = (keywords[k] || 0) + 1; });
  }
  it.opened = deduped;
  it.categories = categories;
  it.keywords = keywords;
  it.totalOpened = deduped.length;
  await setLocal({ interests: it });
}

// --- helper ---
let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   - ${msg}`); }
  else { fail++; console.log(`  FAIL - ${msg}\n           atteso ${e}\n           ottenuto ${a}`); }
}
const A = (ts) => ({ k: "n100", s: "hdblog", c: "Tech", kw: ["ai", "agentic"], t: "Art A", ts });
const B = (ts) => ({ k: "n200", s: "hdblog", c: "Auto", kw: ["ps5"], t: "Art B", ts });

// =========================================================================
(async () => {
  console.log("Scenario 1: A, B, A (riapertura dopo aver visto B) — niente doppioni\n");
  STORE = {};
  await doTrack(A(1000));
  await doTrack(B(2000));
  await doTrack(A(3000)); // riapertura di A, prima creava un doppione
  let it = STORE.interests;
  eq(it.opened.length, 2, "2 articoli unici nella lista (non 3)");
  eq(it.totalOpened, 2, "totalOpened = 2");
  eq(it.keywords, { ai: 1, agentic: 1, ps5: 1 }, "parole chiave contate UNA volta");
  eq(it.categories, { tech: 1, auto: 1 }, "categorie contate una volta");
  const a = it.opened.find((e) => e.k === "n100");
  eq(a.ts, 3000, "l'orario di A è aggiornato all'ultima apertura (3000)");

  console.log("\nScenario 2: stessa notizia aperta 5 volte di fila\n");
  STORE = {};
  for (let i = 1; i <= 5; i++) await doTrack(A(i * 1000));
  it = STORE.interests;
  eq(it.opened.length, 1, "1 solo articolo");
  eq(it.keywords, { ai: 1, agentic: 1 }, "parole chiave non gonfiate");

  console.log("\nScenario 3: migrazione di dati GIÀ sporchi (doppioni preesistenti)\n");
  // Simula lo stato prodotto dal vecchio codice: A due volte, B una volta,
  // con aggregati gonfiati (ai/agentic=2 perché A contato due volte).
  STORE = {
    interests: {
      categories: { tech: 2, auto: 1 },
      keywords: { ai: 2, agentic: 2, ps5: 1 },
      opened: [A(1000), B(2000), A(3000)],
      totalOpened: 3,
    },
  };
  await dedupeInterests();
  it = STORE.interests;
  eq(it.opened.length, 2, "doppione rimosso: 2 articoli");
  eq(it.totalOpened, 2, "totalOpened corretto a 2");
  eq(it.keywords, { ai: 1, agentic: 1, ps5: 1 }, "conteggi parole chiave ricostruiti");
  eq(it.categories, { tech: 1, auto: 1 }, "conteggi categorie ricostruiti");
  eq(it.opened.find((e) => e.k === "n100").ts, 3000, "tenuta l'apertura più recente di A");

  console.log("\nScenario 4: migrazione idempotente su dati PULITI (non tocca nulla)\n");
  const before = JSON.stringify(STORE.interests);
  await dedupeInterests();
  eq(JSON.stringify(STORE.interests), before, "seconda migrazione = nessuna modifica");

  console.log(`\n=== Risultato: ${pass} ok, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();

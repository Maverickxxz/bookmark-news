/* Service worker:
   - aggiorna il badge dell'icona con il numero di notizie non lette;
   - scrive il tracciamento interessi in modo SERIALIZZATO (evita perdite quando
     si aprono più articoli in schede diverse contemporaneamente). */

function getLocal(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}
function setLocal(o) {
  return new Promise((r) => chrome.storage.local.set(o, r));
}

// Coda per serializzare le scritture del tracciamento.
let trackChain = Promise.resolve();

// Identità stabile di un articolo nella lista: sito + chiave.
function entryId(e) {
  return (e && e.s ? e.s : "") + "|" + (e && e.k ? e.k : "");
}

async function doTrack(entry) {
  if (!entry || !entry.k) return;
  const data = await getLocal("interests");
  const interests =
    data.interests || {
      categories: {},
      keywords: {},
      opened: [],
      totalOpened: 0,
    };

  // Anti-doppioni: ogni articolo si registra UNA sola volta (per chiave stabile del
  // sito). Se è già stato aperto, aggiorniamo solo l'orario di "ultima apertura"
  // SENZA ricontare categoria/parole chiave — altrimenti riaprendo la stessa notizia
  // la lista mostrerebbe doppioni e i conteggi si gonfierebbero.
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
  (entry.kw || []).forEach((k) => {
    interests.keywords[k] = (interests.keywords[k] || 0) + 1;
  });
  interests.opened.push(entry);
  if (interests.opened.length > 1000)
    interests.opened = interests.opened.slice(-1000);
  interests.totalOpened = (interests.totalOpened || 0) + 1;

  await setLocal({ interests });
}

// Migrazione una-tantum: ripulisce i doppioni già salvati (dai vecchi 30 min di
// dedup) tenendo l'apertura più recente di ciascun articolo, e RICOSTRUISCE gli
// aggregati (categorie/parole chiave/totale) dalla lista deduplicata così i conteggi
// tornano coerenti con gli articoli mostrati. Idempotente: se non ci sono doppioni,
// non tocca nulla (preserva eventuali conteggi storici oltre il tetto dei 1000).
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
  if (deduped.length === it.opened.length) return; // nessun doppione: niente da fare

  const categories = {};
  const keywords = {};
  for (const e of deduped) {
    if (e.c) {
      const c = String(e.c).toLowerCase();
      categories[c] = (categories[c] || 0) + 1;
    }
    (e.kw || []).forEach((k) => {
      keywords[k] = (keywords[k] || 0) + 1;
    });
  }
  it.opened = deduped;
  it.categories = categories;
  it.keywords = keywords;
  it.totalOpened = deduped.length;
  await setLocal({ interests: it });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;

  if (msg.type === "setBadge" && sender.tab) {
    const tabId = sender.tab.id;
    const count = msg.count | 0;
    // approx = limite inferiore (segnalibro oltre il feed caricato o oltre il
    // tetto delle pagine archivio): decina in giù + "+", es. 42 -> "40+".
    // Stessa logica di formatUnread in sites.js (il SW non carica sites.js).
    let text = "";
    if (count > 0) {
      if (msg.approx) {
        const base = Math.floor(count / 10) * 10;
        text = (base < 10 ? count : Math.min(990, base)) + "+";
      } else {
        text = count > 99 ? "99+" : String(count);
      }
    }
    try {
      chrome.action.setBadgeBackgroundColor({
        color: msg.color || "#df151c",
        tabId,
      });
      chrome.action.setBadgeText({ text, tabId });
    } catch (e) {}
    return;
  }

  if (msg.type === "trackArticle" && msg.entry) {
    trackChain = trackChain.then(() => doTrack(msg.entry)).catch(() => {});
    return;
  }
});

// Ripulitura doppioni: all'installazione/aggiornamento e a ogni avvio del service
// worker (serializzata con le scritture). È idempotente, quindi gira senza danni.
chrome.runtime.onInstalled.addListener(() => {
  trackChain = trackChain.then(dedupeInterests).catch(() => {});
});
trackChain = trackChain.then(dedupeInterests).catch(() => {});

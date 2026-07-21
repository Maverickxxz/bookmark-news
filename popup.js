/* Popup multi-sito: mostra lo stato del sito attivo e i comandi.
   Usa le funzioni di sites.js (findSiteForUrl / isSiteHome / siteHomeUrl). */

const $ = (id) => document.getElementById(id);

function ask(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(resp);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color || "#df151c");
}

function renderDisabled() {
  $("onhome").classList.add("hidden");
  $("offhome").classList.add("hidden");
  $("disabled").classList.remove("hidden");
  $("head-title").textContent = "Segnalibro notizie";
  setAccent("#8a8a8f");
}

function renderOffHome() {
  $("onhome").classList.add("hidden");
  $("disabled").classList.add("hidden");
  $("offhome").classList.remove("hidden");
  $("head-title").textContent = "Segnalibro notizie";
  setAccent("#8a8a8f");

  const box = $("site-links");
  box.innerHTML = "";
  (self.NEWS_SITES || []).forEach((s) => {
    const a = document.createElement("a");
    a.className = "site-link";
    a.href = siteHomeUrl(s);
    a.target = "_blank";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = s.color || "#df151c";
    a.appendChild(sw);
    a.appendChild(document.createTextNode(s.name));
    box.appendChild(a);
  });
}

function renderOnHome(status, site) {
  $("offhome").classList.add("hidden");
  $("disabled").classList.add("hidden");
  $("onhome").classList.remove("hidden");
  const base = site ? site.name : "Segnalibro notizie";
  // Nell'archivio paginato di un sito (es. hwupgrade /news/indexZ.html) i comandi
  // restano disponibili: lo diciamo nel titolo, perché il conteggio mostrato è
  // quello dell'ultimo caricamento della home.
  $("head-title").textContent = status.archive
    ? base + " · archivio" + (status.archivePage ? " p." + status.archivePage : "")
    : base;
  setAccent(site ? site.color : "#df151c");

  const unread = status.unread | 0;
  // approx = limite inferiore (segnalibro oltre il feed): "40+" invece di "42".
  $("count").textContent = formatUnread(unread, status.approx);
  $("count-label").textContent =
    unread === 1 ? "notizia nuova da leggere" : "notizie nuove da leggere";

  const hasTitle = status.found && status.markerTitle;
  $("marker-info").classList.toggle("hidden", !hasTitle);
  if (hasTitle) $("marker-title").textContent = status.markerTitle;

  const notFound = status.total > 0 && !status.found;
  $("notfound").classList.toggle("hidden", !notFound);
  if (notFound) {
    $("notfound").textContent = status.archive
      ? "L'ultima notizia letta non è in questa pagina dell'archivio. Usa «Vai all'ultima letta» per proseguire la ricerca nelle pagine successive."
      : "L'ultima notizia letta è più in basso, oltre le notizie già caricate. Il segnalibro non si perde: usa «Vai all'ultima letta» per raggiungerla.";
  }
}

let activeTabId = null;
let currentSite = null;

async function boot() {
  const [tab] = await new Promise((res) =>
    chrome.tabs.query({ active: true, currentWindow: true }, res)
  );

  const site = tab ? findSiteForUrl(tab.url || "") : null;

  if (!site) {
    renderOffHome();
    return;
  }

  activeTabId = tab.id;
  currentSite = site;
  // Il content script è presente su tutte le pagine del sito.
  const status = await ask(tab.id, { type: "getStatus" });

  if (status && status.disabled) {
    renderDisabled();
    return;
  }

  // Due stati mostrano i comandi: la home del sito, e le pagine dell'ARCHIVIO
  // paginato (es. hwupgrade /news/indexZ.html), dove il segnalibro si cerca e si
  // può comunque segnare tutto come letto. Sito solo-tracciamento (hdmotori) escluso.
  const onHome = !!(status && status.onHome) && isSiteHome(site, tab.url || "");
  const onArchive = !!(status && status.archive);

  if (
    !status ||
    status.trackingOnly ||
    site.trackingOnly ||
    (!onHome && !onArchive)
  ) {
    renderOffHome();
    return;
  }
  renderOnHome(status, site);
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id === "btn-settings" || t.id === "btn-settings-d") {
    chrome.runtime.openOptionsPage();
    window.close();
    return;
  }
  if (activeTabId == null) return;
  if (t.id === "btn-scroll") {
    await ask(activeTabId, { type: "scrollToMarker" });
    window.close();
  }
  if (t.id === "btn-read") {
    const status = await ask(activeTabId, { type: "markAllRead" });
    if (status) renderOnHome(status, currentSite);
  }
});

boot();

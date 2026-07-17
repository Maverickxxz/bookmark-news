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
  $("head-title").textContent = site ? site.name : "Segnalibro notizie";
  setAccent(site ? site.color : "#df151c");

  const unread = status.unread | 0;
  // approx = limite inferiore (segnalibro oltre il feed): "40+" invece di "42".
  $("count").textContent = formatUnread(unread, !status.found && status.approx);
  $("count-label").textContent =
    unread === 1 ? "notizia nuova da leggere" : "notizie nuove da leggere";

  const hasTitle = status.found && status.markerTitle;
  $("marker-info").classList.toggle("hidden", !hasTitle);
  if (hasTitle) $("marker-title").textContent = status.markerTitle;

  const notFound = status.total > 0 && !status.found;
  $("notfound").classList.toggle("hidden", !notFound);
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

  // Sito solo-tracciamento (es. hdmotori): niente segnalibro da mostrare.
  if (
    (status && status.trackingOnly) ||
    site.trackingOnly ||
    !isSiteHome(site, tab.url || "") ||
    !status ||
    !status.onHome
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

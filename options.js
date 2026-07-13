/* Pagina Impostazioni: interruttori + vista degli interessi raccolti (solo locale). */

const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, showToast: true, trackInterests: true };

function deaccent(s) {
  return String(s)
    .replace(/[àáâã]/g, "a")
    .replace(/[èéê]/g, "e")
    .replace(/[ìíî]/g, "i")
    .replace(/[òóôõ]/g, "o")
    .replace(/[ùúû]/g, "u")
    .replace(/ç/g, "c");
}

function getStore(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}
function setStore(o) {
  return new Promise((r) => chrome.storage.local.set(o, r));
}

async function loadSettings() {
  const d = await getStore("settings");
  const s = Object.assign({}, DEFAULTS, d.settings || {});
  $("opt-enabled").checked = s.enabled;
  $("opt-toast").checked = s.showToast;
  $("opt-track").checked = s.trackInterests;
}

async function saveSettings() {
  const s = {
    enabled: $("opt-enabled").checked,
    showToast: $("opt-toast").checked,
    trackInterests: $("opt-track").checked,
  };
  await setStore({ settings: s });
}

function topEntries(obj, n) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function renderChips(ul, entries, removable) {
  ul.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "nessun dato ancora";
    ul.appendChild(li);
    return;
  }
  for (const [name, count] of entries) {
    const li = document.createElement("li");
    li.className = "chip";
    const n = document.createElement("span");
    n.className = "chip-name";
    n.textContent = name;
    const c = document.createElement("span");
    c.className = "chip-count";
    c.textContent = count;
    li.appendChild(n);
    li.appendChild(c);
    if (removable) {
      const x = document.createElement("button");
      x.className = "chip-x";
      x.type = "button";
      x.title = "Ignora questa parola";
      x.textContent = "×";
      x.dataset.name = name;
      li.appendChild(x);
    }
    ul.appendChild(li);
  }
}

function emptyInterests() {
  return { categories: {}, keywords: {}, opened: [], totalOpened: 0 };
}

function getInterests() {
  return getStore("interests").then((d) => d.interests || emptyInterests());
}

function siteName(id) {
  const list = self.NEWS_SITES || [];
  const s = list.find((x) => x.id === id);
  return s ? s.name : id || "";
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

const OPENED_SHOWN = 200;

async function loadInterests() {
  const it = await getInterests();
  $("track-total").textContent = "Articoli registrati: " + (it.totalOpened || 0);
  renderChips($("cat-list"), topEntries(it.categories, 15), false);
  renderChips($("kw-list"), topEntries(it.keywords, 25), true);
}

async function loadIgnore() {
  const d = await getStore("ignoreWords");
  const list = d.ignoreWords || [];
  const ul = $("ignore-list");
  ul.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "nessuna parola ignorata";
    ul.appendChild(li);
    return;
  }
  list
    .slice()
    .sort()
    .forEach((w) => {
      const li = document.createElement("li");
      li.className = "chip";
      const n = document.createElement("span");
      n.className = "chip-name";
      n.textContent = w;
      const x = document.createElement("button");
      x.className = "chip-x";
      x.type = "button";
      x.title = "Rimuovi dalla lista";
      x.textContent = "×";
      x.dataset.unignore = w;
      li.appendChild(n);
      li.appendChild(x);
      ul.appendChild(li);
    });
}

async function ignoreWord(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return;
  const dw = deaccent(w);
  const d = await getStore(["ignoreWords", "interests"]);
  const list = d.ignoreWords || [];
  if (!list.some((x) => deaccent(String(x).toLowerCase()) === dw)) list.push(w);
  // rimuovi la parola dai dati già raccolti
  const it = d.interests || emptyInterests();
  Object.keys(it.keywords).forEach((k) => {
    if (deaccent(k.toLowerCase()) === dw) delete it.keywords[k];
  });
  (it.opened || []).forEach((e) => {
    if (e.kw) e.kw = e.kw.filter((k) => deaccent(String(k).toLowerCase()) !== dw);
  });
  await setStore({ ignoreWords: list, interests: it });
  refreshData();
}

async function unignoreWord(word) {
  const d = await getStore("ignoreWords");
  const list = (d.ignoreWords || []).filter((x) => x !== word);
  await setStore({ ignoreWords: list });
  loadIgnore();
}

async function addIgnoreFromInput() {
  const inp = $("ignore-input");
  const parts = inp.value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  inp.value = "";
  for (const p of parts) await ignoreWord(p);
  loadIgnore();
}

async function loadOpenedList() {
  const it = await getInterests();
  const box = $("opened-list");
  box.innerHTML = "";

  const opened = (it.opened || []).slice().sort((a, b) => b.ts - a.ts);
  const note = $("opened-note");
  if (!opened.length) {
    note.textContent = "";
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "nessun articolo registrato";
    box.appendChild(e);
    return;
  }
  note.textContent =
    opened.length > OPENED_SHOWN
      ? "(ultimi " + OPENED_SHOWN + " di " + opened.length + ")"
      : "(" + opened.length + ")";

  opened.slice(0, OPENED_SHOWN).forEach((e) => {
    const row = document.createElement("div");
    row.className = "op-row";

    const main = document.createElement("div");
    main.className = "op-main";

    const title = document.createElement("div");
    title.className = "op-title";
    title.textContent = e.t || "(senza titolo)";
    main.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "op-meta";
    if (e.c) {
      const cat = document.createElement("span");
      cat.className = "op-cat";
      cat.textContent = e.c;
      meta.appendChild(cat);
    }
    const site = document.createElement("span");
    site.className = "op-site";
    site.textContent = siteName(e.s);
    meta.appendChild(site);
    const date = document.createElement("span");
    date.textContent = fmtDate(e.ts);
    meta.appendChild(date);
    main.appendChild(meta);

    if (e.kw && e.kw.length) {
      const kw = document.createElement("div");
      kw.className = "op-kw";
      kw.textContent = e.kw.join(", ");
      main.appendChild(kw);
    }

    const del = document.createElement("button");
    del.className = "op-del";
    del.type = "button";
    del.title = "Elimina questo articolo";
    del.textContent = "×";
    del.dataset.ts = String(e.ts);
    del.dataset.key = e.k || "";

    row.appendChild(main);
    row.appendChild(del);
    box.appendChild(row);
  });
}

function decCount(map, name) {
  if (!name) return;
  const k = String(name).toLowerCase();
  if (map[k]) {
    map[k] -= 1;
    if (map[k] <= 0) delete map[k];
  }
}

async function deleteEntry(ts, key) {
  const it = await getInterests();
  const idx = it.opened.findIndex((e) => e.ts === ts && (e.k || "") === key);
  if (idx < 0) return;
  const e = it.opened[idx];
  decCount(it.categories, e.c);
  (e.kw || []).forEach((k) => decCount(it.keywords, k));
  it.opened.splice(idx, 1);
  it.totalOpened = Math.max(0, (it.totalOpened || 1) - 1);
  await setStore({ interests: it });
  refreshData();
}

// -------- export --------

function download(filename, text, type) {
  const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function stampDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

async function exportJSON() {
  const it = await getInterests();
  const opened = (it.opened || []).slice().sort((a, b) => b.ts - a.ts);
  const data = {
    esportatoIl: new Date().toISOString(),
    articoliTotali: it.totalOpened || 0,
    categoriePrincipali: topEntries(it.categories, 100000).map(([nome, conteggio]) => ({ nome, conteggio })),
    paroleChiavePrincipali: topEntries(it.keywords, 100000).map(([nome, conteggio]) => ({ nome, conteggio })),
    articoliVisitati: opened.map((e) => ({
      data: new Date(e.ts).toISOString(),
      sito: siteName(e.s),
      categoria: e.c || "",
      titolo: e.t || "",
      paroleChiave: e.kw || [],
    })),
  };
  download("interessi-" + stampDate() + ".json", JSON.stringify(data, null, 2), "application/json");
}

// Esporta le "parole da ignorare" come .txt (una per riga, ordinate e deduplicate):
// formato semplice, pensato per raccogliere i file degli utenti e unirli in futuro
// alle liste predefinite dell'estensione.
async function exportIgnore() {
  const d = await getStore("ignoreWords");
  const uniq = Array.from(
    new Set(
      (d.ignoreWords || [])
        .map((w) => String(w).trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
  if (!uniq.length) {
    const btn = $("export-ignore");
    const prev = btn.textContent;
    btn.textContent = "Nessuna parola da esportare";
    setTimeout(() => (btn.textContent = prev), 1800);
    return;
  }
  download(
    "parole-ignorate-" + stampDate() + ".txt",
    uniq.join("\n") + "\n",
    "text/plain;charset=utf-8"
  );
}

function csvCell(v) {
  return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
}

async function exportCSV() {
  const it = await getInterests();
  const opened = (it.opened || []).slice().sort((a, b) => b.ts - a.ts);
  const rows = [["data", "sito", "categoria", "titolo", "parole_chiave"].map(csvCell).join(",")];
  opened.forEach((e) => {
    rows.push(
      [
        new Date(e.ts).toLocaleString("it-IT"),
        siteName(e.s),
        e.c || "",
        e.t || "",
        (e.kw || []).join("; "),
      ]
        .map(csvCell)
        .join(",")
    );
  });
  // BOM iniziale per far aprire bene l'UTF-8 in Excel
  download("articoli-visitati-" + stampDate() + ".csv", "﻿" + rows.join("\r\n"), "text/csv;charset=utf-8");
}

function refreshData() {
  loadInterests();
  loadOpenedList();
  loadIgnore();
}

let resetArmed = false;
let resetTimer = null;
async function onReset() {
  const btn = $("btn-reset");
  if (!resetArmed) {
    resetArmed = true;
    btn.textContent = "Sicuro? Clicca di nuovo per azzerare tutto";
    resetTimer = setTimeout(() => {
      resetArmed = false;
      btn.textContent = "Azzera tutti i dati raccolti";
    }, 4000);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed = false;
  btn.textContent = "Azzera tutti i dati raccolti";
  await setStore({ interests: emptyInterests(), lastTrack: null });
  refreshData();
}

["opt-enabled", "opt-toast", "opt-track"].forEach((id) =>
  $(id).addEventListener("change", saveSettings)
);
$("btn-reset").addEventListener("click", onReset);
$("export-json").addEventListener("click", exportJSON);
$("export-csv").addEventListener("click", exportCSV);
$("export-ignore").addEventListener("click", exportIgnore);
$("opened-list").addEventListener("click", (ev) => {
  const b = ev.target.closest(".op-del");
  if (!b) return;
  deleteEntry(Number(b.dataset.ts), b.dataset.key || "");
});
$("kw-list").addEventListener("click", (ev) => {
  const b = ev.target.closest(".chip-x");
  if (!b) return;
  ignoreWord(b.dataset.name);
});
$("ignore-list").addEventListener("click", (ev) => {
  const b = ev.target.closest(".chip-x");
  if (!b) return;
  unignoreWord(b.dataset.unignore);
});
$("ignore-add").addEventListener("click", addIgnoreFromInput);
$("ignore-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    addIgnoreFromInput();
  }
});

// Aggiorna la vista non appena arrivano nuovi articoli (anche da altre schede).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.interests) refreshData();
});

loadSettings();
refreshData();

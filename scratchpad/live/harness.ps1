# Fa girare il VERO sites.js + content.js dentro Chrome headless sulla pagina
# reale di hdblog, con uno shim di chrome.storage (persistito in localStorage,
# così sopravvive alle navigazioni) e un registro di log/toast/navigazioni.
# Da dot-sourcare dopo cdp.ps1.
$proj = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Harness-Install {
  $sites = [IO.File]::ReadAllText("$proj\sites.js")
  $content = [IO.File]::ReadAllText("$proj\content.js")
  $css = [IO.File]::ReadAllText("$proj\content.css")
  $payload = @{ sites = $sites; content = $content; css = $css } | ConvertTo-Json -Compress
  $src = @"
(function(){
  if (!/hdblog\.it$/.test(location.hostname)) return;
  if (window.top !== window) return; // come il manifest: all_frames = false
  const P = $payload;
  const LS = window.localStorage;
  const load = () => { try { return JSON.parse(LS.getItem('__hdb_store') || '{}'); } catch(e) { return {}; } };
  const save = (o) => LS.setItem('__hdb_store', JSON.stringify(o));
  const log = (m) => { const l = JSON.parse(LS.getItem('__hdb_log') || '[]'); l.push(((performance.now()/1000).toFixed(1)) + 's ' + location.pathname + location.hash + ' | ' + m); LS.setItem('__hdb_log', JSON.stringify(l)); };
  window.__hdbLog = log;
  const keysOf = (k, all) => k == null ? Object.keys(all) : (typeof k === 'string' ? [k] : (Array.isArray(k) ? k : Object.keys(k)));
  const listeners = [];
  window.__hdbListeners = listeners;
  const shim = {
    storage: { local: {
      get(k, cb) { const all = load(); const o = {}; keysOf(k, all).forEach(x => { if (x in all) o[x] = all[x]; }); setTimeout(() => cb(o), 0); },
      set(o, cb) { const all = load(); Object.assign(all, o); save(all); setTimeout(() => cb && cb(), 0); },
      remove(k, cb) { const all = load(); (Array.isArray(k) ? k : [k]).forEach(x => delete all[x]); save(all); setTimeout(() => cb && cb(), 0); },
    }},
    runtime: {
      sendMessage(m) { if (m && m.type === 'setBadge') log('BADGE ' + m.count + (m.approx ? '+' : '')); },
      onMessage: { addListener(fn) { listeners.push(fn); } },
    },
  };
  window.__hdbSend = (msg) => new Promise(res => { listeners.forEach(fn => fn(msg, {}, res)); });
  const origLog = console.log.bind(console);
  const run = () => {
    const st = document.createElement('style'); st.textContent = P.css; document.head.appendChild(st);
    console.log = function() { const s = [].map.call(arguments, String).join(' '); if (s.indexOf('[Segnalibro]') === 0) log(s); return origLog.apply(null, arguments); };
    new MutationObserver(() => {
      document.querySelectorAll('.hdb-toast-title').forEach(t => { if (t.__last !== t.textContent) { t.__last = t.textContent; log('TOAST ' + t.textContent + ' ' + ((t.closest('.hdb-toast').querySelector('.hdb-toast-num')||{}).textContent||'')); } });
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const chrome = shim;
    try { (new Function('chrome', 'self', P.sites + '\n;self.NEWS_SITES=NEWS_SITES;'))(chrome, window); } catch(e) { log('ERR sites ' + e); }
    try { (new Function('chrome', P.content))(chrome); } catch(e) { log('ERR content ' + e); }
    log('INJECTED');
  };
  const origAssign = Location.prototype.assign;
  window.addEventListener('beforeunload', () => log('UNLOAD -> leaving'));
  // document_idle ~ poco dopo DOMContentLoaded
  if (document.readyState !== 'loading') setTimeout(run, 300);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(run, 300));
})();
"@
  Cdp-Send "Page.enable" @{} | Out-Null
  $r = Cdp-Send "Page.addScriptToEvaluateOnNewDocument" @{ source = $src }
  return $r.result.identifier
}

function Harness-Reset($store) {
  $j = ($store | ConvertTo-Json -Compress) -replace "'", "\'"
  Cdp-Eval "localStorage.setItem('__hdb_store', '$j'); localStorage.setItem('__hdb_log','[]'); 'ok'"
}

function Harness-Log { Cdp-Eval "localStorage.getItem('__hdb_log')" }

function Harness-State {
  Cdp-Eval @"
(() => {
  const m = document.querySelector('.hdb-marker');
  let vis = null;
  if (m) { const r = m.getBoundingClientRect(); vis = r.top >= -50 && r.bottom <= innerHeight + 50; }
  const link = m && m.querySelector('a.title_new');
  return JSON.stringify({ url: location.href, marker: !!m, markerVisible: vis, markerHref: link && link.getAttribute('href'), feed: document.querySelectorAll('article.newlist_normal').length, dups: document.querySelectorAll('.hdb-dup').length, y: Math.round(scrollY), store: JSON.parse(localStorage.getItem('__hdb_store')||'{}') });
})()
"@
}

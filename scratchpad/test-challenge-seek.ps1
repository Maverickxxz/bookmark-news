<#
  v0.4.4 — bug #18: su hdblog, alla PRIMA ricerca della giornata, "Vai all'ultima
  letta" arrivava su /page/1/ e non portava alla notizia; dopo un refresh sì.

  Le /page/N/ di hdblog stanno dietro una verifica Cloudflare Turnstile
  ("HDblog.it - Verifica Connessione", 429): senza il cookie di verifica il
  browser riceve una pagina SENZA notizie che si verifica da sola e poi fa
  location.reload(). content.js girava sulla pagina di verifica, vedeva 0
  notizie, dichiarava "pagina vuota" e toglieva il flag di ricerca: al reload la
  pagina vera veniva solo evidenziata, senza centrare la notizia.

  Test LIVE (Chrome headless, vero content.js, vedi live\harness.ps1). Il Chrome
  headless di norma non viene sfidato, quindi la verifica si SIMULA: un secondo
  script iniettato, al primo caricamento di /page/1/ con il flag __hdb_challenge,
  sostituisce la pagina con lo stesso markup della verifica vera (titolo, script
  di Turnstile, nessuna notizia) e ricarica dopo `ChallengeMs` ms.
   1. verifica che si risolve in 2,5s -> la ricerca riprende e centra la notizia;
   2. verifica lenta (8s, oltre l'attesa del feed) -> idem;
   3. nessuna verifica -> la strada normale funziona ancora.
  Esegui con:  powershell -ExecutionPolicy Bypass -File scratchpad\test-challenge-seek.ps1
#>
$ErrorActionPreference = "Stop"
$live = Join-Path $PSScriptRoot "live"
function Stop-TestChrome {
  Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {
    (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*bookmark-news-chrome-profile*"
  } | Stop-Process -Force
  Start-Sleep 2
}
Stop-TestChrome
. "$live\cdp.ps1"; . "$live\harness.ps1"
Cdp-Open
Cdp-Navigate "https://www.hdblog.it/page/1/" 6000
$ids = Cdp-Eval "JSON.stringify([...document.querySelectorAll('article.newlist_normal')].filter(a=>!a.closest('#listnewssdx')).map(a=>{const l=a.querySelector('a.title_new[href]');const m=l&&l.getAttribute('href').match(/\/n(\d+)\//);return m?'n'+m[1]:'x'}))" | ConvertFrom-Json
$m = $ids[45]
"segnalibro di prova: $m (posizione 45 di $($ids.Count))"

# Pagina di verifica simulata. Registrata PRIMA dell'harness, quindi il suo
# DOMContentLoaded gira prima di content.js.
$challenge = @'
(function(){
  if (window.top !== window) return;
  if (!/^\/page\/\d+\/$/.test(location.pathname)) return;
  const ms = parseInt(localStorage.getItem('__hdb_challenge') || '0', 10);
  if (!ms) return;
  localStorage.removeItem('__hdb_challenge');
  document.addEventListener('DOMContentLoaded', () => {
    document.title = 'HDblog.it - Verifica Connessione';
    document.body.innerHTML = '<div class="container"><div id="step-v3"><div id="widget-container"></div><br/><div id="message">Verifica automatica in corso...</div></div></div>';
    const s = document.createElement('script');
    s.type = 'text/plain'; // solo per il markup: non va caricato davvero
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
    document.body.appendChild(s);
    if (window.__hdbLog) window.__hdbLog('CHALLENGE simulata, reload tra ' + ms + ' ms');
    setTimeout(() => location.reload(), ms);
  });
})();
'@
Cdp-Send "Page.enable" @{} | Out-Null
Cdp-Send "Page.addScriptToEvaluateOnNewDocument" @{ source = $challenge } | Out-Null
$null = Harness-Install
Cdp-Navigate "https://www.hdblog.it/" 4000
$store = @{ marker_hdblog = $m; pending_hdblog = $m; initialized_hdblog = $true; reached_hdblog = $false }
$fail = 0

function Run-Scenario($label, [int]$challengeMs, [int]$waitS) {
  Harness-Reset $store | Out-Null
  Cdp-Eval "localStorage.removeItem('__hdb_challenge'); 'ok'" | Out-Null
  Cdp-Navigate "https://www.hdblog.it/" 6000
  if ($challengeMs) { Cdp-Eval "localStorage.setItem('__hdb_challenge', '$challengeMs'); 'ok'" | Out-Null }
  Cdp-Eval "window.__hdbSend({type:'scrollToMarker'}); 'sent'" | Out-Null
  Start-Sleep $waitS
  $o = Harness-State | ConvertFrom-Json
  $log = (Harness-Log | ConvertFrom-Json) -join "`n"
  $ok = $o.url -eq "https://www.hdblog.it/page/1/" -and $o.marker -and $o.markerVisible -and -not $o.store.seek_hdblog
  if ($challengeMs) { $ok = $ok -and $log -match 'CHALLENGE simulata' }
  if (-not $ok) { $script:fail++; $log; "stato: " + ($o | ConvertTo-Json -Compress -Depth 5) }
  "{0}  {1}: url={2} marker={3} visibile={4} flag={5}" -f $(if ($ok) { " ok " } else { "FAIL" }), $label, $o.url, $o.marker, $o.markerVisible, [bool]$o.store.seek_hdblog
}

Run-Scenario "verifica 2,5s poi reload" 2500 16
Run-Scenario "verifica lenta 8s poi reload" 8000 22
Run-Scenario "nessuna verifica" 0 12
Stop-TestChrome
if ($fail) { "`n$fail scenari FALLITI"; exit 1 } else { "`nTutti gli scenari ok" }

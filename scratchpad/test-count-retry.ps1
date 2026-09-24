<#
  v0.4.3 — bug #17: su hdblog, al primo caricamento, il badge restava "20+" e
  "Vai all'ultima letta" non trovava la notizia; al secondo refresh tutto ok.

  Test LIVE (Chrome headless, vero content.js, vedi live\harness.ps1): il
  conteggio (pages.php?...&b=10) viene BLOCCATO al caricamento per simulare la
  rete non ancora pronta.
   1. sbloccato dopo 3s -> i retry devono portare il badge al numero esatto;
   2. bloccato per tutti i retry, poi sbloccato -> "Vai all'ultima letta" rifà
      il conteggio e arriva alla notizia.
  Esegui con:  powershell -ExecutionPolicy Bypass -File scratchpad\test-count-retry.ps1
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
$m = $ids[50]
Cdp-Send "Network.enable" @{} | Out-Null
$null = Harness-Install
Cdp-Navigate "https://www.hdblog.it/" 4000
$store = @{ marker_hdblog = $m; pending_hdblog = $m; initialized_hdblog = $true; reached_hdblog = $false }
$fail = 0

Harness-Reset $store | Out-Null
Cdp-Send "Network.setBlockedURLs" @{ urls = @("*b=10*") } | Out-Null
Cdp-Navigate "https://www.hdblog.it/" 3000
Cdp-Send "Network.setBlockedURLs" @{ urls = @() } | Out-Null
Start-Sleep 9
$log = (Harness-Log | ConvertFrom-Json) -join "`n"
$ok = $log -match 'BADGE \d+(\r?\n|$)' -and $log -match 'errore di rete'
if (-not $ok) { $fail++; $log }
"{0}  retry del conteggio dopo rete assente" -f $(if ($ok) { " ok " } else { "FAIL" })

Harness-Reset $store | Out-Null
Cdp-Send "Network.setBlockedURLs" @{ urls = @("*b=10*") } | Out-Null
Cdp-Navigate "https://www.hdblog.it/" 21000
Cdp-Send "Network.setBlockedURLs" @{ urls = @() } | Out-Null
Cdp-Eval "window.__hdbSend({type:'scrollToMarker'}); 'sent'" | Out-Null
Start-Sleep 14
$o = Harness-State | ConvertFrom-Json
$ok = $o.url -eq "https://www.hdblog.it/page/1/" -and $o.marker -and $o.markerVisible
if (-not $ok) { $fail++; (Harness-Log | ConvertFrom-Json) -join "`n" }
"{0}  seek dopo conteggio fallito: {1} marker={2}" -f $(if ($ok) { " ok " } else { "FAIL" }), $o.url, $o.marker
Stop-TestChrome
if ($fail) { "`n$fail scenari FALLITI"; exit 1 } else { "`nTutti gli scenari ok" }

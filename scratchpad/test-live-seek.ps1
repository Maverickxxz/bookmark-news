<#
  v0.4.2 — bug #16: su hdblog "Vai all'ultima letta" non arrivava più all'ultima
  letta dopo che il sito ha cambiato il caricamento a fine pagina.

  Test LIVE: fa girare il VERO sites.js + content.js dentro Chrome headless
  (via DevTools Protocol, vedi live\cdp.ps1 e live\harness.ps1 — chrome.storage
  è simulato in localStorage) sulla home vera di hdblog, con il segnalibro messo
  in posizioni diverse, e controlla dove finisce la ricerca.
  Gli id si ricavano dal vivo da /page/1..3/ (le pagine cambiano ogni ora).

  Esegui con:  powershell -ExecutionPolicy Bypass -File scratchpad\test-live-seek.ps1
  (serve Google Chrome installato; ~2 minuti)
#>
$ErrorActionPreference = "Stop"
$live = Join-Path $PSScriptRoot "live"

function Stop-TestChrome {
  Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {
    (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*bookmark-news-chrome-profile*"
  } | Stop-Process -Force
  Start-Sleep 2
}

# ---- id reali delle pagine d'archivio (stessa chiave di content.js/articleKey)
Stop-TestChrome
. "$live\cdp.ps1"
Cdp-Open
$idsJs = @"
(() => JSON.stringify([...document.querySelectorAll('article.newlist_normal')]
  .filter(a => !a.closest('#listnewssdx'))
  .map(a => {
    const l = a.querySelector('a.title_new[href], a.thumb_new_image[href], a[href]');
    const u = new URL(l.getAttribute('href'), location.href);
    const m = u.pathname.match(/\/n(\d+)\//);
    return m ? 'n' + m[1] : (u.host + u.pathname.replace(/\/+$/, '')).toLowerCase();
  })))()
"@
$pages = @{}
foreach ($n in 1, 2, 3) {
  Cdp-Navigate "https://www.hdblog.it/page/$n/" 6000
  $pages[$n] = Cdp-Eval $idsJs | ConvertFrom-Json
  "pagina $n : $($pages[$n].Count) notizie"
}
$all = $pages[1] + $pages[2] + $pages[3]
$missing = 670699
$hi = ($pages[2] | Where-Object { $_ -match '^n\d+$' } | ForEach-Object { [int]$_.Substring(1) } | Measure-Object -Maximum).Maximum
$missing = $hi - 3; while ($all -contains "n$missing") { $missing-- }
$hdm = $pages[2] | Where-Object { $_ -like 'www.hdmotori*' } | Select-Object -First 1

$cases = @(
  @{ name = "home, 6a notizia (gia in pagina)"; marker = $pages[1][5];  url = "https://www.hdblog.it/";        found = $true },
  @{ name = "home, 36a (lazy-load)";           marker = $pages[1][35]; url = "https://www.hdblog.it/page/1/"; found = $true },
  @{ name = "home, 71a (oltre il muro rotto)"; marker = $pages[1][70]; url = "https://www.hdblog.it/page/1/"; found = $true },
  @{ name = "pagina 2 (~150a)";                marker = $pages[2][50]; url = "https://www.hdblog.it/page/2/"; found = $true },
  @{ name = "pagina 3 (~240a)";                marker = $pages[3][40]; url = "https://www.hdblog.it/page/3/"; found = $true },
  @{ name = "hdmotori in pagina 2";            marker = $hdm;          url = "https://www.hdblog.it/page/2/"; found = $true },
  @{ name = "non elencato (n$missing)";        marker = "n$missing";   url = $null;                          found = $false }
)

$fail = 0
foreach ($c in $cases) {
  Stop-TestChrome
  $out = & "$live\scenario.ps1" -Marker $c.marker -Watch 15
  $last = $out | Where-Object { $_ -match '^\d+s url=' } | Select-Object -Last 1
  $ok = $true
  if ($c.found) {
    $ok = ($last -match [regex]::Escape("url=$($c.url) ")) -and ($last -match 'marker=True vis=True')
  } else {
    # deve FERMARSI entro poche pagine, dicendolo, non arrivare al tetto
    $ok = ($out -join "`n") -match 'interrotta a pagina [2-4]\b'
  }
  if (-not $ok) { $fail++ }
  "{0}  {1,-34} {2}" -f ($(if ($ok) { " ok " } else { "FAIL" })), $c.name, $last
}
Stop-TestChrome
if ($fail) { "`n$fail scenari FALLITI"; exit 1 } else { "`nTutti gli scenari ok" }

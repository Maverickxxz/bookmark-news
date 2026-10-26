<#
  Bug #19 (diagnosi): dopo "Vai all'ultima letta" la ricerca arriva su /page/1/,
  trova la notizia e la centra, ma l'utente non la vede e deve ricaricare.
  Ipotesi: la centratura avviene a pagina ancora in costruzione (immagini,
  pubblicità) e quel che si carica SOPRA la notizia la spinge fuori schermo.

  Misura: ricerca vera (content.js in Chrome headless, vedi live\harness.ps1),
  poi posizione della .hdb-marker nel viewport ogni 250 ms per 15 s.
  Esegui con:  powershell -ExecutionPolicy Bypass -File scratchpad\test-center-drift.ps1 [-Pos 40]
#>
param([int]$Pos = 40, [int]$Seconds = 15)
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
# Il primo caricamento di /page/1/ in un Chrome appena avviato può essere la
# verifica anti-bot (bug #18): si riprova finché compaiono le notizie.
for ($i = 0; $i -lt 5 -and [int](Cdp-Eval "document.querySelectorAll('article.newlist_normal').length") -lt 50; $i++) {
  Cdp-Navigate "https://www.hdblog.it/page/1/" 6000
}
$ids = Cdp-Eval "JSON.stringify([...document.querySelectorAll('article.newlist_normal')].filter(a=>!a.closest('#listnewssdx')).map(a=>{const l=a.querySelector('a.title_new[href]');const m=l&&l.getAttribute('href').match(/\/n(\d+)\//);return m?'n'+m[1]:'x'}))" | ConvertFrom-Json
$m = $ids[$Pos]
"segnalibro di prova: $m (posizione $Pos di $($ids.Count))"

# Campionatore: su /page/N/ registra la posizione della .hdb-marker nel viewport.
$sampler = @'
(function(){
  if (window.top !== window || !/^\/page\/\d+\/$/.test(location.pathname)) return;
  const t0 = performance.now();
  const out = [];
  const tick = () => {
    const m = document.querySelector('.hdb-marker');
    const r = m && m.getBoundingClientRect();
    out.push({ t: Math.round(performance.now() - t0), y: Math.round(scrollY),
      top: r ? Math.round(r.top) : null, vis: r ? (r.bottom > 0 && r.top < innerHeight) : null,
      h: document.documentElement.scrollHeight, rs: document.readyState });
    localStorage.setItem('__drift', JSON.stringify(out));
  };
  setInterval(tick, 250);
})();
'@
Cdp-Send "Page.enable" @{} | Out-Null
Cdp-Send "Page.addScriptToEvaluateOnNewDocument" @{ source = $sampler } | Out-Null
$null = Harness-Install
Cdp-Navigate "https://www.hdblog.it/" 4000
Harness-Reset @{ marker_hdblog = $m; pending_hdblog = $m; initialized_hdblog = $true; reached_hdblog = $false } | Out-Null
Cdp-Navigate "https://www.hdblog.it/" 6000
Cdp-Eval "localStorage.removeItem('__drift'); window.__hdbSend({type:'scrollToMarker'}); 'sent'" | Out-Null
Start-Sleep ($Seconds + 6)
$d = Cdp-Eval "localStorage.getItem('__drift')" | ConvertFrom-Json
$first = $null
foreach ($s in $d) {
  if ($s.top -ne $null -and $first -eq $null) { $first = $s }
  "{0,6} ms  scrollY={1,6}  marker.top={2,6}  visibile={3,-5}  altezza={4,6}  {5}" -f $s.t, $s.y, $s.top, $s.vis, $s.h, $s.rs
}
$last = $d[-1]
"---"
"centrata a: top={0} · dopo {1}s: top={2} visibile={3}" -f $first.top, [math]::Round($last.t / 1000), $last.top, $last.vis
(Harness-Log | ConvertFrom-Json) | Select-String "archivio|RAGGIUNTO|TROVATO" | ForEach-Object { $_.Line }
Stop-TestChrome

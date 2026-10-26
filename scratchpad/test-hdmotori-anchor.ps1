<#
  v0.4.5 — bug #19: su hdblog il segnalibro "non si aggiorna più" e "Vai
  all'ultima letta" fatica a trovarlo. Da ottobre 2026 l'archivio /page/N/ NON
  elenca le notizie hdmotori, che la home e il conteggio (pages.php) mostrano
  (~1 su 5, spesso la prima). Un segnalibro hdmotori fuori dalla home non si
  trovava mai: ricerca a vuoto, mai "raggiunto", segnalibro fermo.

  Test LIVE (Chrome headless, vero content.js, vedi live\harness.ps1):
   1. migrazione: segnalibro hdmotori SENZA àncora salvata -> il conteggio la
      ricava, la ricerca arriva su /page/1/ e centra la notizia hdblog subito
      sotto il segnalibro; "raggiunto" diventa true;
   2. registro: pending hdmotori con la sua àncora + reached -> il marker
      avanza a pending portandosi dietro l'àncora, e la ricerca la trova;
   3. prima volta: àncora = prima notizia hdblog del feed (o il marker stesso);
   4. segnalibro hdblog normale: invariato (centra il segnalibro stesso).
  Esegui con:  powershell -ExecutionPolicy Bypass -File scratchpad\test-hdmotori-anchor.ps1
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

$keysJs = "(d)=>[...d.querySelectorAll('article.newlist_normal')].filter(a=>!a.closest('#listnewssdx')).map(a=>{const l=a.querySelector('a.title_new[href]');if(!l)return 'x';const h=new URL(l.getAttribute('href'),location.href);const m=h.pathname.match(/\/n(\d+)\//);return m?'n'+m[1]:(h.host+h.pathname.replace(/\/+$/,'')).toLowerCase()})"
# /page/1/ (riprovando: il primo caricamento può essere la verifica anti-bot)
Cdp-Navigate "https://www.hdblog.it/page/1/" 6000
for ($i = 0; $i -lt 5 -and [int](Cdp-Eval "document.querySelectorAll('article.newlist_normal').length") -lt 50; $i++) {
  Cdp-Navigate "https://www.hdblog.it/page/1/" 6000
}
$p1 = Cdp-Eval "JSON.stringify(($keysJs)(document))" | ConvertFrom-Json
Cdp-Navigate "https://www.hdblog.it/" 6000
$hp = Cdp-Eval "JSON.stringify(($keysJs)(document))" | ConvertFrom-Json
$seq = Cdp-Eval "fetch('/new_files/ajax/pages.php?page=1&b=10',{cache:'no-store'}).then(r=>r.text()).then(t=>JSON.stringify(($keysJs)(new DOMParser().parseFromString(t,'text/html'))))" | ConvertFrom-Json
"home $($hp.Count) · conteggio $($seq.Count) (hdmotori $(@($seq | ? { $_ -like '*hdmotori*' }).Count)) · /page/1/ $($p1.Count) (hdmotori $(@($p1 | ? { $_ -like '*hdmotori*' }).Count))"

# Segnalibro hdmotori fuori dalla home, con un'àncora hdblog presente in /page/1/.
$H = $null; $A = $null
for ($i = 25; $i -lt $seq.Count - 1 -and -not $H; $i++) {
  if ($seq[$i] -like "*hdmotori*" -and $hp -notcontains $seq[$i]) {
    for ($j = $i + 1; $j -lt $seq.Count; $j++) { if ($seq[$j] -match '^n\d+$') { $A = $seq[$j]; break } }
    if ($A -and $p1 -contains $A) { $H = $seq[$i] } else { $A = $null }
  }
}
if (-not $H) { "FAIL: nessun segnalibro hdmotori adatto nella sequenza"; Stop-TestChrome; exit 1 }
"segnalibro hdmotori: $H (posizione $([array]::IndexOf($seq, $H)) nel conteggio) · àncora attesa: $A (posizione $([array]::IndexOf($p1, $A)) in /page/1/)"
$N = $p1[45]

$null = Harness-Install
Cdp-Navigate "https://www.hdblog.it/" 4000
$fail = 0
function Check($label, $ok, $detail) {
  if (-not $ok) { $script:fail++ }
  "{0}  {1}{2}" -f $(if ($ok) { " ok " } else { "FAIL" }), $label, $(if ($detail) { " · $detail" } else { "" })
}
function Seek-From($store, [int]$waitS = 14) {
  Harness-Reset $store | Out-Null
  Cdp-Navigate "https://www.hdblog.it/" 7000
  $before = Harness-State | ConvertFrom-Json
  Cdp-Eval "window.__hdbSend({type:'scrollToMarker'}); 'sent'" | Out-Null
  Start-Sleep $waitS
  $o = Harness-State | ConvertFrom-Json
  $o | Add-Member -NotePropertyName before -NotePropertyValue $before.store
  $o | Add-Member -NotePropertyName log -NotePropertyValue ((Harness-Log | ConvertFrom-Json) -join "`n")
  return $o
}
function KeyOfHref($h) { if ($h -match '/n(\d+)/') { "n" + $Matches[1] } else { $h } }

# 1. migrazione: niente àncora salvata
$o = Seek-From @{ marker_hdblog = $H; pending_hdblog = $H; initialized_hdblog = $true; reached_hdblog = $false }
$hl = KeyOfHref $o.markerHref
Check "1. arriva su /page/1/" ($o.url -eq "https://www.hdblog.it/page/1/") $o.url
Check "1. evidenzia l'àncora" ($hl -eq $A) "evidenziata $hl"
Check "1. àncora visibile sullo schermo" ([bool]$o.markerVisible)
Check "1. raggiunto" ($o.store.reached_hdblog -eq $true)
Check "1. àncora salvata dal conteggio" ($o.store.anchor_hdblog -eq $A) "anchor_hdblog=$($o.store.anchor_hdblog)"
Check "1. flag di ricerca tolto" (-not $o.store.seek_hdblog)
if ($fail) { $o.log }

# 2. registro: pending hdmotori con àncora, reached -> il marker avanza con l'àncora
$f0 = $fail
$o = Seek-From @{ marker_hdblog = $N; pending_hdblog = $H; pendingAnchor_hdblog = $A; initialized_hdblog = $true; reached_hdblog = $true }
$hl = KeyOfHref $o.markerHref
Check "2. il marker avanza a pending" ($o.before.marker_hdblog -eq $H) "marker=$($o.before.marker_hdblog)"
Check "2. con l'àncora di pending" ($o.before.anchor_hdblog -eq $A) "anchor=$($o.before.anchor_hdblog)"
Check "2. nuova àncora di pending = prima hdblog del feed" ($o.before.pendingAnchor_hdblog -eq (@($hp | ? { $_ -match '^n\d+$' })[0])) "pendingAnchor=$($o.before.pendingAnchor_hdblog)"
Check "2. ricerca: evidenzia l'àncora su /page/1/" ($o.url -eq "https://www.hdblog.it/page/1/" -and $hl -eq $A -and $o.markerVisible) "url=$($o.url) evidenziata=$hl"
if ($fail -gt $f0) { $o.log }

# 3. prima volta
Harness-Reset @{} | Out-Null
Cdp-Navigate "https://www.hdblog.it/" 6000
$s = (Harness-State | ConvertFrom-Json).store
$exp = if ($s.marker_hdblog -match '^n\d+$') { $s.marker_hdblog } else { @($hp | ? { $_ -match '^n\d+$' })[0] }
Check "3. prima volta: àncora coerente" ($s.anchor_hdblog -eq $exp -and $s.pendingAnchor_hdblog -eq $exp) "marker=$($s.marker_hdblog) anchor=$($s.anchor_hdblog) pendingAnchor=$($s.pendingAnchor_hdblog)"

# 4. segnalibro hdblog normale
$f0 = $fail
$o = Seek-From @{ marker_hdblog = $N; pending_hdblog = $N; initialized_hdblog = $true; reached_hdblog = $false }
$hl = KeyOfHref $o.markerHref
Check "4. segnalibro hdblog: centra lui" ($o.url -eq "https://www.hdblog.it/page/1/" -and $hl -eq $N -and $o.markerVisible -and $o.store.anchor_hdblog -eq $N) "url=$($o.url) evidenziata=$hl anchor=$($o.store.anchor_hdblog)"
if ($fail -gt $f0) { $o.log }

$errs = ((Harness-Log | ConvertFrom-Json) | ? { $_ -match 'ERR |ECCEZIONE' })
Check "nessun errore di script" (-not $errs) ($errs -join " | ")
"---"
if ($fail) { "FALLITI: $fail" } else { "tutti ok" }
Stop-TestChrome
exit $fail

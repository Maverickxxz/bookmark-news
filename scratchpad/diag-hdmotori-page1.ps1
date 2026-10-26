<#
  Bug #19 (diagnosi): la home di hdblog e il conteggio (pages.php) contengono
  notizie di hdmotori; le contiene anche l'archivio /page/1/? Se no, un
  segnalibro su una notizia hdmotori non si trova mai nell'archivio.
  Esegui con:  powershell -ExecutionPolicy Bypass -File scratchpad\diag-hdmotori-page1.ps1
#>
$ErrorActionPreference = "Stop"
$live = Join-Path $PSScriptRoot "live"
. "$live\cdp.ps1"
Cdp-Open
$keys = @'
JSON.stringify([...document.querySelectorAll('article.newlist_normal')].filter(a=>!a.closest('#listnewssdx')).map(a=>{const l=a.querySelector('a.title_new[href]');if(!l)return 'x';const h=l.href;const m=h.match(/hdblog\.it\/.*\/n(\d+)\//);return m?'n'+m[1]:h.replace(/^https?:\/\//,'').replace(/\/$/,'')}))
'@
Cdp-Navigate "https://www.hdblog.it/page/1/" 6000
for ($i = 0; $i -lt 5 -and [int](Cdp-Eval "document.querySelectorAll('article.newlist_normal').length") -lt 50; $i++) {
  Cdp-Navigate "https://www.hdblog.it/page/1/" 6000
}
$p1 = Cdp-Eval $keys | ConvertFrom-Json
Cdp-Navigate "https://www.hdblog.it/" 6000
$hp = Cdp-Eval $keys | ConvertFrom-Json
$ajax = Cdp-Eval @'
fetch('/new_files/ajax/pages.php?page=1&b=10',{cache:'no-store'}).then(r=>r.text()).then(t=>{const d=new DOMParser().parseFromString(t,'text/html');return JSON.stringify([...d.querySelectorAll('article.newlist_normal')].map(a=>{const l=a.querySelector('a.title_new[href]');if(!l)return 'x';const h=l.getAttribute('href');const m=h.match(/hdblog\.it\/.*\/n(\d+)\/|^\/.*\/n(\d+)\//);return m?'n'+(m[1]||m[2]):h.replace(/^https?:\/\//,'').replace(/\/$/,'')}))})
'@ | ConvertFrom-Json
function Summ($name, $a) {
  $hm = @($a | Where-Object { $_ -like "*hdmotori*" })
  "{0,-8} {1,3} notizie · hdmotori {2,2} · prime 12: {3}" -f $name, $a.Count, $hm.Count, (($a | Select-Object -First 12) -join " ")
}
Summ "home" $hp
Summ "ajax" $ajax
Summ "page/1" $p1
$inP1 = @($hp | Where-Object { $p1 -contains $_ }).Count
"notizie della home presenti in /page/1/: $inP1 di $($hp.Count)"
"hdmotori della home assenti da /page/1/: " + ((@($hp | Where-Object { $_ -like "*hdmotori*" -and $p1 -notcontains $_ })) -join ", ")


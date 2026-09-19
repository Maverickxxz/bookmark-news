# Mini client CDP: avvia Chrome headless (se non già attivo) e offre
# Cdp-Open / Cdp-Eval / Cdp-Navigate. Da dot-sourcare: . .\cdp.ps1
$ErrorActionPreference = "Stop"
$script:sp = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:port = 9333
$script:chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

function Cdp-Start {
  try { Invoke-RestMethod "http://127.0.0.1:$script:port/json/version" | Out-Null; return } catch {}
  $ud = Join-Path $env:TEMP "bookmark-news-chrome-profile"
  Start-Process -FilePath $script:chrome -ArgumentList @(
    "--headless=new", "--disable-gpu", "--remote-debugging-port=$script:port",
    "--user-data-dir=$ud", "--window-size=1400,900", "--no-first-run",
    "--lang=it-IT", "about:blank") | Out-Null
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 200
    try { Invoke-RestMethod "http://127.0.0.1:$script:port/json/version" | Out-Null; return } catch {}
  }
  throw "Chrome non risponde"
}

$script:ws = $null
$script:msgId = 0

function Cdp-Open {
  Cdp-Start
  $tabs = Invoke-RestMethod "http://127.0.0.1:$script:port/json/list"
  $page = $tabs | Where-Object { $_.type -eq "page" } | Select-Object -First 1
  $script:ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $script:ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
}

function Cdp-Recv {
  $buf = New-Object byte[] 1048576
  $ms = New-Object System.IO.MemoryStream
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList (, $buf)
    $r = $script:ws.ReceiveAsync($seg, [Threading.CancellationToken]::None).Result
    $ms.Write($buf, 0, $r.Count)
  } while (-not $r.EndOfMessage)
  return [Text.Encoding]::UTF8.GetString($ms.ToArray())
}

function Cdp-Send($method, $params) {
  $script:msgId++
  $id = $script:msgId
  $obj = @{ id = $id; method = $method; params = $params }
  $json = $obj | ConvertTo-Json -Depth 20 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList (, $bytes)
  $script:ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
  while ($true) {
    $txt = Cdp-Recv
    if ($txt -match ('^\{"id":' + $id + ',')) { return ($txt | ConvertFrom-Json) }
  }
}

function Cdp-Eval($expr, [int]$timeoutMs = 120000) {
  $r = Cdp-Send "Runtime.evaluate" @{ expression = $expr; awaitPromise = $true; returnByValue = $true; timeout = $timeoutMs }
  if ($r.result.exceptionDetails) { return "EXC: " + ($r.result.exceptionDetails | ConvertTo-Json -Depth 6 -Compress) }
  return $r.result.result.value
}

function Cdp-Navigate($url, [int]$waitMs = 6000) {
  Cdp-Send "Page.navigate" @{ url = $url } | Out-Null
  Start-Sleep -Milliseconds $waitMs
}

param([string]$Marker, [int]$Watch = 60, [switch]$Reached)
$sp = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$sp\cdp.ps1"
. "$sp\harness.ps1"
Cdp-Open
Cdp-Send "Network.setUserAgentOverride" @{ userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" } | Out-Null
Cdp-Send "Network.enable" @{} | Out-Null
Cdp-Send "Network.setCacheDisabled" @{ cacheDisabled = $true } | Out-Null
$null = Harness-Install
Cdp-Navigate "https://www.hdblog.it/" 4000
Harness-Reset @{ marker_hdblog = $Marker; pending_hdblog = $Marker; initialized_hdblog = $true; reached_hdblog = [bool]$Reached } | Out-Null
Cdp-Navigate "https://www.hdblog.it/" 9000
"--- dopo il load:"; Harness-State
Cdp-Eval "window.__hdbSend({type:'scrollToMarker'}); 'sent'" | Out-Null
$t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt $Watch) {
  Start-Sleep -Seconds 5
  try { $s = Harness-State; $o = $s | ConvertFrom-Json; "{0:N0}s url={1} marker={2} vis={3} feed={4} y={5}" -f ((Get-Date) - $t0).TotalSeconds, $o.url, $o.marker, $o.markerVisible, $o.feed, $o.y } catch { "state err: $_" }
}
"--- log:"
(Harness-Log | ConvertFrom-Json) -join "`n"

# build.ps1 — crea il pacchetto ZIP da caricare sul Chrome Web Store.
#
#   powershell -ExecutionPolicy Bypass -File .\build.ps1
#
# Mette SOLO i file che fanno parte dell'estensione (elenco esplicito qui sotto):
# scratchpad/, CLAUDE.md, BUG.md, README.md, rileva-selettori.js, .git/ ecc.
# restano fuori. manifest.json finisce nella RADICE dello zip, come richiesto.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- file che fanno parte dell'estensione ------------------------------------
$files = @(
  "manifest.json",
  "sites.js",
  "content.js",
  "content.css",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "options.html",
  "options.js",
  "options.css"
)
$dirs = @("icons")

# --- controlli prima di impacchettare ----------------------------------------
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version

$descLen = $manifest.description.Length
if ($descLen -gt 132) {
  throw "description nel manifest: $descLen caratteri, il limite del Web Store e' 132."
}

$missing = @()
foreach ($f in $files) { if (-not (Test-Path (Join-Path $root $f))) { $missing += $f } }
foreach ($d in $dirs)  { if (-not (Test-Path (Join-Path $root $d))) { $missing += "$d/" } }
if ($missing.Count -gt 0) { throw "File mancanti: $($missing -join ', ')" }

# le pagine dell'estensione non devono caricare codice remoto (causa di rifiuto)
$remote = Select-String -Path (Join-Path $root "*.html") -Pattern '(src|href)\s*=\s*["'']https?://' |
          Where-Object { $_.Line -notmatch 'rel\s*=\s*["'']noopener' -and $_.Line -notmatch '<a ' }
if ($remote) {
  Write-Warning "Riferimenti remoti nelle pagine HTML (controlla che siano solo link <a>):"
  $remote | ForEach-Object { Write-Warning ("  {0}:{1} {2}" -f $_.Filename, $_.LineNumber, $_.Line.Trim()) }
}

# --- zip ----------------------------------------------------------------------
# NON si usa Compress-Archive: in PowerShell 5.1 scrive i nomi delle voci con la
# barra rovesciata (icons\icon16.png) invece della barra normale prevista dallo
# standard ZIP. Il Web Store spacchetta su Linux e quel nome diventa un file
# unico chiamato "icons\icon16.png" nella radice: le icone non si trovano piu'.
# Qui le voci si scrivono a mano, con "/".
$dist = Join-Path $root "dist"
$zip = Join-Path $dist "segnalibro-notizie-$version.zip"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$entries = @()
foreach ($f in $files) { $entries += @{ path = (Join-Path $root $f); name = $f } }
foreach ($d in $dirs) {
  $base = (Resolve-Path (Join-Path $root $d)).Path
  Get-ChildItem $base -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($base.Length).TrimStart('\', '/').Replace('\', '/')
    $entries += @{ path = $_.FullName; name = "$d/$rel" }
  }
}

$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($e in $entries) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $e.path, $e.name,
      [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host ""
Write-Host "OK  versione $version  ->  $zip  ($kb KB)"
Write-Host "    description: $descLen/132 caratteri"
Write-Host ""
Write-Host "Prima di caricare: carica lo zip scompattato da chrome://extensions"
Write-Host "(Carica estensione non pacchettizzata) e provalo, cosi' verifichi"
Write-Host "che non manchi nessun file."

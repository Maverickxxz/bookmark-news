# Prepara gli screenshot per il Chrome Web Store:
#   1280x800 esatti, PNG a 24 bit SENZA canale alfa.
#
# L'immagine viene RIDIMENSIONATA per stare dentro il riquadro mantenendo le
# proporzioni (niente stiramenti) e centrata; lo spazio che avanza viene riempito
# con il colore dominante del bordo dell'originale, cosi' la banda non si vede.
# Non taglia nulla: le annotazioni a bordo immagine restano dentro.
#
#   powershell -ExecutionPolicy Bypass -File .\scratchpad\prep-screenshot.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$src = "C:\Users\black\Desktop\bookmark-news\screenshot"
$out = Join-Path $src "store"
$W = 1280
$H = 800

New-Item -ItemType Directory -Force -Path $out | Out-Null

# Colore piu' frequente sul bordo dell'immagine (campionato ogni 4 px).
function Get-BorderColor($bmp) {
  $tally = @{}
  for ($x = 0; $x -lt $bmp.Width; $x += 4) {
    foreach ($y in 0, ($bmp.Height - 1)) {
      $c = $bmp.GetPixel($x, $y)
      $k = "{0},{1},{2}" -f $c.R, $c.G, $c.B
      $tally[$k] = 1 + $tally[$k]
    }
  }
  for ($y = 0; $y -lt $bmp.Height; $y += 4) {
    foreach ($x in 0, ($bmp.Width - 1)) {
      $c = $bmp.GetPixel($x, $y)
      $k = "{0},{1},{2}" -f $c.R, $c.G, $c.B
      $tally[$k] = 1 + $tally[$k]
    }
  }
  $top = $tally.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
  $p = $top.Name.Split(",")
  return [System.Drawing.Color]::FromArgb([int]$p[0], [int]$p[1], [int]$p[2])
}

Get-ChildItem $src -File -Filter *.png | ForEach-Object {
  $srcImg = [System.Drawing.Image]::FromFile($_.FullName)
  try {
    $bg = Get-BorderColor $srcImg

    # scala per ENTRARE nel riquadro (il minore dei due rapporti)
    $scale = [Math]::Min($W / $srcImg.Width, $H / $srcImg.Height)
    $dw = [int][Math]::Round($srcImg.Width * $scale)
    $dh = [int][Math]::Round($srcImg.Height * $scale)
    $dx = [int](($W - $dw) / 2)
    $dy = [int](($H - $dh) / 2)

    # Format24bppRgb = 24 bit senza canale alfa, come richiede lo store
    $canvas = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $g.Clear($bg)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($srcImg, $dx, $dy, $dw, $dh)
    } finally {
      $g.Dispose()
    }

    $dest = Join-Path $out $_.Name
    $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()

    "{0,-8} {1}x{2} -> {3}x{4} in {5}x{6}, bordo #{7:X2}{8:X2}{9:X2}" -f `
      $_.Name, $srcImg.Width, $srcImg.Height, $dw, $dh, $W, $H, $bg.R, $bg.G, $bg.B
  } finally {
    $srcImg.Dispose()
  }
}

# --- verifica sul file scritto, leggendo l'header PNG (IHDR) ------------------
"`n--- verifica ---"
Get-ChildItem $out -File -Filter *.png | ForEach-Object {
  $b = [System.IO.File]::ReadAllBytes($_.FullName)
  $w = [BitConverter]::ToUInt32(($b[19..16]), 0)
  $h = [BitConverter]::ToUInt32(($b[23..20]), 0)
  $depth = $b[24]
  $ctype = $b[25]   # 2 = truecolor RGB senza alfa, 6 = RGBA
  $okSize = ($w -eq 1280 -and $h -eq 800) -or ($w -eq 640 -and $h -eq 400)
  $okFmt = ($depth -eq 8 -and $ctype -eq 2)
  "{0,-8} {1}x{2} bit={3} colortype={4} ({5}) -> {6}" -f `
    $_.Name, $w, $h, $depth, $ctype,
    $(if ($ctype -eq 2) { "RGB senza alfa" } else { "CON alfa" }),
    $(if ($okSize -and $okFmt) { "OK" } else { "NON CONFORME" })
}

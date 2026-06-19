$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot '..\public\icons' | Resolve-Path

function Remove-LightBackground {
  param([System.Drawing.Bitmap]$Bitmap, [int]$Threshold = 210)
  $out = New-Object System.Drawing.Bitmap $Bitmap.Width, $Bitmap.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($x = 0; $x -lt $Bitmap.Width; $x++) {
    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
      $p = $Bitmap.GetPixel($x, $y)
      if ($p.R -ge $Threshold -and $p.G -ge $Threshold -and $p.B -ge $Threshold) {
        $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      } else {
        $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($p.A, $p.R, $p.G, $p.B))
      }
    }
  }
  return $out
}

function Save-Png {
  param([System.Drawing.Image]$Image, [string]$Path)
  $Image.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Resize-Image {
  param([System.Drawing.Image]$Image, [int]$Size)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($Image, 0, 0, $Size, $Size)
  $g.Dispose()
  return $bmp
}

function Save-SvgFromPng {
  param([System.Drawing.Image]$Image, [string]$Path, [string]$Label)
  $ms = New-Object System.IO.MemoryStream
  $Image.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
  $w = $Image.Width
  $h = $Image.Height
  @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $w $h" role="img" aria-label="$Label">
  <image width="$w" height="$h" href="data:image/png;base64,$b64"/>
</svg>
"@ | Set-Content -Path $Path -Encoding UTF8
}

# App icon rond (fond navy, optimisé pour le masque circulaire Android)
$appSrc = Join-Path $iconsDir 'icon-source.png'
if (-not (Test-Path $appSrc)) {
  $appSrc = Join-Path $iconsDir 'icon-source-round.png'
}
$app = [System.Drawing.Image]::FromFile($appSrc)
foreach ($size in @(180, 192, 512)) {
  $scaled = Resize-Image $app $size
  Save-Png $scaled (Join-Path $iconsDir "icon-$size.png")
  Save-SvgFromPng $scaled (Join-Path $iconsDir "icon-$size.svg") 'Matchday'
  if ($size -eq 512) {
    Save-SvgFromPng $scaled (Join-Path $iconsDir 'icon.svg') 'Matchday'
  }
  $scaled.Dispose()
}
$app.Dispose()

# Nav / header icons (fond gris retiré)
$navItems = @(
  @{ Src = 'nav-matches-source.png'; Out = 'nav-matches'; Label = 'Matchs' },
  @{ Src = 'nav-league-source.png'; Out = 'nav-league'; Label = 'Championnats' },
  @{ Src = 'nav-stat-source.png'; Out = 'nav-stat'; Label = 'Classement' },
  @{ Src = 'nav-chat-source.png'; Out = 'nav-chat'; Label = 'Chat' },
  @{ Src = 'nav-user-source.png'; Out = 'nav-user'; Label = 'Profil' },
  @{ Src = 'nav-notif-source.png'; Out = 'icon-notif'; Label = 'Notifications' }
)

foreach ($item in $navItems) {
  $srcPath = Join-Path $iconsDir $item.Src
  if (-not (Test-Path $srcPath)) {
    Write-Warning "Source manquante: $($item.Src)"
    continue
  }
  $raw = [System.Drawing.Bitmap]::FromFile($srcPath)
  $clean = Remove-LightBackground $raw
  $size = 128
  $scaled = Resize-Image $clean $size
  Save-Png $scaled (Join-Path $iconsDir "$($item.Out).png")
  Save-SvgFromPng $scaled (Join-Path $iconsDir "$($item.Out).svg") $item.Label
  $raw.Dispose(); $clean.Dispose(); $scaled.Dispose()
}

Write-Host 'Icones generees dans public/icons/'

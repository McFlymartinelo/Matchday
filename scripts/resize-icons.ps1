Add-Type -AssemblyName System.Drawing
$srcPath = Join-Path $PSScriptRoot '..\public\icons\icon-source.png' | Resolve-Path
$outDir = Join-Path $PSScriptRoot '..\public\icons' | Resolve-Path
$bgColor = [System.Drawing.Color]::FromArgb(255, 11, 21, 36)
$sizes = @(512, 192, 180)

foreach ($size in $sizes) {
  $img = [System.Drawing.Image]::FromFile($srcPath.Path)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear($bgColor)
  $g.DrawImage($img, 0, 0, $size, $size)
  $out = Join-Path $outDir.Path ("icon-{0}.png" -f $size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $img.Dispose()
  Write-Output "Created $out"
}

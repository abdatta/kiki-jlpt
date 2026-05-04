Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$publicDir = Join-Path $root 'public'
$sourceSvg = Join-Path $publicDir 'brand-mark.svg'
$masterPng = Join-Path $publicDir '.brand-icon-master.png'
$renderHtml = Join-Path $publicDir '.brand-icon-render.html'
$iconBackground = [System.Drawing.ColorTranslator]::FromHtml('#251E17')

$edgeCandidates = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) {
  throw 'Microsoft Edge was not found. Install Edge or update this script with a Chromium path.'
}

$svg = Get-Content -LiteralPath $sourceSvg -Raw
$html = @"
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        width: 1024px;
        height: 1024px;
        margin: 0;
        overflow: hidden;
        background: #251E17;
      }

      svg {
        display: block;
        width: 1024px;
        height: 1024px;
        --brand-logo-bg: #251E17;
        --brand-logo-mark: #DCA669;
        --brand-logo-highlight: #EDB476;
        --brand-logo-cutout: transparent;
      }
    </style>
  </head>
  <body>
    $svg
  </body>
</html>
"@

Set-Content -LiteralPath $renderHtml -Value $html -Encoding UTF8
$renderUri = (New-Object System.Uri((Resolve-Path $renderHtml))).AbsoluteUri

& $edge --headless --disable-gpu --hide-scrollbars --screenshot="$masterPng" --window-size=1024,1024 $renderUri | Out-Null
if (-not (Test-Path $masterPng)) {
  throw 'Could not render brand icon master PNG.'
}

function Save-ResizedPng {
  param(
    [System.Drawing.Image] $Source,
    [string] $Name,
    [int] $Size
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear($iconBackground)
  $graphics.DrawImage($Source, 0, 0, $Size, $Size)
  $bitmap.Save((Join-Path $publicDir $Name), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function New-PngBytes {
  param(
    [System.Drawing.Image] $Source,
    [int] $Size
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear($iconBackground)
  $graphics.DrawImage($Source, 0, 0, $Size, $Size)
  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  return $bytes
}

function Test-IconBackgroundPixel {
  param([System.Drawing.Color] $Color)

  $dr = [math]::Abs([int]$Color.R - [int]$iconBackground.R)
  $dg = [math]::Abs([int]$Color.G - [int]$iconBackground.G)
  $db = [math]::Abs([int]$Color.B - [int]$iconBackground.B)
  return (($dr + $dg + $db) -lt 48)
}

function New-TightTransparentPngBytes {
  param(
    [System.Drawing.Image] $Source,
    [int] $Size
  )

  $sourceBitmap = [System.Drawing.Bitmap]::new($Source)
  $left = $sourceBitmap.Width
  $top = $sourceBitmap.Height
  $right = -1
  $bottom = -1

  for ($y = 0; $y -lt $sourceBitmap.Height; $y++) {
    for ($x = 0; $x -lt $sourceBitmap.Width; $x++) {
      $pixel = $sourceBitmap.GetPixel($x, $y)
      if (-not (Test-IconBackgroundPixel $pixel)) {
        if ($x -lt $left) { $left = $x }
        if ($x -gt $right) { $right = $x }
        if ($y -lt $top) { $top = $y }
        if ($y -gt $bottom) { $bottom = $y }
      }
    }
  }

  if ($right -lt $left -or $bottom -lt $top) {
    $sourceBitmap.Dispose()
    throw 'Could not find visible favicon logo pixels.'
  }

  $cropWidth = $right - $left + 1
  $cropHeight = $bottom - $top + 1
  $padding = if ($Size -le 16) { 0 } else { 1 }
  $scale = [math]::Min(($Size - ($padding * 2)) / $cropWidth, ($Size - ($padding * 2)) / $cropHeight)
  $drawWidth = [int][math]::Round($cropWidth * $scale)
  $drawHeight = [int][math]::Round($cropHeight * $scale)
  $drawX = [int][math]::Floor(($Size - $drawWidth) / 2)
  $drawY = [int][math]::Floor(($Size - $drawHeight) / 2)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $destRect = [System.Drawing.Rectangle]::new($drawX, $drawY, $drawWidth, $drawHeight)
  $sourceRect = [System.Drawing.Rectangle]::new($left, $top, $cropWidth, $cropHeight)
  $graphics.DrawImage($sourceBitmap, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)

  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $pixel = $bitmap.GetPixel($x, $y)
      if (Test-IconBackgroundPixel $pixel) {
        $bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
      }
    }
  }

  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $sourceBitmap.Dispose()
  return $bytes
}

function Save-Ico {
  param(
    [System.Drawing.Image] $Source,
    [string] $Name
  )

  $sizes = @(16, 32, 48)
  $images = [System.Collections.Generic.List[byte[]]]::new()
  foreach ($size in $sizes) {
    $images.Add((New-TightTransparentPngBytes $Source $size))
  }
  $path = Join-Path $publicDir $Name
  $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = [System.IO.BinaryWriter]::new($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$sizes.Count)

  $offset = 6 + (16 * $sizes.Count)
  for ($index = 0; $index -lt $sizes.Count; $index++) {
    $size = $sizes[$index]
    $image = $images[$index]
    $writer.Write([byte]$size)
    $writer.Write([byte]$size)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$image.Length)
    $writer.Write([UInt32]$offset)
    $offset += $image.Length
  }

  foreach ($image in $images) {
    $writer.Write($image)
  }

  $writer.Dispose()
  $stream.Dispose()
}

$source = [System.Drawing.Image]::FromFile($masterPng)
Save-ResizedPng $source 'favicon-16x16.png' 16
Save-ResizedPng $source 'favicon-32x32.png' 32
Save-ResizedPng $source 'favicon-48x48.png' 48
Save-ResizedPng $source 'apple-touch-icon-152x152.png' 152
Save-ResizedPng $source 'apple-touch-icon-167x167.png' 167
Save-ResizedPng $source 'apple-touch-icon.png' 180
Save-ResizedPng $source 'icon-180.png' 180
Save-ResizedPng $source 'icon-192.png' 192
Save-ResizedPng $source 'icon-512.png' 512
Save-ResizedPng $source 'maskable-icon.png' 512
Save-Ico $source 'favicon.ico'
$source.Dispose()

Remove-Item -LiteralPath $masterPng, $renderHtml -Force

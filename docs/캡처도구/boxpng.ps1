# boxpng.ps1 - draw red boxes / black masks onto an EXISTING png
#
#   boxpng.ps1 -In shots\13.png -Out shots\13.png -Boxes "x,y,w,h" -Hide "x,y,w,h"
#
# Coordinates are IMAGE pixels (not screen). Use when a box missed because the
# page moved between measuring and shooting, and re-staging the screen is
# expensive - measure off the saved image and redraw.

param(
  [Parameter(Mandatory=$true)][string]$In,
  [string]$Out = "",
  [string]$Boxes = "",
  [string]$Hide = "",
  [int]$Pen = 5
)

Add-Type -AssemblyName System.Drawing
if ($Out -eq "") { $Out = $In }

$src = [System.Drawing.Image]::FromFile((Resolve-Path $In))
$bmp = New-Object System.Drawing.Bitmap $src
$src.Dispose()
$g = [System.Drawing.Graphics]::FromImage($bmp)

function Get-Rects([string]$spec) {
  $list = New-Object 'System.Collections.Generic.List[System.Drawing.Rectangle]'
  if ($spec -eq "") { return ,$list }
  foreach ($chunk in $spec.Split(';')) {
    $t = $chunk.Trim(); if ($t -eq "") { continue }
    $n = @($t.Split(',') | ForEach-Object { [int]$_.Trim() })
    if ($n.Count -ne 4) { throw "bad rect: $t" }
    $list.Add((New-Object System.Drawing.Rectangle -ArgumentList @($n[0], $n[1], $n[2], $n[3])))
  }
  return ,$list
}

$black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
foreach ($r in (Get-Rects $Hide)) { $g.FillRectangle($black, $r) }

$red = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,230,30,45)), $Pen
$red.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Inset
foreach ($r in (Get-Rects $Boxes)) { $g.DrawRectangle($red, $r) }

$g.Dispose()
$tmp = [System.IO.Path]::GetTempFileName() + ".png"
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Move-Item -Force $tmp $Out
Write-Host ("redrew {0}" -f $Out)

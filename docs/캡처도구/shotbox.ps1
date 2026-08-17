# shotbox.ps1 - screen capture with red boxes and black masks
#
#   shotbox.ps1 -Out shot.png -X 0 -Y 0 -W 2000 -H 1500 `
#               -Front "Chrome" `
#               -Boxes "x,y,w,h;x,y,w,h" `   # red rectangles (SCREEN coords)
#               -Hide  "x,y,w,h"             # black fill (SCREEN coords)
#
# NOTE: all coordinates are PHYSICAL pixels. SetProcessDPIAware is called first,
#       otherwise only the top-left quarter of a scaled display is captured.

param(
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [string]$Front = "",
  [string]$Boxes = "",
  [string]$Hide  = "",
  [string]$Cut   = "",
  [switch]$DismissBar,
  [int]$Wait = 500,
  [int]$Pen = 5
)

# -Cut "top,bottom"  removes a horizontal band (SCREEN coords) from the result:
# used to drop Chrome's "Claude is debugging this browser" info bar, which the
# extension re-shows on every attach. Boxes below the band shift up with it,
# so coordinates measured while the bar was visible stay correct.

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);

  // Get-Process only exposes ONE window per process (MainWindowTitle), so with
  // two Chrome windows open -Front would raise the wrong one and we would
  // screenshot a page the browser tools are not driving. Walk every top-level
  // window instead and match on its own title.
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);

  public static IntPtr FindByTitle(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var sb = new System.Text.StringBuilder(512);
      GetWindowTextW(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t.Length > 0 && t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string TitleOf(IntPtr h) {
    var sb = new System.Text.StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@

[void][Win]::SetProcessDPIAware()

# --- the "Claude is debugging this browser" info bar -------------------------
# It reappears on every debugger attach and pushes the page down 126px, so a
# coordinate measured a moment ago lands in the wrong place. Detect it by the
# solid purple Cancel pill and click its X away before shooting.
$BAR_PROBE  = @(1307, 230)   # centre of the Cancel pill
$BAR_CLOSE  = @(1925, 230)   # the X at the right end of the bar

function Test-InfoBar {
  $b = New-Object System.Drawing.Bitmap(1, 1)
  $gg = [System.Drawing.Graphics]::FromImage($b)
  $gg.CopyFromScreen($BAR_PROBE[0], $BAR_PROBE[1], 0, 0, (New-Object System.Drawing.Size(1, 1)))
  $gg.Dispose()
  $px = $b.GetPixel(0, 0)
  $b.Dispose()
  # Judge by HUE, not brightness. A modal's grey scrim is dark too, and a
  # brightness test clicked it away - closing the dialog we were shooting.
  # The Cancel pill is solidly purple: red and blue both well above green.
  $purple = (($px.R - $px.G) -gt 25) -and (($px.B - $px.G) -gt 25)
  return @{ present = $purple; rgb = ("{0},{1},{2}" -f $px.R, $px.G, $px.B) }
}

function Invoke-DismissBar {
  $t = Test-InfoBar
  if ($t.present) {
    [void][Win]::SetCursorPos($BAR_CLOSE[0], $BAR_CLOSE[1])
    Start-Sleep -Milliseconds 150
    # Check again with the pointer already parked. The bar can vanish on its
    # own in that gap, and then this click lands on the console's account
    # avatar and opens a menu showing the account name and email.
    if (-not (Test-InfoBar).present) {
      [void][Win]::SetCursorPos(20, 1570)
      Write-Host "info bar went away before the click - not clicking"
      return
    }
    [Win]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [Win]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 500
    # Park the cursor again. The X sits right under the console's account
    # avatar, and leaving the pointer there pops a tooltip with the account
    # email into the screenshot.
    [void][Win]::SetCursorPos(20, 1570)
    Start-Sleep -Milliseconds 900
    $after = Test-InfoBar
    Write-Host ("info bar dismissed (was {0}, now {1})" -f $t.rgb, $after.rgb)
    if ($after.present) { throw "info bar still up - do not trust the coordinates" }
  } else {
    Write-Host ("info bar not up (rgb {0})" -f $t.rgb)
  }
}

# --- bring a window to the front -------------------------------------------
if ($Front -ne "") {
  $hwnd = [Win]::FindByTitle($Front)
  if ($hwnd -ne [IntPtr]::Zero) {
    [void][Win]::ShowWindow($hwnd, 9)   # SW_RESTORE
    [void][Win]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 450
    Write-Host ("front: {0}" -f [Win]::TitleOf($hwnd))
  } else {
    throw "front window not found: $Front"
  }
}

# --- region -----------------------------------------------------------------
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($W -le 0) { $W = $vs.Width }
if ($H -le 0) { $H = $vs.Height }

# park the cursor out of the way
[void][Win]::SetCursorPos(20, [Math]::Max(10, $vs.Height - 30))
Start-Sleep -Milliseconds $Wait

# Dismiss AFTER the wait, not before: the bar comes back while we are waiting
# out the extension's glow, so an early check reports "not up" and the bar is
# in the shot anyway.
if ($DismissBar) { Invoke-DismissBar }

# --- capture ----------------------------------------------------------------
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))

# "x,y,w,h;x,y,w,h" (screen coords) -> Rectangle list in capture-local coords.
# Returns Rectangle objects, not int arrays: a nested array would be flattened
# on return and the caller would iterate over loose integers.
function Get-Rects([string]$spec) {
  $out = New-Object 'System.Collections.Generic.List[System.Drawing.Rectangle]'
  if ($spec -eq "") { return ,$out }
  foreach ($chunk in $spec.Split(';')) {
    $t = $chunk.Trim()
    if ($t -eq "") { continue }
    $n = @($t.Split(',') | ForEach-Object { [int]$_.Trim() })
    if ($n.Count -ne 4) { throw "bad rect: $t (need x,y,w,h)" }
    $rx = $n[0] - $X
    $ry = $n[1] - $Y
    $out.Add((New-Object System.Drawing.Rectangle -ArgumentList @($rx, $ry, $n[2], $n[3])))
  }
  return ,$out
}

# black masks first, so a red box can sit on top of a masked area
$black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
foreach ($r in (Get-Rects $Hide)) {
  $g.FillRectangle($black, $r)
}

$red = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,230,30,45)), $Pen
$red.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Inset
foreach ($r in (Get-Rects $Boxes)) {
  $g.DrawRectangle($red, $r)
}

$g.Dispose()

# --- cut the info-bar band out ----------------------------------------------
if ($Cut -ne "") {
  $c = @($Cut.Split(',') | ForEach-Object { [int]$_.Trim() })
  if ($c.Count -ne 2) { throw "bad -Cut: $Cut (need top,bottom)" }
  $ct = $c[0] - $Y
  $cb = $c[1] - $Y
  $band = $cb - $ct
  if ($ct -lt 0 -or $cb -gt $H -or $band -le 0) { throw "-Cut band outside the capture region" }

  $out2 = New-Object System.Drawing.Bitmap($W, ($H - $band))
  $g2   = [System.Drawing.Graphics]::FromImage($out2)
  $srcTop = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $W, $ct)
  $g2.DrawImage($bmp, $srcTop, $srcTop, [System.Drawing.GraphicsUnit]::Pixel)
  $srcBot = New-Object System.Drawing.Rectangle -ArgumentList @(0, $cb, $W, ($H - $cb))
  $dstBot = New-Object System.Drawing.Rectangle -ArgumentList @(0, $ct, $W, ($H - $cb))
  $g2.DrawImage($bmp, $dstBot, $srcBot, [System.Drawing.GraphicsUnit]::Pixel)
  $g2.Dispose()
  $bmp.Dispose()
  $bmp = $out2
}

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host ("saved {0}  ({1}x{2} at {3},{4})" -f $Out, $W, $H, $X, $Y)

# click.ps1 - a real mouse click at SCREEN coordinates (physical pixels)
#
#   click.ps1 -X 1925 -Y 298
#
# The page-level browser tools cannot reach Chrome's own UI (tab strip, the
# debug info bar, the address bar). This can.

param(
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [int]$Wait = 300
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Clk {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  public const uint DOWN = 0x0002, UP = 0x0004;
}
"@

[void][Clk]::SetProcessDPIAware()
[void][Clk]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 200
[Clk]::mouse_event([Clk]::DOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Clk]::mouse_event([Clk]::UP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds $Wait
Write-Host ("clicked {0},{1}" -f $X, $Y)

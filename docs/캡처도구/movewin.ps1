# movewin.ps1 - move/resize a window, physical pixels
#
#   movewin.ps1 -Title "Chrome" -X 0 -Y 0 -W 2000 -H 1500
#
# Pick a window size ONCE and keep it for the whole capture run.
# If it changes mid-run every coordinate has to be measured again.

param(
  [Parameter(Mandatory=$true)][string]$Title,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 2000,
  [int]$H = 1500
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinMove {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

[void][WinMove]::SetProcessDPIAware()

$p = Get-Process | Where-Object {
      $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" } |
     Select-Object -First 1

if (-not $p) {
  Write-Host "window not found: $Title"
  Get-Process | Where-Object { $_.MainWindowTitle } |
    Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize
  exit 1
}

# NOTE: do NOT name this $h - PowerShell variables are case-insensitive and it
#       would silently overwrite the -H (height) parameter.
$hwnd = $p.MainWindowHandle
[void][WinMove]::ShowWindow($hwnd, 9)       # SW_RESTORE (undo maximize)
Start-Sleep -Milliseconds 400
[void][WinMove]::MoveWindow($hwnd, $X, $Y, $W, $H, $true)
[void][WinMove]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 250

$r = New-Object WinMove+RECT
[void][WinMove]::GetWindowRect($hwnd, [ref]$r)
Write-Host ("{0} -> {1},{2} {3}x{4}" -f $p.MainWindowTitle, $r.Left, $r.Top, ($r.Right-$r.Left), ($r.Bottom-$r.Top))

# key.ps1 - send a keystroke to Chrome's own UI (SendKeys syntax)
#
#   key.ps1 -Keys "^+b"        # Ctrl+Shift+B  (toggle the bookmarks bar)
#   key.ps1 -Keys "^l"         # focus the address bar
#
# Page-level tools reach the renderer only; browser shortcuts need this.

param(
  [Parameter(Mandatory=$true)][string]$Keys,
  [string]$Title = "Chrome",
  [int]$Wait = 400
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Kb {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@

[void][Kb]::SetProcessDPIAware()

$p = Get-Process | Where-Object {
      $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" } |
     Select-Object -First 1
if (-not $p) { Write-Host "window not found: $Title"; exit 1 }

[void][Kb]::ShowWindow($p.MainWindowHandle, 9)
[void][Kb]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 350

[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds $Wait
Write-Host ("sent {0} to {1}" -f $Keys, $p.MainWindowTitle)

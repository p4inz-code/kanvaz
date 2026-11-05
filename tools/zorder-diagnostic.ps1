<#
  Kanvaz z-order diagnostic (Windows).

  Use it when Kanvaz is covered by another app (for example ZBrush) even though Always on top is on.
  It lists every visible top-level window from the top of the screen stack downwards, and says for
  each one: is it TOPMOST, does it cover a whole monitor, is it layered, which process owns it.
  Then it tells you where Kanvaz sits compared with the app you name.

  Run it while the problem is happening:
      powershell -ExecutionPolicy Bypass -File tools\zorder-diagnostic.ps1 -App ZBrush
  Optional: -Watch 10   samples every half second for 10 seconds and reports how often Kanvaz was above the app.

  It only reads window information. It changes nothing and sends nothing anywhere.
#>
param(
  [string]$App = 'ZBrush',
  [string]$Kanvaz = 'Kanvaz',
  [int]$Watch = 0
)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ZOrder {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cb; public RECT mon; public RECT work; public uint flags; }

  public class Win {
    public IntPtr H; public int Z; public bool Topmost, Layered, ToolWindow, NoActivate, FullMonitor, Cloaked, Foreground;
    public string Title, Class; public uint Pid; public int W, Ht;
  }

  public static List<Win> List() {
    var res = new List<Win>();
    int z = 0;
    IntPtr fg = GetForegroundWindow();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      z++;
      if (!IsWindowVisible(h)) return true;
      int ex = GetWindowLong(h, -20);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      var mi = new MONITORINFO(); mi.cb = Marshal.SizeOf(typeof(MONITORINFO));
      bool full = false;
      IntPtr mon = MonitorFromWindow(h, 2);
      if (mon != IntPtr.Zero && GetMonitorInfo(mon, ref mi)) {
        full = r.L <= mi.mon.L && r.T <= mi.mon.T && r.R >= mi.mon.R && r.B >= mi.mon.B;
      }
      res.Add(new Win {
        H = h, Z = z, Topmost = (ex & 0x8) != 0, Layered = (ex & 0x80000) != 0, ToolWindow = (ex & 0x80) != 0, NoActivate = (ex & 0x08000000) != 0,
        FullMonitor = full, Cloaked = cloaked != 0, Foreground = h == fg, Title = t.ToString(), Class = c.ToString(), Pid = pid, W = r.R - r.L, Ht = r.B - r.T
      });
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
'@

function Get-Snapshot {
  $procs = @{}
  Get-Process | ForEach-Object { $procs[[uint32]$_.Id] = $_.ProcessName }
  $rows = [ZOrder]::List() | Where-Object { -not $_.Cloaked -and $_.W -gt 0 -and $_.Ht -gt 0 } | ForEach-Object {
    $_ | Add-Member -NotePropertyName Proc -NotePropertyValue ($procs[$_.Pid]) -PassThru
  }
  return $rows
}

function Find-App($rows, $name) {
  $rows | Where-Object { $_.Proc -and ($_.Proc -match $name -or $_.Title -match $name) -and $_.Title -ne '' } | Sort-Object Z | Select-Object -First 1
}

if ($Watch -gt 0) {
  Write-Host "Sampling every 0.5 s for $Watch s. Keep the problem on screen..." -ForegroundColor Cyan
  $above = 0; $total = 0
  $end = (Get-Date).AddSeconds($Watch)
  while ((Get-Date) -lt $end) {
    $rows = Get-Snapshot
    $k = Find-App $rows $Kanvaz; $a = Find-App $rows $App
    if ($k -and $a) { $total++; if ($k.Z -lt $a.Z) { $above++ } }
    Start-Sleep -Milliseconds 500
  }
  if ($total -eq 0) { Write-Host "Could not find both windows (Kanvaz: '$Kanvaz', app: '$App')." -ForegroundColor Yellow }
  else { Write-Host ("Kanvaz was above {0} in {1} of {2} samples ({3}%)." -f $App, $above, $total, [math]::Round(100 * $above / $total)) }
  return
}

$rows = Get-Snapshot
Write-Host "`nVisible top-level windows, top of the screen stack first:" -ForegroundColor Cyan
$rows | Select-Object -First 25 | ForEach-Object {
  $flags = @()
  if ($_.Foreground) { $flags += 'FOREGROUND' }
  if ($_.Topmost) { $flags += 'TOPMOST' }
  if ($_.FullMonitor) { $flags += 'FILLS-MONITOR' }
  if ($_.Layered) { $flags += 'layered' }
  if ($_.ToolWindow) { $flags += 'toolwindow' }
  if ($_.NoActivate) { $flags += 'noactivate' }
  $title = if ($_.Title.Length -gt 48) { $_.Title.Substring(0, 48) + '...' } else { $_.Title }
  '{0,3}  {1,-22} {2,-26} {3}  [{4}]' -f $_.Z, $_.Proc, $_.Class, $title, ($flags -join ' ')
}

$k = Find-App $rows $Kanvaz
$a = Find-App $rows $App
Write-Host "`nSummary" -ForegroundColor Cyan
if (-not $k) { Write-Host "  Kanvaz window not found (looking for '$Kanvaz'). Is it running and visible?" -ForegroundColor Yellow }
else { Write-Host ("  Kanvaz: stack position {0}, TOPMOST={1}, class {2}" -f $k.Z, $k.Topmost, $k.Class) }
if (-not $a) { Write-Host "  '$App' window not found." -ForegroundColor Yellow }
else { Write-Host ("  {0}: stack position {1}, TOPMOST={2}, FILLS-MONITOR={3}, layered={4}, class {5}" -f $App, $a.Z, $a.Topmost, $a.FullMonitor, $a.Layered, $a.Class) }
if ($k -and $a) {
  if ($k.Z -lt $a.Z) { Write-Host "  Kanvaz IS above $App in the window stack right now." -ForegroundColor Green }
  else {
    Write-Host "  Kanvaz is BELOW $App in the window stack." -ForegroundColor Red
    if ($a.Topmost -and $k.Topmost) { Write-Host "  Both are TOPMOST: $App has taken the top of the topmost band. Kanvaz should re-raise within half a second." }
    elseif ($a.Topmost -and -not $k.Topmost) { Write-Host "  $App is TOPMOST but Kanvaz is not: Always on top is not active on Kanvaz right now." }
    elseif (-not $a.Topmost -and -not $k.Topmost) { Write-Host "  Neither is TOPMOST. Always on top is not active on Kanvaz." }
    else { Write-Host "  Kanvaz is TOPMOST yet below a normal $App window: something other than window order is hiding it (see FILLS-MONITOR above). Please send this output." }
  }
}
Write-Host "`nSend this whole output to the developer. It contains window titles, so skim it first." -ForegroundColor DarkGray

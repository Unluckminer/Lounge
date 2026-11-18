# Erkennt doppeltes Esc (global, blockiert die Taste nicht) und meldet "ESC2" an den Launcher
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class K { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v); }
"@
$prev = $false
$last = [DateTime]::MinValue
while ($true) {
  $down = ([K]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0
  if ($down -and -not $prev) {
    $now = [DateTime]::UtcNow
    if (($now - $last).TotalMilliseconds -lt 700) {
      [Console]::Out.WriteLine('ESC2'); [Console]::Out.Flush()
      $last = [DateTime]::MinValue
    } else { $last = $now }
  }
  $prev = $down
  Start-Sleep -Milliseconds 15
}

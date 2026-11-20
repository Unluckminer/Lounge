# Nimmt Befehle per stdin entgegen und simuliert Tastatur/Maus (kein natives Node-Modul noetig)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class I {
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct IN { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KI ki; [FieldOffset(32)] public ulong pad; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, IN[] i, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  public static void Text(string s) {
    foreach (char c in s) {
      IN[] a = new IN[2];
      a[0].type = 1; a[0].ki.scan = c; a[0].ki.flags = 4;
      a[1].type = 1; a[1].ki.scan = c; a[1].ki.flags = 6;
      SendInput(2, a, Marshal.SizeOf(typeof(IN)));
    }
  }
}
"@

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h) && GetWindowTextLength(h) > 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$KEYS = @{
  Up=@(0x26,1); Down=@(0x28,1); Left=@(0x25,1); Right=@(0x27,1); Enter=@(0x0D,0); Esc=@(0x1B,0)
  Tab=@(0x09,0); Space=@(0x20,0); Backspace=@(0x08,0); Delete=@(0x2E,1); Home=@(0x24,1); End=@(0x23,1)
  Apps=@(0x5D,1); Win=@(0x5B,1); F=@(0x46,0); F11=@(0x7A,0)
  VolUp=@(0xAF,0); VolDown=@(0xAE,0); Mute=@(0xAD,0); PlayPause=@(0xB3,0); Next=@(0xB0,0); Prev=@(0xB1,0)
}
function Tap($name) {
  $k = $KEYS[$name]; if (-not $k) { return }
  $e = [uint32]$k[1]
  [I]::keybd_event([byte]$k[0], 0, $e, [UIntPtr]::Zero)
  [I]::keybd_event([byte]$k[0], 0, ($e -bor 2), [UIntPtr]::Zero)
}
function Alt($down) { $f = 0; if (-not $down) { $f = 2 }; [I]::keybd_event(0x12, 0, [uint32]$f, [UIntPtr]::Zero) }

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(' ', 3)
  try {
    switch ($p[0]) {
      'key'    { Tap $p[1] }
      'front'  { $h = [W]::Find([uint32]$p[1]); if ($h -ne [IntPtr]::Zero) { [W]::ShowWindow($h, 9) | Out-Null; [W]::SetForegroundWindow($h) | Out-Null } }
      'place'  {
        # place <pid> max   |   place <pid> rect <x> <y> <breite> <hoehe>   (Fenster eines laufenden Programms maximieren oder platzieren)
        $h = [W]::Find([uint32]$p[1]); if ($h -eq [IntPtr]::Zero) { $h = [W]::GetForegroundWindow() }
        $a = $p[2].Split(' ')
        if ($a[0] -eq 'max') { [W]::ShowWindow($h, 3) | Out-Null }
        elseif ($a[0] -eq 'rect') { [W]::ShowWindow($h, 9) | Out-Null; [W]::MoveWindow($h, [int]$a[1], [int]$a[2], [int]$a[3], [int]$a[4], $true) | Out-Null }
        [W]::SetForegroundWindow($h) | Out-Null
      }
      'alttab' { Alt $true; Tap 'Tab'; Alt $false }
      'altleft' { Alt $true; Tap 'Left'; Alt $false }
      'altf4'  { Alt $true; [I]::keybd_event(0x73, 0, 0, [UIntPtr]::Zero); [I]::keybd_event(0x73, 0, 2, [UIntPtr]::Zero); Alt $false }
      'text'   {
        $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))
        $parts = $t -split "`r?`n"
        for ($i = 0; $i -lt $parts.Count; $i++) {
          if ($i -gt 0) { Tap 'Enter' }
          if ($parts[$i]) { [I]::Text($parts[$i]) }
        }
      }
      'move'   { [I]::mouse_event(1, [int]$p[1], [int]$p[2], 0, [UIntPtr]::Zero) }
      'click'  {
        if ($p[1] -eq 'r') { [I]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero); [I]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero) }
        else { [I]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [I]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
      }
      'scroll' { [I]::mouse_event(0x800, 0, 0, [int]$p[1], [UIntPtr]::Zero) }
    }
  } catch { }
}

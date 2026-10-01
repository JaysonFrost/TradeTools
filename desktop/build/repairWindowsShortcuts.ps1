param(
  [Parameter(Mandatory=$true)][string]$AppDataDir,
  [Parameter(Mandatory=$true)][string]$BackupDir,
  [Parameter(Mandatory=$true)][string]$ExecutablePath,
  [Parameter(Mandatory=$true)][string]$CanonicalShortcutPath,
  [string]$AppId = 'com.tradetools.desktop'
)
$ErrorActionPreference = 'Stop'
$programs = Join-Path $AppDataDir 'Microsoft\Windows\Start Menu\Programs'
$pins = Join-Path $AppDataDir 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$canonical = $CanonicalShortcutPath
$explorerShell = New-Object -ComObject Shell.Application
$linkShell = New-Object -ComObject WScript.Shell

function Get-LegacyLinks([string]$directory) {
  if (!(Test-Path -LiteralPath $directory)) { return }
  foreach ($file in Get-ChildItem -LiteralPath $directory -Filter '*.lnk' -File) {
    try {
      $item = $explorerShell.NameSpace($directory).ParseName($file.Name)
      if ($item.ExtendedProperty('System.AppUserModel.ID') -ne $AppId) { continue }
      $link = $linkShell.CreateShortcut($file.FullName)
      if ([IO.Path]::GetFileName($link.TargetPath) -ieq 'electron.exe' -or
          ($file.Name -ieq 'Electron.lnk' -and $link.TargetPath -ieq $ExecutablePath)) {
        $file.FullName
      }
    } catch {
      # An unreadable shortcut must not prevent repairing other links.
      Write-Warning "Cannot inspect shortcut: $($file.Name)"
    }
  }
}

$legacyPins = @(Get-LegacyLinks $pins)
$legacyAliases = @(Get-LegacyLinks $programs)
if ($legacyPins.Count + $legacyAliases.Count -eq 0) { return }
if (!(Test-Path -LiteralPath $canonical)) { throw 'The TradeTools Start menu shortcut must exist before migration' }
$canonicalItem = $explorerShell.NameSpace((Split-Path -Parent $canonical)).ParseName((Split-Path -Leaf $canonical))
if ($canonicalItem.ExtendedProperty('System.AppUserModel.ID') -ne $AppId -or
    $linkShell.CreateShortcut($canonical).TargetPath -ine $ExecutablePath) {
  throw 'The replacement shortcut does not match the installed application'
}
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# Use the supported uninstallation API, rather than editing Explorer's cached pin registry.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TradeToolsShortcutRepair {
  [ComImport, Guid("4CD19ADA-25A5-4A32-B3B7-347BEE5BE36B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IStartMenuPinnedList {
    void RemoveFromList(IntPtr item);
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IntPtr item);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern void SHChangeNotify(uint eventId, uint flags, string first, IntPtr second);
  public static void Unpin(string path) {
    var iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
    IntPtr item;
    SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out item);
    var pinned = (IStartMenuPinnedList)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("A2A9545D-A0C2-42B4-9708-A0B2BADD77C8")));
    try { pinned.RemoveFromList(item); }
    finally { Marshal.Release(item); Marshal.ReleaseComObject(pinned); }
  }
}
'@

function Remove-LegacyLink([string]$path, [bool]$unpin) {
  if (!(Test-Path -LiteralPath $path)) { return }
  Copy-Item -LiteralPath $path -Destination (Join-Path $BackupDir (([Guid]::NewGuid().ToString()) + '.lnk'))
  if ($unpin) { [TradeToolsShortcutRepair]::Unpin($path) }
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
  [TradeToolsShortcutRepair]::SHChangeNotify(4, 0x1005, $path, [IntPtr]::Zero)
}

foreach ($path in $legacyPins) { Remove-LegacyLink $path $true }
# Unpinning can restore the cached Electron alias. Read the Start menu again afterwards.
foreach ($path in @(Get-LegacyLinks $programs)) { Remove-LegacyLink $path $true }
[TradeToolsShortcutRepair]::SHChangeNotify(0x2000, 0x1005, $canonical, [IntPtr]::Zero)
[TradeToolsShortcutRepair]::SHChangeNotify(0x1000, 0x1005, $programs, [IntPtr]::Zero)
Write-Output 'Removed legacy Electron shortcuts; TradeTools can be pinned again.'

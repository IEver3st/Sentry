param([ValidateSet('Install','Remove')][string]$Action = 'Install')
$ErrorActionPreference = 'Stop'
$sentryConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'service-config.json') -Raw | ConvertFrom-Json
if ($sentryConfig.name -notmatch '^Sentry-[a-f0-9]{16}$') { throw 'Invalid Sentry service identity.' }
$sentryIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sentryPrincipal = New-Object Security.Principal.WindowsPrincipal($sentryIdentity)
if (-not $sentryPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this setup from an administrator PowerShell window.' }
if ($Action -eq 'Remove') {
  $sentryService = Get-Service -Name $sentryConfig.name -ErrorAction SilentlyContinue
  if ($sentryService) { Stop-Service -Name $sentryConfig.name; & sc.exe delete $sentryConfig.name; if ($LASTEXITCODE -ne 0) { throw 'Service removal failed.' } }
  Write-Output 'Service removed. Reopen Sentry for desktop protection. Backup files and settings were preserved.'
  exit
}
if (Get-Service -Name $sentryConfig.name -ErrorAction SilentlyContinue) { throw 'This service already exists. Remove it before reinstalling.' }
if (-not (Test-Path -LiteralPath $sentryConfig.executable -PathType Leaf)) { throw 'Install Sentry at a stable location before setting up the service.' }
Write-Output 'Quit Sentry before continuing. The service must use the same Windows account that created its repository credentials.'
$sentryCredential = Get-Credential -Message 'Windows account used for Sentry (account password, not Windows Hello PIN)'
if (-not $sentryCredential) { throw 'Setup cancelled.' }
$sentryAccount = New-Object Security.Principal.NTAccount($sentryCredential.UserName)
$sentrySid = $sentryAccount.Translate([Security.Principal.SecurityIdentifier])
$sentryDataOwner = (Get-Acl -LiteralPath $sentryConfig.data).Owner
$sentryOwnerSid = (New-Object Security.Principal.NTAccount($sentryDataOwner)).Translate([Security.Principal.SecurityIdentifier])
if ($sentrySid.Value -ne $sentryOwnerSid.Value) { throw 'Use the Windows account that owns the Sentry data folder. No service was installed.' }
# Grant only this account Log on as a service. Never export or pass its password to a process.
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class SentryLogonRight {
 [StructLayout(LayoutKind.Sequential)] struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
 [StructLayout(LayoutKind.Sequential)] struct LSA_UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }
 [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref LSA_OBJECT_ATTRIBUTES attributes, uint access, out IntPtr handle);
 [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LSA_UNICODE_STRING[] rights, uint count);
 [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr handle);
 [DllImport("advapi32.dll")] static extern uint LsaNtStatusToWinError(uint status);
 public static void Grant(string sidText) {
  var attributes = new LSA_OBJECT_ATTRIBUTES(); attributes.Length = Marshal.SizeOf(attributes);
  IntPtr handle; uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x810, out handle);
  if (status != 0) throw new System.ComponentModel.Win32Exception((int)LsaNtStatusToWinError(status));
  var sid = new SecurityIdentifier(sidText); var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
  string name = "SeServiceLogonRight"; var right = new LSA_UNICODE_STRING { Length = (ushort)(name.Length * 2), MaximumLength = (ushort)((name.Length + 1) * 2), Buffer = Marshal.StringToHGlobalUni(name) };
  try { status = LsaAddAccountRights(handle, bytes, new[] { right }, 1); if (status != 0) throw new System.ComponentModel.Win32Exception((int)LsaNtStatusToWinError(status)); }
  finally { Marshal.FreeHGlobal(right.Buffer); LsaClose(handle); }
 }
}
'@
[SentryLogonRight]::Grant($sentrySid.Value)
$sentryInstall = Join-Path $env:ProgramData $sentryConfig.name
if (Test-Path -LiteralPath $sentryInstall) { throw 'The service setup folder already exists. Preserve and inspect it before reinstalling.' }
New-Item -ItemType Directory -Path $sentryInstall | Out-Null
& icacls.exe $sentryInstall '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*' + $sentrySid.Value + ':(OI)(CI)RX') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict service configuration permissions.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'SentryService.exe') -Destination $sentryInstall
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'service-config.json') -Destination $sentryInstall
$sentryHost = Join-Path $sentryInstall 'SentryService.exe'
try {
  New-Service -Name $sentryConfig.name -BinaryPathName ('"' + $sentryHost + '"') -DisplayName 'Sentry backup protection' -StartupType Automatic -Credential $sentryCredential | Out-Null
  & sc.exe failure $sentryConfig.name reset= 86400 actions= restart/60000/restart/120000
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure service recovery.' }
  Start-Service -Name $sentryConfig.name
  Write-Output 'Service started. Reopen Sentry and check Settings > Recovery. Test a backup and recovery before relying on signed-out protection.'
} catch { Write-Error 'Service setup did not complete. Inspect the service in Windows Services; backups and credentials were preserved.'; throw }
finally { $sentryCredential = $null }

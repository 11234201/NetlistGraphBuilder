param(
  [Parameter(Mandatory=$true)][int]$ExpectedPid,
  [Parameter(Mandatory=$true)][string]$PipeName,
  [string]$SessionDirectory
)
$ErrorActionPreference = 'Stop'
if ($SessionDirectory) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($path in @($SessionDirectory, (Join-Path $SessionDirectory 'force-owner.json'))) {
    $acl = if ($path -eq $SessionDirectory) { [IO.Directory]::GetAccessControl($path) } else { [IO.File]::GetAccessControl($path) }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Unexpected session owner' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid) { throw 'Session is not private' }
    }
  }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class NgBTarget {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern SafeProcessHandle OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool TerminateProcess(SafeProcessHandle process, uint exitCode);
}
'@
# Holding a process handle prevents PID reuse between peer verification and termination.
$target = [NgBTarget]::OpenProcess(1, $false, $ExpectedPid)
try {
  if ($target.IsInvalid) { throw 'Cannot open the expected process for termination' }
  $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [IO.Pipes.PipeDirection]::InOut)
  try {
    $pipe.Connect(2000)
    [uint32]$serverPid = 0
    if (!([NgBTarget]::GetNamedPipeServerProcessId($pipe.SafePipeHandle, [ref]$serverPid)) -or
        $serverPid -ne $ExpectedPid) { throw 'Named pipe server PID does not match' }
    if (!([NgBTarget]::TerminateProcess($target, 1))) { throw 'Verified process could not be terminated' }
  } finally { $pipe.Dispose() }
} finally { $target.Dispose() }

# Resolve only the temporary cmd /c wrapper; never emit its command line.
param([ValidateRange(1, 2147483647)][int]$ParentProcessId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
try {
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$ParentProcessId"
  $caller = $ParentProcessId
  # The Windows Python launcher stays between cmd and its selected interpreter.
  if ($env:NGB_LAUNCHER_PY -eq '1' -and $parent -and $parent.Name -ieq 'py.exe') {
    $caller = [int]$parent.ParentProcessId
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$caller"
  }
  if (-not $parent) { $caller = 0 }
  elseif ($parent.Name -ieq 'cmd.exe') {
    $switches = [regex]::Replace($parent.CommandLine, '^\s*(?:"[^"]*"|\S+)\s*', '')
    # /c must be a shell switch before the command, never a substring of a path.
    if ($switches -match '(?i)^(?:/(?:d|s|q|a|u|e:on|e:off|f:on|f:off|v:on|v:off)\s+)*/c(?=\s|"|$)') {
      $caller = [int]$parent.ParentProcessId
      if ($caller -gt 0 -and -not (Get-CimInstance Win32_Process -Filter "ProcessId=$caller")) { $caller = 0 }
    }
  }
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{ pid = $caller }))
} catch {
  $message = $_.Exception.Message
  $stack = [string]$_.ScriptStackTrace + "`n" + [string]$_.Exception.StackTrace
  $failure = @{ error = @{ name = $_.Exception.GetType().Name; code = 'PARENT_WATCH_FAILED'
    message = $message.Substring(0, [Math]::Min(4096, $message.Length))
    stack = $stack.Substring(0, [Math]::Min(8192, $stack.Length)) } }
  if ($_.Exception.InnerException) {
    $cause = $_.Exception.InnerException
    $failure.error.cause = @{ name = $cause.GetType().Name
      message = $cause.Message.Substring(0, [Math]::Min(4096, $cause.Message.Length)) }
  }
  [Console]::WriteLine((ConvertTo-Json -Depth 4 -Compress -InputObject $failure))
}

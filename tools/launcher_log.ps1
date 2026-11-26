# Fixed bootstrap diagnostics only; never receive or log the user's arguments.
param([ValidateSet('node', 'python', 'invalid', 'missing')][string]$Event)
$ErrorActionPreference = 'Stop'
$isFailure = $Event -eq 'invalid' -or $Event -eq 'missing'
$message = switch ($Event) {
  'node' { 'Starting Node workbench server' }
  'python' { 'Starting Python workbench server' }
  'invalid' { 'NGB_RUNTIME must be auto, node or python.' }
  'missing' { 'No compatible runtime: install working Node.js 18+ or Python 3.6+; check NGB_RUNTIME if set.' }
}
$details = @{ operation = 'bootstrap' }
if ($isFailure) {
  $details.code = if ($Event -eq 'invalid') { 'INVALID_RUNTIME' } else { 'RUNTIME_UNAVAILABLE' }
  $details.error = @{ name = 'BootstrapError'; message = $message }
}
$record = @{
  time = [DateTime]::UtcNow.ToString('o'); runtime = 'windows'; pid = $PID
  level = $(if ($isFailure) { 'error' } else { 'info' })
  event = $(if ($isFailure) { 'bootstrap.failed' } else { 'runtime.selected' })
  message = $message; details = $details
}
$line = ConvertTo-Json -InputObject $record -Depth 5 -Compress
try {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [IO.Path]::GetTempPath() }
  $directory = if ($env:NGB_LOG_DIR) { $env:NGB_LOG_DIR } else { Join-Path $base 'netlist_graph_builder/logs' }
  $directory = [IO.Path]::GetFullPath($directory)
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $prefix = Join-Path $directory "windows-$stamp-$PID"
  $encoding = New-Object Text.UTF8Encoding $false
  [IO.File]::WriteAllText("$prefix.run.jsonl", "$line`n", $encoding)
  [IO.File]::WriteAllText("$prefix.error.jsonl", $(if ($isFailure) { "$line`n" } else { '' }), $encoding)
} catch {
  $exception = $_.Exception
  $stack = [string]$_.ScriptStackTrace + "`n" + [string]$exception.StackTrace
  $original = @{ name = $exception.GetType().Name
    message = $exception.Message.Substring(0, [Math]::Min(4096, $exception.Message.Length))
    stack = $stack.Substring(0, [Math]::Min(8192, $stack.Length)) }
  if ($exception.InnerException) {
    $cause = $exception.InnerException
    $original.cause = @{ name = $cause.GetType().Name
      message = $cause.Message.Substring(0, [Math]::Min(4096, $cause.Message.Length)) }
  }
  $failure = @{
    time = [DateTime]::UtcNow.ToString('o'); runtime = 'windows'; pid = $PID
    level = 'error'; event = 'log.write_failed'; message = 'File logging unavailable; continuing on stderr'
    details = @{ operation = 'bootstrap'; code = 'LOG_WRITE_FAILED'; error = $original }
  }
  try { [Console]::Error.WriteLine((ConvertTo-Json -InputObject $failure -Depth 5 -Compress)) } catch { }
}
try { [Console]::Error.WriteLine($line) } catch { }

param(
  [switch]$SkipTests,
  [string]$PackageSuffix = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageJson = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$version = [string]$packageJson.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "package.json contains an invalid release version: $version"
}

$distRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "dist"))
$packageName = "NetlistGraphBuilder-v$version-win-x64"
if ($PackageSuffix) {
  if ($PackageSuffix -notmatch '^[a-z0-9-]+$') { throw "PackageSuffix must use lowercase letters, digits and hyphens." }
  $packageName += "-$PackageSuffix"
}
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $distRoot $packageName))
$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $distRoot ".build-$packageName"))
$zipPath = Join-Path $distRoot "$packageName.zip"
$checksumPath = "$zipPath.sha256"

function Assert-BuildPath([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $prefix = $distRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside dist: $resolved"
  }
}

function Reset-BuildPath([string]$Path) {
  Assert-BuildPath $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Get-AssetHash([string]$Path) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $assetStream = [System.IO.File]::OpenRead($Path)
    try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($assetStream))).Replace("-", "").ToLowerInvariant() }
    finally { $assetStream.Dispose() }
  } finally { $algorithm.Dispose() }
}

function Start-DrainedProcess([System.Diagnostics.ProcessStartInfo]$Info) {
  $Info.UseShellExecute = $false
  $Info.CreateNoWindow = $true
  $Info.RedirectStandardOutput = $true
  $Info.RedirectStandardError = $true
  $child = [System.Diagnostics.Process]::Start($Info)
  return @{
    Process = $child
    Stdout = $child.StandardOutput.ReadToEndAsync()
    Stderr = $child.StandardError.ReadToEndAsync()
  }
}

if (-not $SkipTests) {
  $testFiles = Get-ChildItem (Join-Path $repoRoot "tests\unit\*.test.js")
  foreach ($testFile in $testFiles) {
    & node $testFile.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "Unit test failed: $($testFile.Name)"
    }
  }
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
Reset-BuildPath $packageRoot
Reset-BuildPath $buildRoot
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue

$appRoot = Join-Path $packageRoot "app"
New-Item -ItemType Directory -Force -Path $appRoot,$buildRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "index.html") -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "styles.css") -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "src") -Destination $appRoot -Recurse
$hostTools = Join-Path $appRoot "tools"
New-Item -ItemType Directory -Path $hostTools | Out-Null
foreach ($file in @("serve.py", "terminal_log.py", "log_retention.py", "workbench_protocol.py",
                    "workbench_service.py", "workbench_server_files.py", "workbench_transport.py", "workbench_display.py", "workbench_client.py")) {
  Copy-Item -LiteralPath (Join-Path (Join-Path $repoRoot "tools") $file) -Destination $hostTools
}
$pythonBuild = if ($env:NGB_BUILD_PYTHON) { $env:NGB_BUILD_PYTHON } else { "python" }
& $pythonBuild -I (Join-Path $repoRoot "tools\windows-launcher\package_runtime.py") $packageRoot
if ($LASTEXITCODE -ne 0) { throw "Could not build the private Windows runtime." }
Copy-Item -LiteralPath (Join-Path $repoRoot "tools\eda\ngb.tcl") -Destination $packageRoot

$elkTarget = Join-Path $appRoot "vendor\elkjs-0.11.1\lib"
New-Item -ItemType Directory -Force -Path $elkTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "vendor\elkjs-0.11.1\lib\elk.bundled.js") -Destination $elkTarget

$graphvizTarget = Join-Path $appRoot "vendor\graphviz"
New-Item -ItemType Directory -Force -Path $graphvizTarget | Out-Null
$graphvizManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "vendor\graphviz\manifest.json") | ConvertFrom-Json
foreach ($asset in $graphvizManifest.files) {
  $sourcePath = Join-Path (Join-Path $repoRoot "vendor\graphviz") $asset.path
  $actualHash = Get-AssetHash $sourcePath
  if ($actualHash -ne $asset.sha256 -or (Get-Item -LiteralPath $sourcePath).Length -ne $asset.bytes) {
    throw "Graphviz offline resource does not match its manifest: $($asset.path)"
  }
  Copy-Item -LiteralPath $sourcePath -Destination $graphvizTarget
}
Copy-Item -LiteralPath (Join-Path $repoRoot "vendor\graphviz\manifest.json") -Destination $graphvizTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "vendor\graphviz\README.md") -Destination $graphvizTarget

Copy-Item -LiteralPath (Join-Path $repoRoot "examples") -Destination $packageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot "README.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "CHANGELOG.md") -Destination $packageRoot
# Keep the repository layout for offline guide links, plus the traditional root guide.
$guideChapters = Get-ChildItem -LiteralPath (Join-Path $repoRoot "docs\guide") -Filter "*.md" | ForEach-Object { "docs\guide\$($_.Name)" }
foreach ($relative in (@("docs\USER_GUIDE.md", "docs\LINUX_SINGLE_FILE_LAUNCHER.md", "docs\design\timing_format_spec.md", "docs\design\aig_level_format_spec.md") + $guideChapters)) {
  $destination = Join-Path $packageRoot $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot $relative) -Destination $destination
}
$guide = [IO.File]::ReadAllText((Join-Path $packageRoot "docs\USER_GUIDE.md"))
$guide = $guide.Replace("](../examples/", "](examples/").Replace("](design/", "](docs/design/").Replace("](guide/", "](docs/guide/").Replace("](LINUX_SINGLE_FILE_LAUNCHER.md", "](docs/LINUX_SINGLE_FILE_LAUNCHER.md")
[IO.File]::WriteAllText((Join-Path $packageRoot "USER_GUIDE.md"), $guide)
# Development references outside the offline package point to this release's source.
foreach ($relative in (@("README.md", "docs\LINUX_SINGLE_FILE_LAUNCHER.md") + $guideChapters)) {
  $page = Join-Path $packageRoot $relative
  $content = [regex]::Replace([IO.File]::ReadAllText($page), '(?<=\]\()([\w./-]+\.md)(?=[)#])', {
    param($link)
    $target = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $page) $link.Value))
    if (Test-Path -LiteralPath $target) { return $link.Value }
    $repoPath = $target.Substring($packageRoot.Length + 1).Replace('\', '/')
    return "https://github.com/11234201/NetlistGraphBuilder/blob/v$version/$repoPath"
  })
  [IO.File]::WriteAllText($page, $content)
}
Copy-Item -LiteralPath (Join-Path $repoRoot "vendor\elkjs-0.11.1\LICENSE.md") -Destination (Join-Path $packageRoot "ELKJS-LICENSE.md")
foreach ($notice in @("VIZ-LICENSE.txt", "GRAPHVIZ-LICENSE.txt", "EXPAT-LICENSE.txt")) {
  Copy-Item -LiteralPath (Join-Path $graphvizTarget $notice) -Destination $packageRoot
}
Set-Content -LiteralPath (Join-Path $packageRoot "VERSION") -Encoding ASCII -Value $version

$assemblyInfoPath = Join-Path $buildRoot "AssemblyInfo.cs"
$assemblyVersion = "$version.0"
@"
using System.Reflection;
[assembly: AssemblyTitle("Netlist Graph Builder")]
[assembly: AssemblyProduct("Netlist Graph Builder")]
[assembly: AssemblyDescription("Lightweight offline structural Verilog schematic browser")]
[assembly: AssemblyCompany("NetlistGraphBuilder")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -LiteralPath $assemblyInfoPath -Encoding UTF8

$cscCandidates = @(
  (Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw "The .NET Framework C# compiler was not found. Install .NET Framework 4.x developer tools."
}

$exePath = Join-Path $packageRoot "NetlistGraphBuilder.exe"
& $csc /nologo /optimize+ /target:exe /platform:x64 /reference:System.Web.Extensions.dll "/out:$exePath" `
  (Join-Path $repoRoot "tools\windows-launcher\Program.cs") (Join-Path $repoRoot "tools\windows-launcher\TerminalLog.cs") $assemblyInfoPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exePath)) {
  throw "Failed to compile NetlistGraphBuilder.exe"
}

$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$smokePort = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$streamProbe = New-Object System.Diagnostics.ProcessStartInfo
$streamProbe.FileName = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$streamProbe.Arguments = '-NoProfile -NonInteractive -Command "[Console]::Out.Write((''o'' * 32768)); [Console]::Error.Write((''e'' * 32768))"'
$probe = Start-DrainedProcess $streamProbe
try {
  if (-not $probe.Process.WaitForExit(10000)) {
    $probe.Process.Kill()
    throw "Release smoke output streams failed to drain."
  }
  if ($probe.Process.ExitCode -ne 0 -or $probe.Stdout.Result.Length -ne 32768 -or $probe.Stderr.Result.Length -ne 32768) {
    throw "Release smoke output streams were truncated."
  }
} finally {
  $probe.Process.Dispose()
}
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $exePath
$processInfo.Arguments = "--no-browser --port $smokePort"
$processInfo.WorkingDirectory = $packageRoot
$smoke = Start-DrainedProcess $processInfo
$releaseProcess = $smoke.Process
$ready = $false
try {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($releaseProcess.HasExited) { break }
    try {
      $indexResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$smokePort/" -TimeoutSec 2
      $moduleResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$smokePort/src/app/main.js" -TimeoutSec 2
      $workerResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$smokePort/src/platform/graphviz_worker.js" -TimeoutSec 2
      $graphvizResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$smokePort/vendor/graphviz/viz.js" -TimeoutSec 2
      if ($indexResponse.StatusCode -eq 200 -and
          $indexResponse.Content -match 'Netlist Graph Builder' -and
          $moduleResponse.StatusCode -eq 200 -and
          $moduleResponse.Headers['Content-Type'] -match 'text/javascript' -and
          $workerResponse.StatusCode -eq 200 -and
          $workerResponse.Headers['Content-Type'] -match 'text/javascript' -and
          $graphvizResponse.StatusCode -eq 200 -and
          $graphvizResponse.Headers['Content-Type'] -match 'text/javascript') {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
} finally {
  if (-not $releaseProcess.HasExited) {
    $releaseProcess.Kill()
    $releaseProcess.WaitForExit()
  }
}
if (-not $ready) {
  $details = $smoke.Stderr.GetAwaiter().GetResult() + $smoke.Stdout.GetAwaiter().GetResult()
  throw "Release smoke test failed. $details"
}

Reset-BuildPath $buildRoot
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $stream = [System.IO.File]::OpenRead($zipPath)
  try {
    $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
  }
} finally {
  $sha256.Dispose()
}
Set-Content -LiteralPath $checksumPath -Encoding ASCII -Value "$hash  $([System.IO.Path]::GetFileName($zipPath))"

Write-Host "Release package: $zipPath"
Write-Host "SHA-256: $hash"

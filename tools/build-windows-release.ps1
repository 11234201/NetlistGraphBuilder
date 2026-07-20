param(
  [switch]$SkipTests
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

$elkTarget = Join-Path $appRoot "vendor\elkjs-0.11.1\lib"
New-Item -ItemType Directory -Force -Path $elkTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "vendor\elkjs-0.11.1\lib\elk.bundled.js") -Destination $elkTarget

Copy-Item -LiteralPath (Join-Path $repoRoot "examples") -Destination $packageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot "README.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "CHANGELOG.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "vendor\elkjs-0.11.1\LICENSE.md") -Destination (Join-Path $packageRoot "ELKJS-LICENSE.md")
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
& $csc /nologo /optimize+ /target:exe /platform:anycpu "/out:$exePath" `
  (Join-Path $repoRoot "tools\windows-launcher\Program.cs") $assemblyInfoPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exePath)) {
  throw "Failed to compile NetlistGraphBuilder.exe"
}

$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$smokePort = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $exePath
$processInfo.Arguments = "--no-browser --port $smokePort"
$processInfo.WorkingDirectory = $packageRoot
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$releaseProcess = New-Object System.Diagnostics.Process
$releaseProcess.StartInfo = $processInfo
if (-not $releaseProcess.Start()) {
  throw "Could not start the release executable for its smoke test."
}
$ready = $false
try {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($releaseProcess.HasExited) { break }
    try {
      $indexResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$smokePort/" -TimeoutSec 2
      $moduleResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$smokePort/src/app/main.js" -TimeoutSec 2
      if ($indexResponse.StatusCode -eq 200 -and
          $indexResponse.Content -match 'Netlist Graph Builder' -and
          $moduleResponse.StatusCode -eq 200 -and
          $moduleResponse.Headers['Content-Type'] -match 'text/javascript') {
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
  $details = $releaseProcess.StandardError.ReadToEnd() + $releaseProcess.StandardOutput.ReadToEnd()
  throw "Release smoke test failed. $details"
}

Reset-BuildPath $buildRoot
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Encoding ASCII -Value "$hash  $([System.IO.Path]::GetFileName($zipPath))"

Write-Host "Release package: $zipPath"
Write-Host "SHA-256: $hash"

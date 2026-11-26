# Run from PowerShell after compiling the Windows x64 release binary.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$RuntimeDirectory,
    [Parameter(Mandatory)][string]$StageDirectory,
    [Parameter(Mandatory)][string]$FixedRuntimeDirectory,
    [Parameter(Mandatory)][ValidatePattern('\.zip$')][string]$OutputZip
)
$ErrorActionPreference = 'Stop'
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputZip)
if (Test-Path -LiteralPath $destination) { throw "Output already exists: $destination" }
$stage = Join-Path $StageDirectory 'Blog Shorts'
if (Test-Path -LiteralPath $stage) { throw "Choose an empty staging directory: $StageDirectory" }
$null = New-Item -ItemType Directory -Path $stage -Force
Copy-Item -LiteralPath $Executable -Destination (Join-Path $stage 'blog-shorts.exe')
foreach ($item in 'node.exe', 'ffmpeg.exe', 'WebView2Loader.dll', 'notices') {
    Copy-Item -LiteralPath (Join-Path $RuntimeDirectory $item) -Destination $stage -Recurse
}
$tauri = Join-Path $PSScriptRoot 'src-tauri'
$config = Get-Content -LiteralPath (Join-Path $tauri 'tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($resource in $config.bundle.resources.PSObject.Properties) {
    $source = Join-Path $tauri $resource.Name
    $files = @(Get-ChildItem -LiteralPath (Split-Path $source) -Filter (Split-Path -Leaf $source) -File)
    if (!$files.Count) { throw "Missing bundle resources: $source" }
    $target = New-Item -ItemType Directory -Path (Join-Path $stage $resource.Value) -Force
    foreach ($file in $files) {
        Copy-Item -LiteralPath $file.FullName -Destination $target.FullName
    }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination $stage

$fixed = Get-Item -LiteralPath (Join-Path $FixedRuntimeDirectory 'msedgewebview2.exe')
$signature = Get-AuthenticodeSignature $fixed.FullName
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation,') {
    throw 'Use the Microsoft-signed Windows x64 Fixed Version Runtime.'
}
Copy-Item -LiteralPath $FixedRuntimeDirectory -Destination (Join-Path $stage 'webview') -Recurse
Add-Content -LiteralPath (Join-Path $stage 'notices/Third-party.txt') -Value @(
    ('Microsoft Edge WebView2 Fixed Version Runtime ' + $fixed.VersionInfo.ProductVersion)
    'https://developer.microsoft.com/microsoft-edge/webview2/'
)

$workspace = (Get-Item -LiteralPath $StageDirectory).FullName
$archive = Join-Path $workspace 'runtime.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory((Get-Item -LiteralPath $stage).FullName, $archive)
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$version = $config.version
if ((Get-Item -LiteralPath $Executable).VersionInfo.ProductVersion -ne $version) {
    throw "Rebuild the Tauri application for version $version."
}
$metadata = Join-Path $workspace 'Package.cs'
@"
using System.Reflection;
[assembly: AssemblyTitle("Blog Shorts")]
[assembly: AssemblyProduct("Blog Shorts")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyInformationalVersion("$version")]
internal static class Package { internal const string Hash = "$hash"; }
"@ | Set-Content -LiteralPath $metadata -Encoding UTF8
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$launcher = Join-Path $workspace 'blog-shorts.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$launcher" `
    "/win32icon:$PSScriptRoot/src-tauri/icons/icon.ico" "/resource:$archive,runtime.zip" `
    /reference:System.IO.Compression.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    (Join-Path $PSScriptRoot 'portable/Launcher.cs') $metadata
if ($LASTEXITCODE -ne 0) { throw 'Single-file launcher compilation failed.' }
$package = Join-Path $workspace ([IO.Path]::ChangeExtension([IO.Path]::GetRandomFileName(), '.zip'))
Compress-Archive -LiteralPath $launcher -DestinationPath $package -CompressionLevel Fastest
[IO.File]::Move($package, $destination)

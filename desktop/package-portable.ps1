# Run from PowerShell after compiling the Windows x64 release binary.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$RuntimeDirectory,
    [Parameter(Mandatory)][string]$StageDirectory,
    [Parameter(Mandatory)][string]$OutputZip
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputZip) { throw "Output ZIP already exists: $OutputZip" }
$stage = Join-Path $StageDirectory 'Blog Shorts'
if (Test-Path -LiteralPath $stage) { throw "Choose an empty staging directory: $StageDirectory" }
$engine = New-Item -ItemType Directory -Path (Join-Path $stage 'engine') -Force
Copy-Item -LiteralPath $Executable -Destination (Join-Path $stage 'blog-shorts.exe')
foreach ($item in 'node.exe', 'ffmpeg.exe', 'WebView2Loader.dll', 'notices') {
    Copy-Item -LiteralPath (Join-Path $RuntimeDirectory $item) -Destination $stage -Recurse
}
foreach ($module in 'shorts.mjs', 'deepseek-planner.mjs', 'deepseek-voice.mjs', 'gemini-voice.mjs', 'voice_ai.py', 'voice.ps1') {
    Copy-Item -LiteralPath (Join-Path "$PSScriptRoot/.." $module) -Destination $engine.FullName
}
Copy-Item -LiteralPath (Join-Path "$PSScriptRoot/.." 'fonts') -Destination $engine.FullName -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination $stage
Compress-Archive -LiteralPath $stage -DestinationPath $OutputZip -CompressionLevel Optimal

param([string]$Plan, [string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice = $speech.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
    if (!$voice) { throw 'Install a Korean Windows desktop speech voice first.' }
    $speech.SelectVoice($voice.VoiceInfo.Name)
    $speech.Rate = 1
    $scenes = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
    for ($i = 0; $i -lt $scenes.Count; $i++) {
        $speech.SetOutputToWaveFile((Join-Path $Destination "$i.wav"))
        $speech.Speak($scenes[$i].text)
        $speech.SetOutputToNull()
    }
} finally { $speech.Dispose() }

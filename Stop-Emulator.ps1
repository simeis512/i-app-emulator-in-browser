param([switch]$CheckOnly, [int]$Port = 9052)
$ErrorActionPreference = 'Stop'
$uri = "http://127.0.0.1:$Port/__iapp/"
try { $identity = Invoke-RestMethod -Uri ($uri + 'status') -TimeoutSec 2 }
catch { Write-Host 'Emulator server not reachable.'; exit 0 }
if ($identity.app -ne 'i-app-emulator-in-browser') { throw 'This port does not belong to the emulator.' }
if ($CheckOnly) { Write-Host 'Verified emulator server.'; exit 0 }
$tokenPath = Join-Path $PSScriptRoot ".runtime\server-$Port.token"
$shutdownToken = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($uri + 'shutdown') -Headers @{'X-P905i-Token'=$shutdownToken} -TimeoutSec 3 | Out-Null
Write-Host 'i-appli emulator server stopped.'

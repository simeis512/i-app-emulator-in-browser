param([switch]$NoBrowser, [int]$Port = 9052, [string]$PythonExe)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'web\p905i-runtime.jar'))) {
    throw 'Build the emulator first: python build.py, then python build_ogl.py. See README.md.'
}
$runtimeDir = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$pythonArgs = @()
if (-not $PythonExe) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notlike '*WindowsApps*') { $PythonExe = $pythonCommand.Source }
    else {
        $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($pyCommand) { $PythonExe = $pyCommand.Source; $pythonArgs = @('-3') }
    }
}
if (-not $PythonExe) { throw 'Python 3.10+ is required. Install Python or pass -PythonExe with its path.' }
$uri = "http://127.0.0.1:$Port/"
$running = $false
try { $identity = Invoke-RestMethod -Uri ($uri + '__iapp/status') -TimeoutSec 2; $running = $identity.app -eq 'i-app-emulator-in-browser' } catch { }
if (-not $running) {
    $serverPath = Join-Path $PSScriptRoot 'serve.py'
    $launchArgs = $pythonArgs + @('-X', 'utf8', ('"' + $serverPath + '"'), '--port', "$Port")
    $server = Start-Process -FilePath $PythonExe -ArgumentList $launchArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir "server-$Port.out.log") -RedirectStandardError (Join-Path $runtimeDir "server-$Port.err.log")
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 200
        try { $identity = Invoke-RestMethod -Uri ($uri + '__iapp/status') -TimeoutSec 1; $running = $identity.app -eq 'i-app-emulator-in-browser'; if ($running) { break } } catch { }
    }
    if (-not $running) { throw "Could not start the local server. Check .runtime/server-$Port.err.log." }
}
Write-Host "i-appli emulator: $uri"
if (-not $NoBrowser) { Start-Process $uri }

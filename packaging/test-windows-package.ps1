$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Join-Path $root "dist\windows-package"
$python = Join-Path $package "python\python.exe"
$app = Join-Path $package "app\app.py"
$env:IDS_CHECKER_DATA_DIR = Join-Path $env:TEMP "ids-checker-package-test"

& $python -c "import streamlit, ifcopenshell, ifctester, building_viewer, validator, workspace_store" 
if ($LASTEXITCODE -ne 0) { throw "Packaged dependencies could not be imported." }
& $python -m unittest discover -s (Join-Path $root "tests")
if ($LASTEXITCODE -ne 0) { throw "The packaged app failed its validation tests." }

$server = $null
try {
    $server = Start-Process -FilePath $python -ArgumentList @(
        "-m", "streamlit", "run", ('"' + $app + '"'),
        "--server.address=127.0.0.1", "--server.port=8527",
        "--server.headless=true", "--browser.gatherUsageStats=false"
    ) -WorkingDirectory (Join-Path $package "app") -PassThru -RedirectStandardOutput (Join-Path $env:TEMP "ids-checker-test-out.log") -RedirectStandardError (Join-Path $env:TEMP "ids-checker-test-err.log")
    $healthy = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:8527/_stcore/health" -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200) { $healthy = $true; break }
        } catch {}
        if ($server.HasExited) { break }
    }
    if (-not $healthy) {
        Get-Content (Join-Path $env:TEMP "ids-checker-test-err.log") -ErrorAction SilentlyContinue
        throw "The packaged app did not respond in the browser."
    }
    Write-Host "Packaged app responded successfully."
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}

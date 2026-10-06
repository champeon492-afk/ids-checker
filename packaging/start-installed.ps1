$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$app = Join-Path $root "app\app.py"
$python = Join-Path $root "python\python.exe"
$data = Join-Path $env:LOCALAPPDATA "IDS Checker"
$workspace = Join-Path $data "projects"
$log = Join-Path $data "server.log"
$url = "http://127.0.0.1:8517/"

function Test-Server {
    try {
        $response = Invoke-WebRequest -Uri "${url}_stcore/health" -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

try {
    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
    if (-not (Test-Server)) {
        $env:IDS_CHECKER_DATA_DIR = $workspace
        $arguments = @(
            "-m", "streamlit", "run", ('"' + $app + '"'),
            "--server.address=127.0.0.1", "--server.port=8517",
            "--server.headless=true", "--browser.gatherUsageStats=false"
        )
        Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory (Join-Path $root "app") -RedirectStandardError $log -WindowStyle Hidden | Out-Null
        for ($attempt = 0; $attempt -lt 60 -and -not (Test-Server); $attempt++) {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not (Test-Server)) { throw "The validator did not start. See $log for details." }
    Start-Process $url | Out-Null
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, "IDS Checker") | Out-Null
}

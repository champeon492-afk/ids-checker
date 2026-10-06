param(
    [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Join-Path $root "$OutputDirectory\windows-package"
$pythonDir = Join-Path $package "python"
$appDir = Join-Path $package "app"

if (Test-Path $package) {
    Remove-Item -LiteralPath $package -Recurse -Force
}
New-Item -ItemType Directory -Path $pythonDir, $appDir -Force | Out-Null

$version = (& python -c "import platform,sys; assert sys.version_info[:2] == (3,12); assert platform.architecture()[0] == '64bit'; print(platform.python_version())").Trim()
if ($LASTEXITCODE -ne 0) { throw "Building requires 64-bit Python 3.12." }
$url = "https://www.python.org/ftp/python/$version/python-$version-embed-amd64.zip"
$archive = Join-Path $env:TEMP "ids-checker-python-$version.zip"
Invoke-WebRequest -Uri $url -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $pythonDir -Force

$pth = Join-Path $pythonDir "python312._pth"
@("python312.zip", ".", "Lib\site-packages", "..\app", "import site") | Set-Content -LiteralPath $pth -Encoding ascii
$sitePackages = Join-Path $pythonDir "Lib\site-packages"
New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
& python -m pip install --disable-pip-version-check --target $sitePackages -r (Join-Path $root "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not package the Python dependencies." }

Copy-Item -Path (Join-Path $root "*.py") -Destination $appDir
New-Item -ItemType Directory -Path (Join-Path $appDir "frontend") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "frontend\viewer.bundle.js") -Destination (Join-Path $appDir "frontend")
Copy-Item -LiteralPath (Join-Path $root "frontend\viewer.css") -Destination (Join-Path $appDir "frontend")
Copy-Item -LiteralPath (Join-Path $root "frontend\design") -Destination (Join-Path $appDir "frontend") -Recurse
Copy-Item -Path (Join-Path $root ".streamlit") -Destination $appDir -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-installed.ps1") -Destination $package

Write-Host "Windows package prepared at $package"

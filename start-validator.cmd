@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    py -3.12 -m venv .venv
    if errorlevel 1 (
        if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
            "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m venv .venv
        )
        if not exist ".venv\Scripts\python.exe" (
            echo Python 3.12 is required. Install it, then run this file again.
            pause
            exit /b 1
        )
    )
)

".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo Could not install the app packages. Check your internet connection and try again.
    pause
    exit /b 1
)

echo Opening IDS Model Validator at http://localhost:8501
echo Keep this window open while using the app. Press Ctrl+C to stop it.
".venv\Scripts\python.exe" -m streamlit run app.py --server.address=127.0.0.1 --server.port=8501
pause

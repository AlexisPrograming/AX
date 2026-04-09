@echo off
title AXIOM Voice Auth Server
cd /d "%~dp0"

where python >nul 2>&1 || (
    echo Python not found. Install Python 3.10+ from python.org
    pause & exit /b 1
)

if not exist "venv\Scripts\activate.bat" (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat
echo Checking/installing dependencies...
pip install -r requirements.txt

echo.
echo ========================================
echo   AXIOM Voice Auth Server
echo   http://localhost:8080
echo ========================================
echo.
python server.py
pause

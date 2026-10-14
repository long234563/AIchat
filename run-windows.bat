@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Chua co Node.js. Hay tai ban LTS tai https://nodejs.org/
  pause
  exit /b 1
)
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Da tao file .env - hay dien GEMINI_API_KEY va LUU file.
  notepad .env
)
echo.
echo Bat dau long AI ...
echo Truy cap: http://localhost:3012/
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3012"
node server.js
echo Server da dung.
pause

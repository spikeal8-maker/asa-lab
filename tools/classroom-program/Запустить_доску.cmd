@echo off
chcp 65001 > nul
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 classroomctl.py board --output classroom-board.html
) else (
  python classroomctl.py board --output classroom-board.html
)
if errorlevel 1 (
  echo Не удалось создать доску. Установите Python 3.10 или новее.
  pause
  exit /b 1
)
start "" "%~dp0classroom-board.html"

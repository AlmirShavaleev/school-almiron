@echo off
chcp 65001 > nul
echo Установка зависимостей...
pip install fastapi uvicorn python-multipart pymupdf pillow --quiet
echo.
echo Запуск сервера...
start http://localhost:8000
python server.py
pause

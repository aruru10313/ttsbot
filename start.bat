@echo off
chcp 65001 > nul
echo 패키지를 설치 및 업데이트 중입니다...
call npm install
echo.
echo 봇을 실행합니다...
npm start
pause

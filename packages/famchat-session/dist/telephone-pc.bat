@echo off
chcp 65001 >nul
REM Le PC joue le TELEPHONE. 1re fois : telephone-pc.bat "famchat://pair?..."  ensuite : telephone-pc.bat
cd /d "%~dp0"
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp famchat-pc.jar fr.ecl.famchat.pc.PcPhoneKt %* famchat-telephone
pause

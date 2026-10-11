@echo off
chcp 65001 >nul
REM Le PC joue la TABLETTE. Donnees dans le dossier famchat-tablette\ a cote de ce fichier.
cd /d "%~dp0"
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp famchat-pc.jar fr.ecl.famchat.pc.PcTabletKt famchat-tablette 8443
pause

#!/usr/bin/env bash
# Compile le module session-core et lance les tests d'intégration sur un PC (JDK 17+).
# Prérequis : kotlinc dans le PATH (https://github.com/JetBrains/kotlin/releases) et keytool (fourni avec le JDK).
#   ./build.sh            → tous les tests
#   ONLY=handover ./build.sh   → un seul scénario
#   VERBOSE=1 ./build.sh       → journal détaillé de la machine d'états
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
kotlinc core/src core/test -include-runtime -d build/tests.jar
java -Dstdout.encoding=UTF-8 -cp build/tests.jar fr.ecl.famchat.session.TestMainKt

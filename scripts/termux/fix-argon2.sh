#!/usr/bin/env bash
# argon2 sur Termux/Android : trois problemes, trois correctifs.
#
#  1. le binaire natif android-arm64 plante sur certains processeurs
#     ("Illegal instruction") -> on le neutralise pour forcer le WebAssembly
#  2. la version WebAssembly n'est pas installee par defaut sur Android
#     -> on l'installe explicitement, dans la meme version qu'argon2
#  3. elle demande l'acces a la racine "/", refuse par Android (UVWASI_EACCES)
#     -> on utilise process.cwd() a la place, dans LES DEUX fichiers concernes
#
# Idempotent : relancer le script ne casse rien.
# Usage, depuis la racine du depot :  bash scripts/termux/fix-argon2.sh

set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API="$ROOT/apps/api"
MODULES="$ROOT/node_modules"
WASI="$MODULES/@node-rs/argon2-wasm32-wasi"

[ -d "$API" ] || { echo "apps/api introuvable sous $ROOT"; exit 1; }

VERSION="$(cd "$API" && node -p "require('@node-rs/argon2/package.json').version")"
echo "argon2 : version $VERSION"

# (2) installer la version WebAssembly si elle manque
if [ ! -d "$WASI" ]; then
  echo "Installation de @node-rs/argon2-wasm32-wasi@$VERSION ..."
  TMP="$(mktemp -d)"
  (cd "$TMP" && npm init -y >/dev/null && npm install --force "@node-rs/argon2-wasm32-wasi@$VERSION" >/dev/null)
  cp -rn "$TMP/node_modules/." "$MODULES/"
  rm -rf "$TMP"
  [ -d "$WASI" ] || { echo "echec de l'installation WebAssembly"; exit 1; }
else
  echo "WebAssembly : deja present."
fi

# (1) neutraliser le binaire natif android-arm64
RENAMED=0
for f in $(find "$MODULES/.pnpm" -path "*argon2-android-arm64*" -name "*.node" 2>/dev/null || true); do
  mv "$f" "$f.bak"
  RENAMED=$((RENAMED + 1))
done
echo "Binaires natifs neutralises : $RENAMED"

# (3) remplacer l'acces a la racine par le dossier courant, dans les DEUX fichiers
sed -i -E 's/([A-Za-z_]+\.)?parse\(process\.cwd\(\)\)\.root/process.cwd()/g' \
  "$WASI"/*.cjs "$WASI"/wasi-worker.mjs
echo "Chemin racine corrige."

echo "OK. Important : lancer l'API depuis apps/api, sinon UVWASI_EACCES."

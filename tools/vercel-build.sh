#!/bin/sh
# Build de Vercel con Phoenyx: clona el motor (repo publico, con el wasm ya compilado) y construye el cliente contra el.
set -e
PHOENYX_REF="${PHOENYX_REF:-master}"
rm -rf .phoenyx
git clone --depth 1 --branch "$PHOENYX_REF" https://github.com/s7lver2/phoenyx.git .phoenyx
test -f .phoenyx/packages/phoenyx/pkg/phoenyx_gl_bg.wasm || { echo "el repo de Phoenyx no trae packages/phoenyx/pkg"; exit 1; }
PHOENYX_DIR="$PWD/.phoenyx" npm run build -w client

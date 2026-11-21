#!/usr/bin/env bash
# Build a Chrome Web Store package from the current source.
#
# Usage: ./release.sh
# Reads the version from manifest.json, runs the test suite, and writes
# dist/keyline-<version>.zip containing exactly the runtime files
# (manifest + icons PNGs + src), with no junk or build sources.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="${KEYLINE_RELEASE_OUT:-dist/keyline-${VERSION}.zip}"

# KEYLINE_SKIP_TESTS=1 is only for tests/extension-id.test.js, which packages
# from inside the suite and must not start the suite again.
if [ "${KEYLINE_SKIP_TESTS:-}" != "1" ]; then
  echo "Running tests..."
  npm test
fi

echo "Packaging ${OUT} ..."
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# manifest.json carries a "key" (the Web Store item's public key) so every
# unpacked copy gets the store's extension ID and shares its chrome.storage.sync
# data. The Web Store refuses an upload whose manifest has "key", so the zip
# gets a copy without it.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
delete m.key;
fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\n");
' "$STAGE/manifest.json"

# The `zip` CLI is not installed everywhere (notably this dev box); Python's
# zipfile writes the identical archive, so fall back to it rather than failing.
if command -v zip >/dev/null 2>&1; then
  ABS_OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
  (cd "$STAGE" && zip -X "$ABS_OUT" manifest.json >/dev/null)
  zip -r -X "$OUT" icons src \
    -x '*.DS_Store' -x '__MACOSX*' -x '*/.*' -x 'icons/*.svg' -x 'icons/*.sh' >/dev/null
else
  python3 - "$OUT" "$STAGE/manifest.json" <<'PY'
import os, sys, zipfile

out = sys.argv[1]
manifest = sys.argv[2]
skip_suffix = (".DS_Store", ".svg", ".sh")

def keep(path):
    parts = path.split(os.sep)
    if any(p.startswith(".") for p in parts):          # */.*
        return False
    if parts[0] == "__MACOSX":
        return False
    if path.endswith(".DS_Store"):
        return False
    if parts[0] == "icons" and path.endswith((".svg", ".sh")):
        return False
    return True

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(manifest, "manifest.json")
    for top in ("icons", "src"):
        for root, dirs, files in os.walk(top):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in sorted(files):
                p = os.path.join(root, f)
                if keep(p):
                    z.write(p)
PY
fi

echo
echo "Built $OUT"
python3 -c "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(f'{len(z.namelist())} files, {sum(i.file_size for i in z.infolist())} bytes uncompressed')" "$OUT"
if python3 -c "import sys, json, zipfile; sys.exit('key' not in json.loads(zipfile.ZipFile(sys.argv[1]).read('manifest.json')))" "$OUT"; then
  echo "error: the packaged manifest still has a \"key\"; the Web Store would reject it" >&2
  exit 1
fi
echo "manifest version: $(python3 -c "import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).read('manifest.json').decode())" "$OUT" | node -p "JSON.parse(require('fs').readFileSync(0)).version")"

#!/usr/bin/env bash

set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

if command -v node >/dev/null 2>&1 && \
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >/dev/null 2>&1; then
  exec node tools/serve.mjs
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 -u tools/serve.py
fi

echo "Unable to start preview: install a working Node.js or Python 3 runtime." >&2
exit 1

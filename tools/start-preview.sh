#!/usr/bin/env bash

set -euo pipefail
shopt -s execfail

script_dir="$(cd -- "${BASH_SOURCE[0]%/*}" && pwd)"
source "${script_dir}/terminal_log.sh"
project_root="$(cd "${script_dir}/.." && pwd)"
if ! cd "${project_root}"; then NgbLog error bootstrap.failed 'Cannot enter project directory'; exit 1; fi

if command -v node >/dev/null 2>&1 && \
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >/dev/null 2>&1; then
  NgbLog info runtime.selected 'Starting Node preview server'
  exec node tools/serve.mjs "$@" || { code=$?; NgbLog error bootstrap.failed 'Could not execute Node'; exit "$code"; }
fi

if command -v python3 >/dev/null 2>&1; then
  NgbLog info runtime.selected 'Starting Python preview server'
  exec python3 -u tools/serve.py "$@" || { code=$?; NgbLog error bootstrap.failed 'Could not execute Python'; exit "$code"; }
fi

NgbLog error bootstrap.failed 'Unable to start preview: install a working Node.js or Python 3 runtime.'
exit 1

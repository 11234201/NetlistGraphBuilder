#!/usr/bin/env bash

# Compatibility entry point; keep the caller's cwd and process identity.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$BASH" "$script_dir/../ngb" "$@"

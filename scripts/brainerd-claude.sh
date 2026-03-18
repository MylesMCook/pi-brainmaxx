#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_CLI="${ROOT_DIR}/dist/src/claude-cli.js"
SOURCE_CLI="${ROOT_DIR}/src/claude-cli.ts"

if [[ -f "${DIST_CLI}" ]]; then
  exec node "${DIST_CLI}" "$@"
fi

if command -v npx >/dev/null 2>&1 && [[ -f "${SOURCE_CLI}" ]]; then
  exec npx --yes tsx "${SOURCE_CLI}" "$@"
fi

echo "Brainerd Claude runtime is missing. Rebuild the skill or reinstall the packaged copy." >&2
exit 1

#!/usr/bin/env bash
# Preserve the requested command's result, then support one executable plus
# library packages. This fallback is visible evidence, not a requested-command PASS.
set -euo pipefail
evidence="${SDD_BUILD_EVIDENCE_DIR:-.sdd-build}"
mkdir -p "$evidence"
set +e
go build -o dpipe ./... > "$evidence/requested-command.log" 2>&1
requested_rc=$?
set -e
printf '%s\n' "$requested_rc" > "$evidence/requested-command-exit-code.txt"
cat "$evidence/requested-command.log"
if [[ "$requested_rc" == 0 ]]; then
  printf 'requested-command\n' > "$evidence/packaging-mode.txt"
  exit 0
fi
if ! grep -q 'cannot write multiple packages to non-directory' "$evidence/requested-command.log"; then
  exit "$requested_rc"
fi
go build ./...
mapfile -t entries < <(go list -f '{{if eq .Name "main"}}{{.ImportPath}}{{end}}' ./...)
mains=()
for entry in "${entries[@]}"; do
  entry="${entry%$'\r'}"
  [[ -z "$entry" ]] || mains+=("$entry")
done
if [[ ${#mains[@]} != 1 ]]; then
  echo "Expected exactly one CLI main package; found ${#mains[@]}" >&2
  exit 1
fi
printf 'unique-main-adapter\n' > "$evidence/packaging-mode.txt"
printf '%s\n' "${mains[0]}" > "$evidence/main-package.txt"
go build -o dpipe "${mains[0]}"

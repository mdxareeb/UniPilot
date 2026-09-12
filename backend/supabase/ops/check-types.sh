#!/usr/bin/env sh
# Fail when the committed types differ from a fresh local generation.
#
# Manual check after a migration (CI/automation belongs to Phase 56).
# Run from backend/:
#   wsl -d kali-linux -u root -e sh supabase/ops/check-types.sh
set -eu

backend_dir="$(cd "$(dirname "$0")/../.." && pwd)"
frontend_types="$backend_dir/../frontend/lib/supabase/database.types.ts"
cd "$backend_dir"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

supabase gen types typescript --local > "$tmp"

if ! diff -u "$frontend_types" "$tmp"; then
  echo "frontend/lib/supabase/database.types.ts is out of date — run supabase/ops/generate-types.sh from backend/" >&2
  exit 1
fi

echo "database.types.ts matches the local schema"

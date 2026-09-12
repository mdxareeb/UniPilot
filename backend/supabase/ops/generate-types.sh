#!/usr/bin/env sh
# Regenerate the committed database types from the LOCAL Supabase schema.
#
# Run from backend/ (the CLI lives in WSL):
#   wsl -d kali-linux -u root -e sh supabase/ops/generate-types.sh
#
# `--local` is mandatory: without a flag the CLI targets the linked (hosted)
# project and fails when nothing is linked. This script never touches hosted.
set -eu

backend_dir="$(cd "$(dirname "$0")/../.." && pwd)"
frontend_types="$backend_dir/../frontend/lib/supabase/database.types.ts"
cd "$backend_dir"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found on PATH inside WSL" >&2
  exit 1
fi

supabase gen types typescript --local > "$frontend_types"
echo "regenerated frontend/lib/supabase/database.types.ts from the local schema"

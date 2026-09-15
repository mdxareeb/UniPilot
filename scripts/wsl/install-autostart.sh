#!/usr/bin/env bash
# Install the optional UniPilot WSL boot hook: when the distro starts, Docker
# comes up (already enabled) and `supabase start` restores the local stack.
#
# Run from the Windows side (repo root), idempotent — re-running rewrites and
# re-enables the unit:
#
#   wsl -d kali-linux -u root -e bash /mnt/c/<checkout>/scripts/wsl/install-autostart.sh /mnt/c/<checkout>/backend
#
# Uninstall:
#   systemctl disable --now unipilot-stack.service
#   rm /etc/systemd/system/unipilot-stack.service && systemctl daemon-reload
set -euo pipefail

backend_dir="${1:-}"
template="${2:-$(dirname "$0")/unipilot-stack.service}"

if [[ -z "$backend_dir" || ! -f "$backend_dir/supabase/config.toml" ]]; then
  echo "usage: install-autostart.sh <backend-dir, a /mnt/c/... path> [unit-template]" >&2
  exit 2
fi

supabase_bin="$(command -v supabase || true)"
if [[ -z "$supabase_bin" ]]; then
  echo "the supabase CLI is not on PATH in this distro" >&2
  exit 2
fi

sed \
  -e "s|__REPO_BACKEND_DIR__|$backend_dir|g" \
  -e "s|__SUPABASE_BIN__|$supabase_bin|g" \
  "$template" > /etc/systemd/system/unipilot-stack.service

systemctl daemon-reload
systemctl enable unipilot-stack.service
echo "installed unipilot-stack.service (supabase: $supabase_bin, project: $backend_dir)"
echo "start it now:  systemctl start unipilot-stack"
echo "remove it:     systemctl disable --now unipilot-stack && rm /etc/systemd/system/unipilot-stack.service"

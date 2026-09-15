/**
 * WSL invocation helpers for the dev-environment orchestrator.
 *
 * Docker and the Supabase CLI live inside a WSL2 distro on this project's
 * Windows dev host. The distro is configurable (`UNIPILOT_WSL_DISTRO`, default
 * `kali-linux`), but the commands are always executed as root because the
 * distro's docker socket is root-only — the same reason `backend/package.json`
 * runs its `db:*` scripts through `wsl -d kali-linux -u root`.
 */

/** `C:\Users\x` → `/mnt/c/Users/x`; POSIX paths pass through unchanged. */
export function toWslPath(winPath) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!match) return winPath.replace(/\\/g, "/");

  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/** `wsl.exe` argument list: `-d <distro> [-u root] -e <command...>`. */
export function wslExecArgs({ distro, root = true, command }) {
  return [
    "-d",
    distro,
    ...(root ? ["-u", "root"] : []),
    "-e",
    ...command,
  ];
}

/**
 * The documented Presenton container: ghcr image on port 5001, no-auth
 * single-user mode, its SQLite/config under the app_data volume, and a restart
 * policy so Docker revives it after a WSL restart. `--env-file` carries the
 * LLM/provider config when that file exists and is omitted otherwise.
 */
export function buildPresentonRunArgs({
  image,
  appDataDir,
  envFile,
  name = "presenton",
  hostPort = 5001,
  containerPort = 80,
}) {
  return [
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "-p",
    `${hostPort}:${containerPort}`,
    "-e",
    "DISABLE_AUTH=true",
    ...(envFile ? ["--env-file", envFile] : []),
    "-v",
    `${appDataDir}:/app_data`,
    image,
  ];
}

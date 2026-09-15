import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..");

let cached: boolean | null = null;

/** True when `python -m wa_service` can run from the whatsapp/ package. */
export function hasWhatsAppService(): boolean {
  if (cached !== null) return cached;
  const python = process.env.WHATSAPP_PYTHON ?? "python";
  const probe = spawnSync(python, ["-c", "import wa_service"], {
    cwd: path.join(REPO_ROOT, "whatsapp"),
    encoding: "utf8",
    timeout: 15_000,
  });
  cached = probe.status === 0;
  if (!cached && process.env.UNIPILOT_REQUIRE_PYTHON === "1") {
    throw new Error(
      "UNIPILOT_REQUIRE_PYTHON=1 but `python -c 'import wa_service'` failed from whatsapp/ — " +
        "install python + whatsapp/requirements-dev.txt (see whatsapp/README.md)",
    );
  }
  return cached;
}

export const WHATSAPP_SKIP_REASON =
  "python/wa_service unavailable on this host (install whatsapp/requirements-dev.txt; see whatsapp/README.md)";

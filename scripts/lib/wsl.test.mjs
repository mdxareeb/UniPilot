import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPresentonRunArgs, toWslPath, wslExecArgs } from "./wsl.mjs";

test("toWslPath converts Windows drive paths to /mnt", () => {
  assert.equal(toWslPath("C:\\Users\\test\\repo"), "/mnt/c/Users/test/repo");
  assert.equal(toWslPath("c:\\work\\a b"), "/mnt/c/work/a b");
  assert.equal(toWslPath("D:\\data"), "/mnt/d/data");
});

test("toWslPath leaves POSIX paths alone", () => {
  assert.equal(toWslPath("/home/user/repo"), "/home/user/repo");
  assert.equal(toWslPath("relative/path"), "relative/path");
});

test("wslExecArgs targets the distro and runs as root by default", () => {
  assert.deepEqual(
    wslExecArgs({ distro: "kali-linux", command: ["docker", "info"] }),
    ["-d", "kali-linux", "-u", "root", "-e", "docker", "info"],
  );
});

test("wslExecArgs can run as the default user", () => {
  assert.deepEqual(
    wslExecArgs({ distro: "kali-linux", root: false, command: ["node", "-v"] }),
    ["-d", "kali-linux", "-e", "node", "-v"],
  );
});

test("buildPresentonRunArgs carries the documented container contract", () => {
  const args = buildPresentonRunArgs({
    image: "ghcr.io/presenton/presenton:latest",
    appDataDir: "/mnt/c/repo/presenton-main/app_data",
    envFile: "/mnt/c/repo/presenton-main/.env",
  });

  assert.deepEqual(args, [
    "run",
    "-d",
    "--name",
    "presenton",
    "--restart",
    "unless-stopped",
    "-p",
    "5001:80",
    "-e",
    "DISABLE_AUTH=true",
    "--env-file",
    "/mnt/c/repo/presenton-main/.env",
    "-v",
    "/mnt/c/repo/presenton-main/app_data:/app_data",
    "ghcr.io/presenton/presenton:latest",
  ]);
});

test("buildPresentonRunArgs omits --env-file when none exists", () => {
  const args = buildPresentonRunArgs({
    image: "ghcr.io/presenton/presenton:latest",
    appDataDir: "/mnt/c/repo/presenton-main/app_data",
    envFile: null,
  });

  assert.equal(args.includes("--env-file"), false);
  assert.equal(args.at(-1), "ghcr.io/presenton/presenton:latest");
  assert.equal(args.at(-2), "/mnt/c/repo/presenton-main/app_data:/app_data");
});

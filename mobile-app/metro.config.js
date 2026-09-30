// Metro configuration — the npm-workspaces monorepo setup (plan §I).
//
// `mobile-app` is a workspace of the UniPilot repo alongside `frontend` and
// `backend`, so Metro must watch the repo root and resolve modules from both
// the app's own node_modules and the hoisted root node_modules. Hierarchical
// lookup is disabled so a nested copy (React Native pins a React patch that
// differs from the web app's) is never accidentally shadowed by a hoisted one.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
/* Hierarchical lookup stays ENABLED (Metro's default): a dependency that
   carries its own nested copy — react-native-reanimated's semver@7 next to
   the web toolchain's hoisted semver@6 — must resolve its own. The explicit
   nodeModulesPaths above still pin the app's two nearest stores. */

module.exports = config;

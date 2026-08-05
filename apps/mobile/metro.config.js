// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Metro only walks up from the project by default. The domain engine lives in
// packages/core and is consumed as TypeScript source, so both the workspace
// root and its node_modules have to be in scope.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Hierarchical lookup stays ON. Bun installs this workspace with the isolated
// linker: every package is a symlink into `node_modules/.bun/<name>@<version>/`,
// and its own dependencies sit in a `node_modules` beside it there. Only
// walking up from the requiring file finds them — the two paths above cover the
// app's direct dependencies and nothing deeper.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;

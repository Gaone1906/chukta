// Monorepo Metro config: watch the workspace root so @hisaab/core is bundled from source,
// and resolve modules from both the app's and the root's node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// npm workspaces hoists to the root; without this Metro can resolve a package twice and
// ship two copies of React.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

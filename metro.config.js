const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Restrict watched folders to project root to avoid Windows FSWatcher failures
config.watchFolders = [__dirname];

// Disable Watchman — it can't handle UNC/network-mapped drive paths on Windows
config.watcher = {
  ...config.watcher,
  watchman: { deferStates: [] },
};
config.resolver = {
  ...config.resolver,
  useWatchman: false,
};

module.exports = config;

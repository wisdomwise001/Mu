const { getDefaultConfig } = require("expo/metro-config");
const exclusionList = require("metro-config/private/defaults/exclusionList").default;

const config = getDefaultConfig(__dirname);
config.resolver.blockList = exclusionList([/\.local\/.*/, /\.cache\/.*/]);

module.exports = config;

import { Config } from "@remotion/cli/config";
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// The render sources use ESM ".js" import specifiers that resolve to ".tsx"/".ts"
// files (e.g. index.ts imports "./Root.js"). Teach Remotion's webpack to map them.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ...(config.resolve?.extensionAlias ?? {}),
    },
  },
}));

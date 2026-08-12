import { config as envConfig } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

envConfig();

// The root directory of your package at runtime
const projectRoot = process.cwd();
const cacheDir = path.join(projectRoot, ".cache");
const defaultSrc = path.resolve(projectRoot);
const devPort = process.env.PORT || 3690;
const staticBuildDir = process.env.STATIC_BUILD_DIR || "out";
const readFromPrebuild = JSON.parse(process.env.READ_FROM_PREBUILD || "0") === 1;
const hmrEnabled = process.env.STREAK_HMR === "true";
const disableCriticalCss = process.env.STREAK_DISABLE_CRITICAL_CSS === "true";

const fileDir = path.dirname(fileURLToPath(import.meta.url));

let sourceRoot = path.resolve(__dirname);

if (fileDir.includes("node_modules")) {
  sourceRoot = path.resolve(path.join(projectRoot, "node_modules", "streak-forge", "dist"));
}

const isProduction = process.env.NODE_ENV === "production";
const targetSrc = process.env.TARGET_SRC || defaultSrc;

const checkAndCreateDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

checkAndCreateDir(cacheDir);

let assetCacheVersion = "dev";
if (isProduction) {
  assetCacheVersion = Date.now().toString();
  process.env.SYS_ASSET_CACHE_VERSION = assetCacheVersion;
}

const config = {
  sourceRoot,
  projectRoot,
  cacheDir,
  isProduction,
  assetCacheVersion,
  publicPath: path.join(targetSrc, "../", "public"),
  targetSrc: targetSrc?.startsWith("/") ? targetSrc : path.resolve(projectRoot, targetSrc),
  devPort,
  staticBuildDir: path.join(targetSrc, staticBuildDir),
  devServerDirectory: "",
  readFromPrebuild,
  hmrEnabled,
  preBuildDir: "",
  disableCriticalCss,
};

config.preBuildDir = process.env.PREBUILD_DIR || path.join(config.targetSrc, ".prebuild");

config.devServerDirectory = path.join(targetSrc, ".streak");

export default config;

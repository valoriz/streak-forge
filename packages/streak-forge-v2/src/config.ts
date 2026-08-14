import path from "path";
import dotenv from "dotenv";
import {
  HANDLERS_DIR,
  LAYOUTS_DIR,
  PUBLIC_DIR,
  WIDGETS_DIR,
} from "./constants";

// Consumer app's cwd - this module always runs invoked from inside the consumer
// app's directory (e.g. `streak-forge dev` run from apps/hello-streak-app).
const targetSrc = process.cwd();

dotenv.config({ path: path.join(targetSrc, ".env") });

const env = process.env;

const config = {
  targetSrc,
  devPort: Number(env.PORT) || 3690,
  hmrEnabled: env.STREAK_HMR !== "false",
  disableCriticalCss: env.STREAK_DISABLE_CRITICAL_CSS === "true",
  preBuildDir: env.PREBUILD_DIR || path.join(targetSrc, ".prebuild"),
  readFromPrebuild: env.READ_FROM_PREBUILD === "1",
  staticBuildDir: path.join(targetSrc, env.STATIC_BUILD_DIR || "out"),
  srcDir: {
    root: targetSrc,
    handlerDir: path.join(targetSrc, HANDLERS_DIR),
    widgetsDir: path.join(targetSrc, WIDGETS_DIR),
    layoutsDir: path.join(targetSrc, LAYOUTS_DIR),
    publicDir: path.join(targetSrc, PUBLIC_DIR),
  },
};

export default config;

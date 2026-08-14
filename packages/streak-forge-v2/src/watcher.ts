import chokidar from "chokidar";
import config from "./config";
import { invalidateModule } from "./moduleLoader";
import { broadcastReload } from "./devServer";

const WATCHED_EXTENSIONS = /\.(ts|tsx|js|jsx|json|html|css)$/;
const IGNORED = /(node_modules|\.git|\.cache|dist)(\/|\\|$)/;

export const startWatcher = () => {
  const watcher = chokidar.watch(config.targetSrc, {
    ignored: (filePath: string) => IGNORED.test(filePath),
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  const onChange = (filePath: string) => {
    if (!WATCHED_EXTENSIONS.test(filePath)) return;
    console.info(`streak v2: change detected - ${filePath}`);
    invalidateModule(filePath);
    broadcastReload();
  };

  watcher
    .on("change", onChange)
    .on("add", onChange)
    .on("error", (err) => console.error("streak v2: watcher error", err));

  return watcher;
};

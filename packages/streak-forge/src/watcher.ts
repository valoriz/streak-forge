import fs from "fs";
import chokidar from "chokidar";
import config from "./config";
import { invalidateModule } from "./moduleLoader";
import { broadcastReload, broadcastScriptWarning } from "./devServer";
import { findClosureLeaks } from "./build/scriptTransform";

const WATCHED_EXTENSIONS = /\.(ts|tsx|js|jsx|json|html|css)$/;
const JSX_EXTENSIONS = /\.(tsx|jsx)$/;
const IGNORED = /(node_modules|\.git|\.cache|dist)(\/|\\|$)/;

// Rebroadcast delay: the browser's SSE connection closes on reload and needs
// a moment to reconnect before it can receive anything - the reload event
// itself goes out on the OLD (about-to-die) connection, so a warning fired
// only once, right at file-save, would often miss the newly-reconnected
// client. Firing again shortly after covers that gap; the client dedupes.
const REBROADCAST_DELAY_MS = 1500;

export const startWatcher = () => {
  const watcher = chokidar.watch(config.targetSrc, {
    ignored: (filePath: string) => IGNORED.test(filePath),
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  const checkScriptClosures = (filePath: string) => {
    if (!JSX_EXTENSIONS.test(filePath)) return;
    try {
      const source = fs.readFileSync(filePath, "utf-8");
      const leaks = findClosureLeaks(source, filePath);
      if (!leaks.length) return;
      leaks.forEach((leak) => broadcastScriptWarning(leak));
      setTimeout(
        () => leaks.forEach((leak) => broadcastScriptWarning(leak)),
        REBROADCAST_DELAY_MS,
      );
    } catch {
      // best-effort - the render path will surface real parse errors anyway
    }
  };

  const onChange = (filePath: string) => {
    if (!WATCHED_EXTENSIONS.test(filePath)) return;
    console.info(`streak-forge: change detected - ${filePath}`);
    invalidateModule(filePath);
    checkScriptClosures(filePath);
    broadcastReload();
  };

  watcher
    .on("change", onChange)
    .on("add", onChange)
    .on("error", (err) => console.error("streak-forge: watcher error", err));

  return watcher;
};

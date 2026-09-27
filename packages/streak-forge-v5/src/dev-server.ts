import chokidar from "chokidar";
import type { Registry } from "./types.js";
import { incrementalRescan } from "./registry.js";
import { walkFiles } from "./fs-utils.js";

export interface DevWatchOptions {
  widgetsDir: string;
  handlersDir: string;
  onRescan: (registry: Registry, changedFile: string) => void | Promise<void>;
}

/**
 * Dev-mode watcher: file-change -> incremental rescan (changed file +
 * its direct importers) -> hand the updated registry back so the dev
 * server can re-run just the affected widget's bundle/CSS/fragment
 * cache, instead of a full pre-build.
 *
 * Deliberately thin — Bun's own bundler already solves dependency-graph
 * tracking (HMR-grade) better than a hand-rolled watcher would; this
 * function exists to plug streak-forge's registry into whatever watch
 * loop the host dev server already runs, not to replace it.
 */
export function watchForChanges(registry: Registry, options: DevWatchOptions): () => void {
  const { widgetsDir, handlersDir, onRescan } = options;
  const watchedGlobs = [widgetsDir, handlersDir];

  const watcher = chokidar.watch(watchedGlobs, {
    ignoreInitial: true,
    persistent: true,
  });

  let current = registry;

  const handleChange = async (changedFile: string) => {
    const allWatchedFiles = [
      ...walkFiles(widgetsDir, [".tsx", ".ts"]),
      ...walkFiles(handlersDir, [".ts"]),
    ];
    current = incrementalRescan(current, changedFile, allWatchedFiles);
    await onRescan(current, changedFile);
  };

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("unlink", handleChange);

  return () => void watcher.close();
}

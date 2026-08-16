import path from "path";
import config from "./config";
import { HANDLERS_DIR, LAYOUTS_DIR, WIDGETS_DIR } from "./constants";
import { buildPageData, type BuildPageDirs } from "./build/buildPage";
import { Progress, type ProgressMetaInfo } from "./build/progress";
import { getCommonHandlerData } from "./build/commonHandler";
import type { StyleCollectDirs } from "./build/styleExtract";
import type { RenderConfig } from "./types";

export type { RenderConfig } from "./types";

export interface HandlerOptions {
  srcDir: {
    root: string;
    handlerDir: string;
    widgetsDir: string;
    layoutsDir: string;
    publicDir: string;
  };
}

export interface RenderOptions {
  onProgress?: (
    metadata: Record<string, any>,
    metaInfo: ProgressMetaInfo,
  ) => void;
  // Accepted for contract-compatibility with external callers - buildPageData
  // is already build-only, `dev` has its own separate live-render path
  // (renderPage.ts) that this function doesn't touch either way.
  isBuild?: boolean;
  handlerOptions?: HandlerOptions;
  // Result of the reserved CommonHandler.ts, threaded into every page data
  // handler as { common }. Omit to have render() resolve it itself (calling
  // CommonHandler once per render() call); pass it explicitly (even as
  // undefined, e.g. from build.ts's once-per-build pre-fetch) to skip that -
  // see the "common" in options check below.
  common?: Record<string, any>;
}

export interface RenderedPageFile {
  id: string;
  path: string;
  content: string;
  type: string;
}

export interface RenderResponse {
  renderedPage: RenderedPageFile[];
  progress: Record<string, any>;
}

// Build mode resolves modules from the pre-bundled cache (when `pre-build`
// has been run and READ_FROM_PREBUILD=1) instead of raw source, so a build
// never re-parses/re-transpiles TS - it just loads what pre-build already
// bundled. Falls back to source if the cache isn't there. Only used for the
// default (no explicit handlerOptions.srcDir) case - an explicit override
// bypasses this entirely, since an external caller's dirs have no relation
// to our own prebuild cache.
const resolveDir = (category: string, srcDir: string): string =>
  config.readFromPrebuild ? path.join(config.preBuildDir, category) : srcDir;

export const defaultDirs = (): {
  dirs: BuildPageDirs;
  styleDirs: StyleCollectDirs;
} => ({
  dirs: {
    handlerDir: resolveDir(HANDLERS_DIR, config.srcDir.handlerDir),
    widgetsDir: resolveDir(WIDGETS_DIR, config.srcDir.widgetsDir),
    layoutsDir: resolveDir(LAYOUTS_DIR, config.srcDir.layoutsDir),
  },
  styleDirs: {
    publicDir: config.srcDir.publicDir,
    layoutsDir: config.srcDir.layoutsDir,
  },
});

/**
 * Public entry point for external build systems (e.g. streak-forge-build) as
 * well as our own `build`/`dev-build` commands: renders one page and returns
 * it wrapped the way those callers expect, reporting per-stage timing via
 * `onProgress` along the way.
 */
export const render = async (
  renderConfig: RenderConfig,
  options?: RenderOptions,
): Promise<RenderResponse> => {
  const progress = new Progress({}, { onProgress: options?.onProgress });

  const override = options?.handlerOptions?.srcDir;
  const { dirs, styleDirs } = override
    ? {
        dirs: {
          handlerDir: override.handlerDir,
          widgetsDir: override.widgetsDir,
          layoutsDir: override.layoutsDir,
        },
        styleDirs: {
          publicDir: override.publicDir,
          layoutsDir: override.layoutsDir,
        },
      }
    : defaultDirs();

  // build.ts/devBuild.ts always pass an explicit `common` key (even when its
  // value is undefined - no CommonHandler.ts present) after resolving it once
  // up front; anything that doesn't mention the key at all (e.g. the external
  // streak-forge-build consumer) gets it auto-resolved here instead, once per
  // render() call.
  const common =
    options && "common" in options
      ? options.common
      : await getCommonHandlerData(dirs.handlerDir);

  const raw = await buildPageData(
    renderConfig,
    dirs,
    styleDirs,
    progress,
    common,
  );
  // Reports render completion the same way every other stage does (a real
  // {currentTime, timeTook} entry) instead of a bespoke top-level field, so
  // external consumers that only special-case startTime/totalTime and treat
  // every other key as a stage object (see run-prebuild-v3.ts) handle it
  // correctly without needing to know about it.
  progress.updateProgress("complete", { stage: "complete" });

  return {
    renderedPage: [
      {
        id: renderConfig.renderId,
        path: path.join(renderConfig.version, "raw-content.json"),
        content: JSON.stringify(raw),
        type: "application/json",
      },
    ],
    progress: progress.getProgress(),
  };
};

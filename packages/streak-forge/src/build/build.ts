import fs from "fs";
import path from "path";
import config from "../config";
import { loadSitemap } from "../sitemap";
import { render, defaultDirs } from "../render";
import { getCommonHandlerData } from "./commonHandler";
import { debugLog } from "./debugLog";

const writeFile = (filePath: string, content: string): void => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

/** Renders every sitemap page and saves its raw content snapshot as JSON. */
export const runBuild = async (): Promise<void> => {
  const pages = await loadSitemap(config.targetSrc);
  debugLog(`streak-forge: building ${pages.size} page(s)...`);

  // CommonHandler.ts (if present) is resolved once here and shared across
  // every page below - not per page - to avoid repeating whatever API calls
  // it makes.
  const { dirs } = defaultDirs();
  debugLog("streak-forge: fetching common handler data...");
  const common = await getCommonHandlerData(dirs.handlerDir);

  let failures = 0;

  for (const [url, page] of pages) {
    console.info(`streak-forge: building ${url}`);
    const pageStart = Date.now();
    try {
      const { renderedPage } = await render(page.renderConfig, { common, url });
      const file = renderedPage[0]!;
      const pageDir = path.join(config.staticBuildDir, url);
      const outputPath = path.join(pageDir, file.path);
      writeFile(outputPath, file.content);
      debugLog(`streak-forge: wrote ${outputPath}`);
      console.info(`streak-forge: built ${url} in ${((Date.now() - pageStart) / 1000).toFixed(2)}s`);
    } catch (err) {
      failures += 1;
      console.error(`streak-forge: failed to build ${url}`, err);
    }
  }

  console.info(`streak-forge: build complete (${pages.size - failures}/${pages.size} page(s) succeeded).`);
  if (failures > 0) process.exitCode = 1;
};

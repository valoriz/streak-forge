import config from "@config";
import { afterRender, beforeRender, render } from "@src/index";
import type { RenderConfig, RenderResponse } from "@core/types";
import path from "path";
import fs from "fs";
import { ifFolderNotExistsCreateIt } from "@core/utils";
import { getStreakSitemapConfig } from "@core/libs/commonUtils";
import { formatDuration } from "@src/utils/commonUtils";

const staticBuildDir = config.staticBuildDir;

const doBuild = async (url: string, renderConfig: RenderConfig) => {
  const response: RenderResponse = await render(renderConfig);

  const { renderedPage, progress } = response;

  const cleanedUrl = url.replace(/^\//, "").replace(/\/$/, "");

  const pageDir = cleanedUrl ? path.join(staticBuildDir, url) : staticBuildDir;

  renderedPage?.forEach((item) => {
    if (item.path && item.content) {
      const cleanPath = item.path.replace(/^\//, "");
      const filePath = path.join(pageDir, cleanPath);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(filePath, item.content, "utf8");
    }
  });

  console.info(`📝 Page build completed: ${url} in ${formatDuration(progress.totalTime || 0)} `);
};

const buildNext = async (pages: StreakSitemapItem[]) => {
  const [currentPage, ...restPages] = pages;
  if (currentPage) {
    const url = currentPage.url;
    const renderConfig = currentPage.renderConfig as RenderConfig;
    if (!renderConfig) {
      throw new Error(`Render config is missing for the page: ${currentPage.url}`);
    }
    if (!url) {
      throw new Error(`URL is missing for the page with renderId: ${renderConfig?.renderId || ""}`);
    }

    console.info(`\n🚀 Building page: ${currentPage.url} with renderId: ${renderConfig?.renderId || ""}`);

    try {
      await doBuild(url, { ...renderConfig, renderId: renderConfig?.renderId || "defaultRenderId" });
      await buildNext(restPages);
    } catch (error) {
      console.error(error);
      console.error(`Error building page ${currentPage.url}:`, (error as Error)?.message || error);
      await buildNext(restPages);
    }
  }
};

const main = async () => {
  const streakSitemapConfiguration = await getStreakSitemapConfig(config.targetSrc);

  if (!Array.isArray(streakSitemapConfiguration)) {
    throw new Error("streak.sitemap.json is not configured properly. Please ensure it contains an 'endpoints' array.");
  }

  ifFolderNotExistsCreateIt(staticBuildDir);
  await beforeRender(staticBuildDir);
  await buildNext(streakSitemapConfiguration);
  await afterRender(staticBuildDir);
};

main();

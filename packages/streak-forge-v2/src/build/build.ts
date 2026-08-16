import fs from "fs";
import path from "path";
import config from "../config";
import { loadSitemap } from "../sitemap";
import { render } from "../render";

const writeFile = (filePath: string, content: string): void => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

/** Renders every sitemap page and saves its raw content snapshot as JSON. */
export const runBuild = async (): Promise<void> => {
  const pages = await loadSitemap(config.targetSrc);
  console.info(`streak-forge: building ${pages.size} page(s)...`);

  let failures = 0;

  for (const [url, page] of pages) {
    console.info(`streak-forge: building ${url}`);
    try {
      const { renderedPage } = await render(page.renderConfig);
      const file = renderedPage[0]!;
      const pageDir = path.join(config.staticBuildDir, url);
      const outputPath = path.join(pageDir, file.path);
      writeFile(outputPath, file.content);
      console.info(`streak-forge: wrote ${outputPath}`);
    } catch (err) {
      failures += 1;
      console.error(`streak-forge: failed to build ${url}`, err);
    }
  }

  console.info(`streak-forge: build complete (${pages.size - failures}/${pages.size} page(s) succeeded).`);
  if (failures > 0) process.exitCode = 1;
};

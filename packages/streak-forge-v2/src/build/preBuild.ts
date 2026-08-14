import fs from "fs";
import path from "path";
import config from "../config";
import { findComponents } from "./findComponents";
import { scriptTransformPlugin } from "./scriptTransform";
import { HANDLERS_DIR, LAYOUTS_DIR, WIDGETS_DIR } from "../constants";

const SITEMAP_FILE_PREFIX = "streak.sitemap";

const cleanAndRecreate = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
};

const copySitemapFiles = (): void => {
  const files = fs.readdirSync(config.targetSrc).filter((f) => f.startsWith(SITEMAP_FILE_PREFIX) && f.endsWith(".json"));
  for (const file of files) {
    fs.copyFileSync(path.join(config.targetSrc, file), path.join(config.preBuildDir, file));
  }
};

const copyPackageJson = (): void => {
  const src = path.join(config.targetSrc, "package.json");
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, path.join(config.preBuildDir, "app-package.json"));
};

interface Category {
  dir: string;
  label: string;
}

/**
 * Bundles every widget/handler/layout into standalone JS under
 * config.preBuildDir, so a later `build` run (with READ_FROM_PREBUILD=1)
 * loads already-bundled modules instead of re-parsing/re-transpiling TS on
 * every import. Reuses the same <Script> transform plugin the dev server
 * uses, so bundled output gets identical closure-leak-safe treatment.
 */
export const runPreBuild = async (): Promise<void> => {
  console.info("streak-forge: running pre-build...");

  cleanAndRecreate(config.preBuildDir);

  const categories: Category[] = [
    { dir: config.srcDir.widgetsDir, label: WIDGETS_DIR },
    { dir: config.srcDir.handlerDir, label: HANDLERS_DIR },
    { dir: config.srcDir.layoutsDir, label: LAYOUTS_DIR },
  ];

  const components = findComponents(categories.map((c) => c.dir));

  if (components.length === 0) {
    console.warn("streak-forge: no widgets, handlers, or layouts found to bundle.");
  }

  for (const component of components) {
    const category = categories.find((c) => component.filePath.startsWith(c.dir + path.sep));
    if (!category) continue;

    const outdir = path.join(config.preBuildDir, category.label);
    const result = await Bun.build({
      entrypoints: [component.filePath],
      outdir,
      target: "bun",
      minify: true,
      plugins: [scriptTransformPlugin],
      external: ["streak-forge", "streak-forge/*"],
      naming: `${component.name}.js`,
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error(`streak-forge: failed to bundle "${component.name}" (${component.filePath})`);
    }
  }

  console.info(`streak-forge: bundled ${components.length} component(s).`);

  if (fs.existsSync(config.srcDir.publicDir)) {
    fs.cpSync(config.srcDir.publicDir, path.join(config.preBuildDir, "public"), { recursive: true });
  }
  copySitemapFiles();
  copyPackageJson();

  console.info(`streak-forge: pre-build complete -> ${config.preBuildDir}`);
};

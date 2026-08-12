import config from "@config";
import path from "path";
import fs from "fs";
import { cleanDirectory, copyDir, ifFolderNotExistsCreateIt } from "@core/utils";

import { build } from "esbuild";
import { HANDLERS_DIR, LAYOUTS_DIR, PUBLIC_DIR, WIDGETS_DIR } from "@core/libs/constants";
import { STREAK_SITEMAP_FILE_PREFIX } from "@src/utils/constants";

const sourceDir = config.targetSrc;
const preBuildDir = config.preBuildDir;

export type ComponentEntry = {
  name: string;
  filePath: string;
};

export function findComponents(directories: string[]): ComponentEntry[] {
  const components: ComponentEntry[] = [];

  const validEntryFiles = [".tsx", ".ts", ".jsx", ".js"];
  const validIndexFiles = ["index.tsx", "index.ts", "index.jsx", "index.js"];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      // 🟦 Case 1: Direct supported component file
      if (item.isFile()) {
        const ext = path.extname(item.name);
        if (validEntryFiles.includes(ext)) {
          const name = path.basename(item.name, ext);
          components.push({ name, filePath: fullPath });
        }
      }

      // 🟩 Case 2: Folder with index.(tsx|ts|jsx|js)
      if (item.isDirectory()) {
        for (const idxFile of validIndexFiles) {
          const possibleIndex = path.join(fullPath, idxFile);
          if (fs.existsSync(possibleIndex)) {
            const name = item.name; // folder name = component name
            components.push({ name, filePath: possibleIndex });
            break; // stop after finding first valid index
          }
        }
      }
    }
  }

  return components;
}

const copyPublicToBuild = () => {
  const publicSrc = path.join(sourceDir, PUBLIC_DIR);
  const publicDest = path.join(preBuildDir, PUBLIC_DIR);

  if (fs.existsSync(publicSrc)) {
    fs.mkdirSync(publicDest, { recursive: true });

    try {
      copyDir(publicSrc, publicDest);
      console.log("✅ Public directory copied to pre-build.");
    } catch (error) {
      console.error("Error copying public directory:", error);
    }
  }
};

const copyPackageJsonToBuild = () => {
  const srcPath = path.join(sourceDir, "package.json");
  const destPath = path.join(preBuildDir, "app-package.json");

  if (!fs.existsSync(srcPath)) {
    console.warn("⚠️ package.json not found — skipping.");
    return;
  }

  try {
    fs.copyFileSync(srcPath, destPath);
    console.info("✅ package.json copied to pre-build as app-package.json.");
  } catch (error) {
    console.error("Error copying package.json:", error);
  }
};

const copyStreakConfigToBuild = () => {
  const files = fs.readdirSync(sourceDir);
  const streakSitemapFiles = files.filter((file) => file.startsWith(STREAK_SITEMAP_FILE_PREFIX) && file.endsWith(".json"));

  streakSitemapFiles.forEach((file) => {
    const srcPath = path.join(sourceDir, file);
    const destPath = path.join(preBuildDir, file);

    try {
      fs.copyFileSync(srcPath, destPath);
      console.log(`✅ ${file} copied to pre-build.`);
    } catch (error) {
      console.error(`Error copying ${file}:`, error);
    }
  });
};

const doPreBuild = async () => {
  console.log("📦 Running Prebuild…");

  const layoutDir = path.join(sourceDir, LAYOUTS_DIR);
  const handlerDir = path.join(sourceDir, HANDLERS_DIR);
  const widgetDir = path.join(sourceDir, WIDGETS_DIR);

  console.time("Read tsx files");
  const components = findComponents([layoutDir, handlerDir, widgetDir]);
  console.timeEnd("Read tsx files");

  if (components.length === 0) {
    console.warn("⚠️ No components found to bundle.");
    return;
  }

  for (const file of components) {
    const componentPath = file.filePath;
    const componentName = file.name;

    // 👇 figure out category (layout / widget / handler)
    let category = "";
    if (componentPath.startsWith(layoutDir)) category = LAYOUTS_DIR;
    if (componentPath.startsWith(handlerDir)) category = HANDLERS_DIR;
    if (componentPath.startsWith(widgetDir)) category = WIDGETS_DIR;

    // 👇 output directory inside prebbuild
    const categoryOutDir = path.join(preBuildDir, category);
    if (!fs.existsSync(categoryOutDir)) {
      fs.mkdirSync(categoryOutDir, { recursive: true });
    }

    const outputPath = path.join(categoryOutDir, `${componentName}.js`);

    console.time(`Bundle ${componentName}`);

    await build({
      entryPoints: [componentPath],
      tsconfig: path.join(config.projectRoot, "tsconfig.json"),
      outfile: outputPath,
      bundle: true,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      external: ["react", "react-dom", "react-dom/server"],
      loader: { ".css": "text" },
      sourcemap: false,
      minify: false,
    });

    console.timeEnd(`Bundle ${componentName}`);
  }
};

const main = async () => {
  cleanDirectory(preBuildDir);
  ifFolderNotExistsCreateIt(preBuildDir);
  await doPreBuild();
  copyPublicToBuild();
  copyStreakConfigToBuild();
  copyPackageJsonToBuild();
};

main();

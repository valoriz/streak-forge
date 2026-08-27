import fs from "fs";
import path from "path";

export interface ComponentEntry {
  name: string;
  filePath: string;
}

const VALID_ENTRY_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const VALID_INDEX_FILES = ["index.tsx", "index.ts", "index.jsx", "index.js"];

/** Scans a set of dirs for widget/handler/layout components - a direct file, or a folder with an index file. */
export const findComponents = (directories: string[]): ComponentEntry[] => {
  const components: ComponentEntry[] = [];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isFile()) {
        const ext = path.extname(item.name);
        if (VALID_ENTRY_EXTENSIONS.includes(ext)) {
          components.push({ name: path.basename(item.name, ext), filePath: fullPath });
        }
      }

      if (item.isDirectory()) {
        for (const idxFile of VALID_INDEX_FILES) {
          const possibleIndex = path.join(fullPath, idxFile);
          if (fs.existsSync(possibleIndex)) {
            components.push({ name: item.name, filePath: possibleIndex });
            break;
          }
        }
      }
    }
  }

  return components;
};

import fs from "fs";
import path from "path";
import config from "./config";
import { findClosureLeaks } from "./build/scriptTransform";
import type { ClosureLeak } from "./build/scriptTransform";

const SOURCE_EXT = /\.(tsx|jsx|ts|js)$/;

const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
  return out;
};

/** Scans every widget/layout file for <Script> closure leaks - the hard-fail counterpart to dev mode's warning. */
export const findAllClosureLeaks = (): ClosureLeak[] => {
  const dirs = [config.srcDir.widgetsDir, config.srcDir.layoutsDir];
  const leaks: ClosureLeak[] = [];

  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const source = fs.readFileSync(file, "utf-8");
      leaks.push(...findClosureLeaks(source, file));
    }
  }

  return leaks;
};

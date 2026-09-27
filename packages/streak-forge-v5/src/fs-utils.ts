import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Small recursive dir walker instead of relying on fs.globSync (only stable
 * from Node 22+, and Bun's Glob has a different API) — keeps this package
 * runnable on whatever Node/Bun version the host project already pins.
 */
export function walkFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkFiles(full, extensions));
    } else if (extensions.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }

  return out;
}

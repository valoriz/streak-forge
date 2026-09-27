import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
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

/**
 * Deletes older hashed builds of one generated file: every file in `dir`
 * named `<stem>.<hex hash><ext>` except `keep` (pass null to delete them
 * all). Generated CSS/JS names carry a content hash, so each rebuild after
 * an edit writes a NEW file — without this, stale copies pile up, and
 * readers that pick "the" `.css` file of an entry (findOwnCssFile) or link
 * every CSS file (dev's discoverCssHrefs) pick up old ones too.
 */
export function removeStaleHashedFiles(dir: string, stem: string, ext: string, keep: string | null): void {
  if (!existsSync(dir)) return;
  const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f]+${ext.replace(".", "\\.")}$`);
  for (const f of readdirSync(dir)) {
    if (f !== keep && pattern.test(f)) rmSync(join(dir, f), { force: true });
  }
}

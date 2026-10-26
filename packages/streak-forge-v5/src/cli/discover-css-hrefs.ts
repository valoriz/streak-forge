import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

/** Every CSS file already sitting in <prebuildDir>/public/ — walking the
 *  PUBLIC mirror specifically (not the whole prebuild dir, which also has
 *  meta.json/content.json/registry.json/JS bundles) means this naturally
 *  only picks up what's actually meant to be public, with no need to
 *  re-derive filenames/hashes from the registry. Used by `dev` only —
 *  simple, unconditional, one `<link>` per file (see writeShellFiles'
 *  `inlineCss: false` path); `build`/`serve` combine eager CSS into one
 *  inline `<style>` instead (composePageFromFiles' collectInlineCss),
 *  computed at request time, not here. */
export function discoverCssHrefs(publicDir: string): string[] {
  const hrefs: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".css")) {
        hrefs.push(`/${full.slice(publicDir.length + 1)}`);
      }
    }
  };
  if (existsSync(publicDir)) walk(publicDir);
  return hrefs.sort();
}

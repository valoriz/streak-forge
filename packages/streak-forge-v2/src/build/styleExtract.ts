import fs from "fs";
import path from "path";
import { parse } from "node-html-parser";

export interface StyleCollectDirs {
  publicDir: string;
  layoutsDir: string;
}

/**
 * Collects <style> and <link rel="stylesheet"> content from an HTML
 * fragment - non-destructive, the original tags stay untouched in the
 * fragment. Local <link href> files get their content read from disk: an
 * absolute href ("/...") resolves against publicDir, a relative one against
 * layoutsDir. A remote (http) href is a hard error - we can't inline
 * something we'd need to fetch.
 */
export const collectStyles = (html: string, dirs: StyleCollectDirs): string[] => {
  const root = parse(html);
  const styles: string[] = [];

  root.querySelectorAll("link[rel='stylesheet']").forEach((el) => {
    const href = el.getAttribute("href");
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      throw new Error(`External CSS file detected: ${href}. This may not be processed correctly.`);
    }
    const cssPath = href.startsWith("/") ? path.join(dirs.publicDir, href) : path.resolve(dirs.layoutsDir, href);
    if (fs.existsSync(cssPath)) {
      styles.push(fs.readFileSync(cssPath, "utf8"));
    } else {
      console.warn(`CSS file not found: ${cssPath}`);
    }
  });

  root.querySelectorAll("style").forEach((el) => {
    if (el.innerHTML) styles.push(el.innerHTML);
  });

  return styles;
};

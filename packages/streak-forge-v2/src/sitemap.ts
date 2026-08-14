import path from "path";
import type { StreakSitemapItem } from "./types";

const SITEMAP_FILE = "streak.sitemap.json";

export const loadSitemap = async (
  targetSrc: string,
): Promise<Map<string, StreakSitemapItem>> => {
  const sitemapPath = path.join(targetSrc, SITEMAP_FILE);
  const file = Bun.file(sitemapPath);

  if (!(await file.exists())) {
    throw new Error(`${SITEMAP_FILE} not found at ${sitemapPath}`);
  }

  const raw = await file.json();

  if (!Array.isArray(raw)) {
    throw new Error(
      `${SITEMAP_FILE} must be a JSON array of {url, renderConfig}.`,
    );
  }

  const pages = new Map<string, StreakSitemapItem>();

  raw.forEach((entry: StreakSitemapItem, i: number) => {
    if (!entry?.url || !entry?.renderConfig) {
      throw new Error(
        `${SITEMAP_FILE}[${i}] is missing "url" or "renderConfig".`,
      );
    }
    const rc = entry.renderConfig;
    if (!rc.renderId || !rc.rootLayout || !Array.isArray(rc.widgets)) {
      throw new Error(
        `${SITEMAP_FILE}[${i}].renderConfig must have renderId, rootLayout, and widgets[].`,
      );
    }
    pages.set(entry.url, entry);
  });

  return pages;
};

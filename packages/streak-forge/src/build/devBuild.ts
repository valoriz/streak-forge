import fs from "fs";
import path from "path";
import config from "../config";
import { loadSitemap } from "../sitemap";
import { render, defaultDirs } from "../render";
import { getCommonHandlerData } from "./commonHandler";
import { debugLog } from "./debugLog";

interface SavedFile {
  path?: string;
  content?: string;
  type?: string;
}

const saveFiles = (baseDir: string, files: SavedFile[]): void => {
  if (!Array.isArray(files)) return;
  for (const item of files) {
    if (!item.path || !item.content) continue;
    const cleanPath = item.path.replace(/^\//, "");
    const filePath = path.join(baseDir, cleanPath);
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, item.content, "utf8");
  }
};

const buildHeaders = (token: string): Record<string, string> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-functions-key"] = token;
  return headers;
};

const readPackageVersion = (): string | undefined => {
  try {
    const pkgPath = path.join(config.targetSrc, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> };
    const raw = pkg.dependencies?.["streak-forge"] ?? pkg.dependencies?.["streak"];
    if (!raw) return undefined;
    return raw.match(/(\d+\.\d+\.\d+[^\s]*)/)?.[1];
  } catch {
    return undefined;
  }
};

interface MissingEnvVar {
  key: string;
  description: string;
}

const printMissingEnvError = (missing: MissingEnvVar[]): void => {
  console.error("\n╔══════════════════════════════════════════════════════════════╗");
  console.error("║            streak-forge dev-build — Configuration Error        ║");
  console.error("╚══════════════════════════════════════════════════════════════╝\n");
  console.error("The following required environment variable(s) are not set:\n");
  for (const { key, description } of missing) {
    console.error(`  • ${key}`);
    console.error(`    ${description}\n`);
  }
  console.error("Add the missing variable(s) to your .env file. Example:");
  for (const { key } of missing) console.error(`  ${key}=<value provided by your build service administrator>`);
  console.error("");
};

interface CommonScriptsResponse {
  success: boolean;
  data?: SavedFile[];
  error?: string;
}

interface PageBuildResponse {
  success: boolean;
  data?: { renderedPage: SavedFile[] };
  error?: string;
}

/**
 * Stage-1 renders every page locally (same as `build`), then POSTs each raw
 * snapshot to a remote optimizer service and saves back whatever it returns.
 * Requires STREAK_BUILD_ENDPOINT/STREAK_SITE_ID - there's no local fallback,
 * this command genuinely depends on that remote service being reachable.
 */
export const runDevBuild = async (): Promise<void> => {
  const buildEndpoint = (process.env.STREAK_BUILD_ENDPOINT ?? "").replace(/\/$/, "");
  const token = process.env.STREAK_BUILD_TOKEN ?? "";
  const siteId = process.env.STREAK_SITE_ID ?? "";
  const packageVersion = readPackageVersion();

  const missing: MissingEnvVar[] = [];
  if (!buildEndpoint) {
    missing.push({ key: "STREAK_BUILD_ENDPOINT", description: "Base URL of the remote build service (e.g. https://myfunc.azurewebsites.net)." });
  }
  if (!siteId) {
    missing.push({ key: "STREAK_SITE_ID", description: "Unique identifier for your site in the build service." });
  }
  if (missing.length > 0) {
    printMissingEnvError(missing);
    process.exitCode = 1;
    return;
  }

  const headers = buildHeaders(token);
  const buildId = `dev-${Date.now()}`;

  fs.rmSync(config.staticBuildDir, { recursive: true, force: true });
  fs.mkdirSync(config.staticBuildDir, { recursive: true });

  if (fs.existsSync(config.srcDir.publicDir)) {
    fs.cpSync(config.srcDir.publicDir, config.staticBuildDir, { recursive: true });
  }

  debugLog("streak-forge: fetching common scripts...");
  try {
    const res = await fetch(`${buildEndpoint}?type=commonScripts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ packageVersion }),
    });
    const json = (await res.json()) as CommonScriptsResponse;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error ?? JSON.stringify(json)}`);
    if (json.success && json.data) {
      saveFiles(config.staticBuildDir, json.data);
      debugLog("streak-forge: common scripts saved.");
    } else {
      console.error("streak-forge: common scripts response invalid:", json.error ?? "unknown");
    }
  } catch (err) {
    console.error("streak-forge: failed to fetch common scripts:", (err as Error).message);
  }

  const pages = await loadSitemap(config.targetSrc);
  debugLog(`streak-forge: building ${pages.size} page(s) via remote optimizer...`);

  // CommonHandler.ts (if present) is resolved once here and shared across
  // every page below - not per page - to avoid repeating whatever API calls
  // it makes.
  const { dirs } = defaultDirs();
  debugLog("streak-forge: fetching common handler data...");
  const common = await getCommonHandlerData(dirs.handlerDir);

  let failures = 0;

  for (const [url, page] of pages) {
    debugLog(`streak-forge: building ${url}`);
    const pageStart = Date.now();
    try {
      const { renderedPage } = await render(page.renderConfig, { common, url });
      const rawContent = JSON.parse(renderedPage[0]!.content);
      const payload = { ...rawContent, buildId, siteId, packageVersion };

      const res = await fetch(buildEndpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const json = (await res.json()) as PageBuildResponse;

      if (!res.ok || !json.success) {
        throw new Error(`HTTP ${res.status}: ${json.error ?? JSON.stringify(json)}`);
      }

      const pageDir = path.join(config.staticBuildDir, url);
      saveFiles(pageDir, json.data?.renderedPage ?? []);
      debugLog(`streak-forge: done ${url}`);
      debugLog(`streak-forge: ${url} took ${Date.now() - pageStart}ms to render`);
    } catch (err) {
      failures += 1;
      console.error(`streak-forge: failed to build ${url}:`, (err as Error).message);
    }
  }

  debugLog(`streak-forge: dev-build complete (${pages.size - failures}/${pages.size} page(s) succeeded).`);
  if (failures > 0) process.exitCode = 1;
};

import config from "@config";
import { render, beforeRender, afterRender } from "@src/index";
import type { RenderConfig } from "@core/types";
import path from "path";
import fs from "fs";

const staticBuildDir = config.staticBuildDir;
const projectRoot = config.projectRoot;

function saveFiles(baseDir: string, files: { path?: string; content?: string; type?: string }[]) {
  if (!Array.isArray(files)) return;
  for (const item of files) {
    if (!item.path || !item.content) continue;
    const cleanPath = item.path.replace(/^\//, "");
    const filePath = path.join(baseDir, cleanPath);
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, item.content, "utf8");
  }
}

function buildHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-functions-key"] = token;
  return headers;
}

async function buildPages(buildUrl: string, headers: Record<string, string>, buildId: string, siteId: string, packageVersion: string | undefined) {
  const sitemapPath = path.join(projectRoot, "streak.sitemap.json");

  let sitemap: { url: string; renderConfig: Record<string, unknown> }[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(sitemapPath, "utf-8"));
    sitemap = Array.isArray(raw) ? raw : (raw.endpoints ?? raw.pages ?? []);
  } catch (err) {
    console.error("❌ Failed to read streak.sitemap.json:", (err as Error).message);
    process.exit(1);
  }

  console.info(`\n📄 Building ${sitemap.length} page(s)...`);

  for (const page of sitemap) {
    const { url, renderConfig } = page;
    if (!renderConfig || !url) continue;

    console.info(`\n🚀 Building: ${url}`);
    try {
      // Stage 1: local render → produces intermediate raw-content JSON
      const renderResult = await render(renderConfig as unknown as RenderConfig, { isBuild: true });
      const { renderedPage: stageOnePages } = renderResult as { renderedPage: { content: string }[] };
      const [firstPage] = stageOnePages ?? [];
      if (!firstPage?.content) throw new Error("Stage 1 render produced no output");

      const rawContent = JSON.parse(firstPage.content) as Record<string, unknown>;

      // Stage 2: POST raw-content + buildId + siteId to remote optimizer
      const payload = { ...rawContent, buildId, siteId, packageVersion };
      const res = await fetch(buildUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as { success: boolean; data?: { renderedPage: { path: string; content: string; type: string }[] }; error?: string };

      if (!res.ok || !json.success) {
        console.error(`❌ Failed: ${url} — HTTP ${res.status}:`, json.error ?? JSON.stringify(json));
        continue;
      }

      const renderedPage = json.data?.renderedPage ?? [];
      const cleanedUrl = url.replace(/^\//, "").replace(/\/$/, "");
      const pageDir = cleanedUrl ? path.join(staticBuildDir, url) : staticBuildDir;
      saveFiles(pageDir, renderedPage);
      console.info(`✅ Done: ${url}`);
    } catch (err) {
      console.error(`❌ Error building ${url}:`, (err as Error).message);
    }
  }
}

function missingEnvError(missing: { key: string; description: string }[]) {
  console.error("\n╔══════════════════════════════════════════════════════════════╗");
  console.error("║           ❌  Remote Dev Build — Configuration Error          ║");
  console.error("╚══════════════════════════════════════════════════════════════╝\n");
  console.error("The following required environment variable(s) are not set:\n");
  for (const { key, description } of missing) {
    console.error(`  • ${key}`);
    console.error(`    ${description}\n`);
  }
  console.error("─────────────────────────────────────────────────────────────");
  console.error("How to fix:");
  console.error("  1. Add the missing variable(s) to your .env file.");
  console.error("  2. If you don't have these values, contact your project");
  console.error("     administrator or the team that manages the build service.");
  console.error("  3. They will provide the endpoint URL and access token.");
  console.error("");
  console.error("Example .env entries:");
  for (const { key } of missing) {
    console.error(`  ${key}=<value provided by your administrator>`);
  }
  console.error("─────────────────────────────────────────────────────────────\n");
  process.exit(1);
}

function readPackageVersion(): string | undefined {
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> };
    const raw = pkg.dependencies?.["streak-forge"] ?? pkg.dependencies?.["streak"];
    if (!raw) return undefined;
    const m = raw.match(/(\d+\.\d+\.\d+[^\s]*)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

const main = async () => {
  const buildEndpoint = (process.env.STREAK_BUILD_ENDPOINT ?? "").replace(/\/$/, "");

  const token = process.env.STREAK_BUILD_TOKEN ?? "";
  const siteId = process.env.STREAK_SITE_ID ?? "";
  const packageVersion = readPackageVersion();

  const missing: { key: string; description: string }[] = [];
  if (!buildEndpoint) {
    missing.push({
      key: "STREAK_BUILD_ENDPOINT",
      description: "Base URL of the remote build service (e.g. https://myfunc.azurewebsites.net).",
    });
  }
  if (!siteId) {
    missing.push({
      key: "STREAK_SITE_ID",
      description: "Unique identifier for your site in the build service.",
    });
  }
  if (missing.length > 0) {
    missingEnvError(missing);
    return;
  }
  const buildId = `dev-${Date.now()}`;
  const headers = buildHeaders(token);

  if (!fs.existsSync(staticBuildDir)) fs.mkdirSync(staticBuildDir, { recursive: true });

  const BUILD_URL = buildEndpoint;

  // 1. Common scripts first
  console.info("📦 Fetching common scripts...");
  try {
    const res = await fetch(`${BUILD_URL}?type=commonScripts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ packageVersion }),
    });
    const json = (await res.json()) as { success: boolean; data?: { path: string; content: string; type: string }[]; error?: string };
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error ?? JSON.stringify(json)}`);
    if (json.success && json.data) {
      saveFiles(staticBuildDir, json.data);
      console.info("✅ Common scripts saved.");
    } else {
      console.error("❌ Common scripts response invalid:", json.error ?? "unknown");
    }
  } catch (err) {
    console.error("❌ Failed to fetch common scripts:", (err as Error).message);
  }

  // 2. Copy public assets to output dir
  console.info("📂 Copying public assets...");
  await beforeRender(staticBuildDir);

  // 3. Pages sequentially
  await buildPages(BUILD_URL, headers, buildId, siteId, packageVersion);

  await afterRender(staticBuildDir);

  console.info("\n🎉 Dev build completed.");
};

main();

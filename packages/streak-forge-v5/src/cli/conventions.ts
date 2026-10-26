import { join } from "node:path";

/**
 * Zero-config project layout — every consuming project so far (test-app,
 * hello-streak-app) uses these exact same paths, so the CLI bakes them in
 * as fixed conventions (matching streak-forge's own zero-config CLI)
 * rather than inventing a config file just to let a project rename
 * `src/widgets`. A project that genuinely needs different paths is a
 * reasonable future `streak-forge.config.ts`-driven override — not needed
 * by anything real yet.
 */
export function projectPaths(root: string) {
  return {
    root,
    widgetsDir: join(root, "src/widgets"),
    handlersDir: join(root, "src/handlers"),
    componentsDir: join(root, "src/components"),
    shellDir: join(root, "src/shell"),
    publicDir: join(root, "public"),
    sitemapPath: join(root, "streak.sitemap.json"),
    appCssPath: join(root, "src/app.css"),
    fullCssPath: join(root, "src/app.full.css"),
    prebuildDir: join(root, ".prebuild"),
    outDir: join(root, "out"),
    devDir: join(root, ".dev"),
  };
}

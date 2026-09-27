import { existsSync } from "node:fs";
import { writeDynamicClassesSafelist } from "./safelist.js";
import { projectPaths } from "./conventions.js";

/** `streak-forge safelist` — writes .streak-forge-cache/dynamic-classes.json
 *  only, nothing else. Meant to run immediately before the project's own
 *  CSS build step (see safelist.ts's doc comment for why the ordering
 *  matters): `"prebuild": "streak-forge safelist && bun run css-build &&
 *  streak-forge prebuild"`. */
export function runSafelistCommand(root: string): void {
  const paths = projectPaths(root);
  const safelist = writeDynamicClassesSafelist({
    root: paths.root,
    widgetsDir: paths.widgetsDir,
    handlersDir: paths.handlersDir,
    componentsDir: existsSync(paths.componentsDir) ? paths.componentsDir : undefined,
    shellDir: existsSync(paths.shellDir) ? paths.shellDir : undefined,
  });
  console.log(`Wrote ${safelist.length} dynamic class(es) to .streak-forge-cache/dynamic-classes.json`);
}

import { fullScan } from "../registry.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface WriteSafelistOptions {
  root: string;
  widgetsDir: string;
  handlersDir: string;
  componentsDir?: string;
  shellDir?: string;
}

/**
 * Scans every widget/component/html/head/body's own `dynamicClasses`
 * annotation and writes the flattened, deduped set to
 * `.streak-forge-cache/dynamic-classes.json` — a plain JSON data file, not
 * a build step. This is a genuinely streak-forge-native concern (reading
 * its own annotations), unlike actually COMPILING CSS: that stays the
 * project's own job, via whatever CSS tool it already uses (its own
 * `css-build` npm script) — streak-forge never invokes a CSS compiler
 * itself, in the CLI or anywhere else in the package. A project's
 * tailwind.config.js (or equivalent) is what chooses to read this file
 * into its own `safelist` — streak-forge doesn't know or care that
 * Tailwind specifically is on the other end.
 *
 * Must run BEFORE the project's own CSS build step: a runtime-assembled
 * class like `bg-${color}-500` only survives that build if it's already
 * in the safelist before the compiler ever runs — no amount of purging
 * afterward can add a rule the compiler never emitted.
 */
export function writeDynamicClassesSafelist(options: WriteSafelistOptions): string[] {
  const { root, widgetsDir, handlersDir, componentsDir, shellDir } = options;
  const registry = fullScan(widgetsDir, handlersDir, componentsDir, shellDir);

  const allDynamicClasses = [
    ...Object.values(registry.widgets).flatMap((w) => w.dynamicClasses),
    ...Object.values(registry.components).flatMap((c) => c.dynamicClasses),
    ...Object.values(registry.html).flatMap((e) => e.dynamicClasses),
    ...Object.values(registry.head).flatMap((e) => e.dynamicClasses),
    ...Object.values(registry.body).flatMap((e) => e.dynamicClasses),
  ];
  const safelist = [...new Set(allDynamicClasses)];

  const cacheDir = join(root, ".streak-forge-cache");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "dynamic-classes.json"), JSON.stringify(safelist, null, 2));

  return safelist;
}

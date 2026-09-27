#!/usr/bin/env bun
import { runSafelistCommand } from "../src/cli/safelist-command.js";
import { runPrebuildCommand } from "../src/cli/prebuild.js";
import { runDevCommand } from "../src/cli/dev.js";

const USAGE = `streak-forge <command>

Commands:
  safelist   Write .streak-forge-cache/dynamic-classes.json (run before your own CSS build)
  prebuild   TSX->JS conversion + per-widget CSS purge (.prebuild/)
  dev        Watch + rebuild into .dev/, serve with live-reload

Page composition and serving moved to the streak-boot package
(streak-boot build / streak-boot serve) — install it alongside this one.

Run from the project root (where streak.sitemap.json lives).`;

async function main(): Promise<void> {
  const [, , command] = process.argv;
  const root = process.cwd();

  switch (command) {
    case "safelist":
      runSafelistCommand(root);
      return;
    case "prebuild":
      await runPrebuildCommand(root);
      return;
    case "dev":
      await runDevCommand(root);
      return;
    default:
      console.error(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

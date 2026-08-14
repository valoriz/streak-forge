#!/usr/bin/env bun
import {
  registerScriptTransform,
  formatClosureLeak,
} from "../src/build/scriptTransform";
import { startDevServer } from "../src/devServer";
import { startWatcher } from "../src/watcher";
import { findAllClosureLeaks } from "../src/validate";

const command = process.argv[2];

switch (command) {
  case "dev": {
    registerScriptTransform();
    await startDevServer();
    startWatcher();
    break;
  }
  case "validate": {
    const leaks = findAllClosureLeaks();
    if (leaks.length === 0) {
      console.info("streak validate: no <Script> closure leaks found.");
      break;
    }
    console.error(
      `streak validate: found ${leaks.length} <Script> closure leak(s):\n`,
    );
    leaks.forEach((leak) => console.error(`  ${formatClosureLeak(leak)}`));
    process.exit(1);
    break;
  }
  default:
    console.info(
      `streak v2 - stage 1 (dev server only). Unknown command: ${command ?? ""}`,
    );
    console.info("Usage: streak-forge dev | streak-forge validate");
    process.exit(1);
}

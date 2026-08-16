#!/usr/bin/env bun
import {
  registerScriptTransform,
  formatClosureLeak,
} from "../src/build/scriptTransform";
import { startDevServer } from "../src/devServer";
import { startWatcher } from "../src/watcher";
import { findAllClosureLeaks } from "../src/validate";
import { runPreBuild } from "../src/build/preBuild";
import { runBuild } from "../src/build/build";
import { runDevBuild } from "../src/build/devBuild";

const command = process.argv[2];

switch (command) {
  case "dev": {
    await registerScriptTransform();
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
  case "pre-build": {
    await runPreBuild();
    break;
  }
  case "build": {
    await registerScriptTransform();
    await runBuild();
    break;
  }
  case "dev-build": {
    await registerScriptTransform();
    await runDevBuild();
    break;
  }
  default:
    console.info(`streak-forge v2 - unknown command: ${command ?? ""}`);
    console.info(
      "Usage: streak-forge dev | streak-forge validate | streak-forge pre-build | streak-forge build | streak-forge dev-build",
    );
    process.exit(1);
}
